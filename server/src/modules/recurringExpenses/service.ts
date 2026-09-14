import type { RecurringExpense } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/client.js";
import { uuidv7 } from "../../lib/id.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { formatMinor, parseMinor } from "../../domain/money.js";
import { assertActiveMembers } from "../expenses/service.js";
import type { createRecurringExpenseSchema } from "./schemas.js";

type CreateInput = z.infer<typeof createRecurringExpenseSchema>;

function toPublicRecurringExpense(r: RecurringExpense) {
  return {
    id: r.id,
    groupId: r.groupId,
    description: r.description,
    category: r.category,
    currency: r.currency,
    amount: formatMinor(r.amountMinor, r.currency),
    splitType: r.splitType,
    splits: r.splitsPayload,
    payers: r.payersPayload,
    interval: r.interval,
    nextRunAt: r.nextRunAt,
    active: r.active,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function createRecurringExpense(groupId: string, actorId: string, input: CreateInput) {
  const participantIds = new Set([
    ...input.splits.map((s) => s.userId),
    ...input.payers.map((p) => p.userId),
  ]);
  await assertActiveMembers(groupId, participantIds);

  const row = await prisma.recurringExpense.create({
    data: {
      id: uuidv7(),
      groupId,
      description: input.description,
      category: input.category,
      currency: input.currency,
      amountMinor: parseMinor(input.amount, input.currency),
      splitType: input.splitType,
      splitsPayload: input.splits,
      payersPayload: input.payers,
      interval: input.interval,
      nextRunAt: new Date(input.startAt),
      createdById: actorId,
    },
  });
  return toPublicRecurringExpense(row);
}

export async function listRecurringExpenses(groupId: string) {
  const rows = await prisma.recurringExpense.findMany({
    where: { groupId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPublicRecurringExpense);
}

async function loadWithPermission(id: string, actorId: string): Promise<RecurringExpense> {
  const row = await prisma.recurringExpense.findUnique({ where: { id } });
  if (!row) {
    throw new ApiError(404, "NOT_FOUND", "Recurring expense not found.");
  }
  if (row.createdById !== actorId) {
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: row.groupId, userId: actorId } },
    });
    if (!membership || membership.role !== "OWNER") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Only the recurring expense's creator or the group owner can do that.",
      );
    }
  }
  return row;
}

export async function setActive(id: string, actorId: string, active: boolean) {
  const row = await loadWithPermission(id, actorId);
  const updated = await prisma.recurringExpense.update({ where: { id: row.id }, data: { active } });
  return toPublicRecurringExpense(updated);
}

export async function deleteRecurringExpense(id: string, actorId: string) {
  const row = await loadWithPermission(id, actorId);
  await prisma.recurringExpense.delete({ where: { id: row.id } });
}
