import { randomBytes } from "node:crypto";
import type { Group } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/client.js";
import { uuidv7 } from "../../lib/id.js";
import { recordActivity } from "../../lib/activity.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { getUserNetBalance } from "../balances/service.js";
import type { createGroupSchema, updateGroupSchema } from "./schemas.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toPublicGroup(group: Group) {
  return {
    id: group.id,
    name: group.name,
    baseCurrency: group.baseCurrency,
    createdById: group.createdById,
    createdAt: group.createdAt,
    archivedAt: group.archivedAt,
  };
}

function generateInviteCode(): string {
  return randomBytes(6).toString("base64url");
}

export async function createGroup(creatorId: string, input: z.infer<typeof createGroupSchema>) {
  return prisma.$transaction(async (tx) => {
    const groupId = uuidv7();
    const group = await tx.group.create({
      data: {
        id: groupId,
        name: input.name,
        baseCurrency: input.baseCurrency,
        createdById: creatorId,
      },
    });

    await tx.groupMember.create({
      data: { groupId, userId: creatorId, role: "OWNER" },
    });

    await recordActivity(tx, {
      groupId,
      actorId: creatorId,
      type: "GROUP_CREATED",
      entityType: "Group",
      entityId: groupId,
      payload: { name: input.name, baseCurrency: input.baseCurrency },
    });

    const pendingInvites: { email: string; code: string; expiresAt: Date }[] = [];

    for (const email of new Set(input.memberEmails)) {
      const user = await tx.user.findUnique({ where: { email } });

      if (user && user.id !== creatorId) {
        await tx.groupMember.create({
          data: { groupId, userId: user.id, role: "MEMBER" },
        });
        await recordActivity(tx, {
          groupId,
          actorId: creatorId,
          type: "MEMBER_JOINED",
          entityType: "GroupMember",
          entityId: user.id,
          payload: { userId: user.id, name: user.name },
        });
      } else if (!user) {
        const code = generateInviteCode();
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
        await tx.groupInvite.create({
          data: { id: uuidv7(), groupId, code, createdById: creatorId, expiresAt },
        });
        pendingInvites.push({ email, code, expiresAt });
      }
    }

    return { group: toPublicGroup(group), pendingInvites };
  });
}

export async function listGroups(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId, leftAt: null },
    include: { group: true },
    orderBy: { group: { createdAt: "desc" } },
  });

  return memberships.map((m) => ({ ...toPublicGroup(m.group), role: m.role }));
}

export async function getGroup(groupId: string) {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const members = await listMembers(groupId);
  return { ...toPublicGroup(group), members };
}

export async function updateGroup(groupId: string, input: z.infer<typeof updateGroupSchema>) {
  const group = await prisma.group.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
    },
  });
  return toPublicGroup(group);
}

export async function listMembers(groupId: string) {
  const members = await prisma.groupMember.findMany({
    where: { groupId, leftAt: null },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });

  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    joinedAt: m.joinedAt,
  }));
}

export async function createInvite(groupId: string, creatorId: string) {
  const invite = await prisma.groupInvite.create({
    data: {
      id: uuidv7(),
      groupId,
      code: generateInviteCode(),
      createdById: creatorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  return { code: invite.code, expiresAt: invite.expiresAt };
}

export async function acceptInvite(code: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.groupInvite.findUnique({ where: { code } });

    if (!invite || invite.usedById || invite.expiresAt < new Date()) {
      throw new ApiError(404, "INVITE_INVALID", "Invite code is invalid, expired, or already used.");
    }

    const existing = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId: invite.groupId, userId } },
    });

    if (!existing || existing.leftAt) {
      if (!existing) {
        await tx.groupMember.create({
          data: { groupId: invite.groupId, userId, role: "MEMBER" },
        });
      } else {
        await tx.groupMember.update({
          where: { groupId_userId: { groupId: invite.groupId, userId } },
          data: { leftAt: null, role: "MEMBER", joinedAt: new Date() },
        });
      }

      const joiningUser = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await recordActivity(tx, {
        groupId: invite.groupId,
        actorId: userId,
        type: "MEMBER_JOINED",
        entityType: "GroupMember",
        entityId: userId,
        payload: { userId, name: joiningUser.name },
      });
    }
    // else: already an active member — the invite is still consumed below, no new activity.

    await tx.groupInvite.update({ where: { id: invite.id }, data: { usedById: userId } });

    const group = await tx.group.findUniqueOrThrow({ where: { id: invite.groupId } });
    return toPublicGroup(group);
  });
}

export async function removeMember(groupId: string, targetUserId: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: targetUserId } },
    });

    if (!target || target.leftAt) {
      throw new ApiError(404, "NOT_FOUND", "Member not found in this group.");
    }

    if (target.role === "OWNER") {
      const ownerCount = await tx.groupMember.count({
        where: { groupId, role: "OWNER", leftAt: null },
      });
      if (ownerCount <= 1) {
        throw new ApiError(409, "LAST_OWNER", "Cannot remove the group's only owner.");
      }
    }

    const balance = await getUserNetBalance(groupId, targetUserId);
    if (balance !== 0n) {
      throw new ApiError(
        409,
        "MEMBER_HAS_BALANCE",
        "Member has a non-zero balance in this group.",
      );
    }

    await tx.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: { leftAt: new Date() },
    });

    const removedUser = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });
    await recordActivity(tx, {
      groupId,
      actorId,
      type: "MEMBER_REMOVED",
      entityType: "GroupMember",
      entityId: targetUserId,
      payload: { userId: targetUserId, name: removedUser.name },
    });
  });
}
