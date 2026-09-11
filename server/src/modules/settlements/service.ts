import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/client.js";
import { uuidv7 } from "../../lib/id.js";
import { recordActivity } from "../../lib/activity.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { env } from "../../config/env.js";
import { formatMinor, parseMinor } from "../../domain/money.js";
import { rateProvider, convertMinor, formatRateForStorage, FxError } from "../../domain/fx.js";
import { contentTypeFor, detectImageType, extensionFor } from "../../lib/imageType.js";
import { LocalDiskStorageAdapter, type StorageAdapter } from "../../lib/storage.js";
import type { createSettlementSchema } from "./schemas.js";

const storage: StorageAdapter = new LocalDiskStorageAdapter(env.UPLOAD_DIR);

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

type CreateSettlementInput = z.infer<typeof createSettlementSchema>;

const SETTLEMENT_INCLUDE = {
  group: { select: { baseCurrency: true } },
  fromUser: { select: { name: true } },
  toUser: { select: { name: true } },
} satisfies Prisma.SettlementInclude;

type SettlementWithRelations = Prisma.SettlementGetPayload<{ include: typeof SETTLEMENT_INCLUDE }>;

function parseMoneyOrThrow(amount: string, currency: string): bigint {
  try {
    return parseMinor(amount, currency);
  } catch (err) {
    throw new ApiError(422, "VALIDATION_ERROR", err instanceof Error ? err.message : "Invalid amount");
  }
}

function getRateOrThrow(from: string, to: string): bigint {
  try {
    return rateProvider.getRate(from, to);
  } catch (err) {
    if (err instanceof FxError) {
      throw new ApiError(422, "UNSUPPORTED_CURRENCY", err.message);
    }
    throw err;
  }
}

function toPublicSettlement(s: SettlementWithRelations) {
  const baseCurrency = s.group.baseCurrency;
  return {
    id: s.id,
    groupId: s.groupId,
    fromUserId: s.fromUserId,
    fromUserName: s.fromUser.name,
    toUserId: s.toUserId,
    toUserName: s.toUser.name,
    currency: s.currency,
    amount: formatMinor(s.amountMinor, s.currency),
    baseCurrency,
    amountBase: formatMinor(s.amountBaseMinor, baseCurrency),
    fxRateToBase: s.fxRateToBase.toString(),
    note: s.note,
    hasReceipt: s.receiptUrl !== null,
    status: s.status,
    settledAt: s.settledAt,
    createdById: s.createdById,
    createdAt: s.createdAt,
  };
}

async function loadSettlementWithMembership(settlementId: string, userId: string) {
  const settlement = await prisma.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement) {
    throw new ApiError(404, "NOT_FOUND", "Settlement not found.");
  }
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: settlement.groupId, userId } },
  });
  if (!membership || membership.leftAt) {
    throw new ApiError(404, "NOT_FOUND", "Settlement not found.");
  }
  return { settlement, membership };
}

/**
 * Row-locks the settlement (SELECT ... FOR UPDATE) before checking status, so two concurrent
 * confirms/rejects on the same settlement serialize: the second blocks until the first commits,
 * then sees the terminal status and 409s. The raw query establishes the lock; the typed
 * findUnique that follows reads consistently within the same transaction/connection.
 */
async function lockPendingSettlement(tx: Prisma.TransactionClient, settlementId: string) {
  await tx.$queryRaw`SELECT id FROM "Settlement" WHERE id = ${settlementId}::uuid FOR UPDATE`;
  const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement) {
    throw new ApiError(404, "NOT_FOUND", "Settlement not found.");
  }
  if (settlement.status !== "PENDING") {
    throw new ApiError(409, "SETTLEMENT_NOT_PENDING", "This settlement is no longer pending.");
  }
  return settlement;
}

async function performConfirm(
  tx: Prisma.TransactionClient,
  settlementId: string,
  activityActorId: string,
) {
  const settlement = await lockPendingSettlement(tx, settlementId);

  await tx.ledgerEntry.createMany({
    data: [
      {
        id: uuidv7(),
        groupId: settlement.groupId,
        userId: settlement.fromUserId,
        counterpartyId: settlement.toUserId,
        amountBaseMinor: settlement.amountBaseMinor,
        sourceType: "SETTLEMENT",
        sourceId: settlementId,
      },
      {
        id: uuidv7(),
        groupId: settlement.groupId,
        userId: settlement.toUserId,
        counterpartyId: settlement.fromUserId,
        amountBaseMinor: -settlement.amountBaseMinor,
        sourceType: "SETTLEMENT",
        sourceId: settlementId,
      },
    ],
  });

  await tx.settlement.update({ where: { id: settlementId }, data: { status: "CONFIRMED" } });

  await recordActivity(tx, {
    groupId: settlement.groupId,
    actorId: activityActorId,
    type: "SETTLEMENT_CONFIRMED",
    entityType: "Settlement",
    entityId: settlementId,
    payload: {},
  });
}

async function performReject(
  tx: Prisma.TransactionClient,
  settlementId: string,
  activityActorId: string,
) {
  const settlement = await lockPendingSettlement(tx, settlementId);

  await tx.settlement.update({ where: { id: settlementId }, data: { status: "REJECTED" } });

  await recordActivity(tx, {
    groupId: settlement.groupId,
    actorId: activityActorId,
    type: "SETTLEMENT_REJECTED",
    entityType: "Settlement",
    entityId: settlementId,
    payload: {},
  });
}

export async function createSettlement(
  groupId: string,
  actorId: string,
  idempotencyKey: string,
  input: CreateSettlementInput,
) {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

  if (input.toUserId === actorId) {
    throw new ApiError(422, "VALIDATION_ERROR", "Cannot record a settlement to yourself.");
  }

  const toMembership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: input.toUserId } },
  });
  if (!toMembership || toMembership.leftAt) {
    throw new ApiError(
      422,
      "INVALID_PARTICIPANT",
      "The recipient is not an active member of this group.",
    );
  }

  const currency = input.currency ?? group.baseCurrency;
  const amountMinor = parseMoneyOrThrow(input.amount, currency);
  if (amountMinor <= 0n) {
    throw new ApiError(422, "VALIDATION_ERROR", "Settlement amount must be positive.");
  }

  const rateScaled = getRateOrThrow(currency, group.baseCurrency);
  const amountBaseMinor = convertMinor(amountMinor, currency, group.baseCurrency, rateScaled);

  const settlementId = uuidv7();
  const settledAt = input.settledAt ? new Date(input.settledAt) : new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.settlement.create({
        data: {
          id: settlementId,
          groupId,
          fromUserId: actorId,
          toUserId: input.toUserId,
          currency,
          amountMinor,
          fxRateToBase: formatRateForStorage(rateScaled),
          amountBaseMinor,
          note: input.note,
          status: "PENDING",
          settledAt,
          createdById: actorId,
          idempotencyKey,
        },
      });

      await recordActivity(tx, {
        groupId,
        actorId,
        type: "SETTLEMENT_RECORDED",
        entityType: "Settlement",
        entityId: settlementId,
        payload: { toUserId: input.toUserId, amount: input.amount, currency },
      });

      if (env.AUTO_CONFIRM_SETTLEMENTS) {
        await performConfirm(tx, settlementId, actorId);
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.settlement.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return getSettlement(existing.id, actorId);
      }
    }
    throw err;
  }

  return getSettlement(settlementId, actorId);
}

export async function listSettlements(groupId: string) {
  const rows = await prisma.settlement.findMany({
    where: { groupId },
    include: SETTLEMENT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPublicSettlement);
}

export async function getSettlement(settlementId: string, requesterId: string) {
  await loadSettlementWithMembership(settlementId, requesterId);
  const settlement = await prisma.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    include: SETTLEMENT_INCLUDE,
  });
  return toPublicSettlement(settlement);
}

export async function confirmSettlement(settlementId: string, actorId: string) {
  const { settlement } = await loadSettlementWithMembership(settlementId, actorId);
  if (settlement.toUserId !== actorId) {
    throw new ApiError(403, "FORBIDDEN", "Only the receiver can confirm a settlement.");
  }
  await prisma.$transaction((tx) => performConfirm(tx, settlementId, actorId));
  return getSettlement(settlementId, actorId);
}

export async function rejectSettlement(settlementId: string, actorId: string) {
  const { settlement } = await loadSettlementWithMembership(settlementId, actorId);
  if (settlement.toUserId !== actorId) {
    throw new ApiError(403, "FORBIDDEN", "Only the receiver can reject a settlement.");
  }
  await prisma.$transaction((tx) => performReject(tx, settlementId, actorId));
  return getSettlement(settlementId, actorId);
}

export async function uploadReceipt(
  settlementId: string,
  actorId: string,
  file: { buffer: Buffer; size: number },
) {
  const { settlement } = await loadSettlementWithMembership(settlementId, actorId);
  if (settlement.fromUserId !== actorId) {
    throw new ApiError(403, "FORBIDDEN", "Only the payer can upload a receipt for this settlement.");
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new ApiError(422, "INVALID_RECEIPT", "Receipt must be 5MB or smaller.");
  }

  const type = detectImageType(file.buffer);
  if (!type) {
    throw new ApiError(422, "INVALID_RECEIPT", "Receipt must be a JPEG, PNG, or WEBP image.");
  }

  const key = `${settlementId}.${extensionFor(type)}`;
  await storage.save(key, file.buffer, contentTypeFor(type));

  await prisma.settlement.update({ where: { id: settlementId }, data: { receiptUrl: key } });
  return getSettlement(settlementId, actorId);
}

export async function getReceipt(settlementId: string, requesterId: string) {
  const { settlement } = await loadSettlementWithMembership(settlementId, requesterId);
  if (!settlement.receiptUrl) {
    throw new ApiError(404, "RECEIPT_NOT_FOUND", "No receipt uploaded for this settlement.");
  }
  const file = await storage.read(settlement.receiptUrl);
  if (!file) {
    throw new ApiError(404, "RECEIPT_NOT_FOUND", "Receipt file is missing.");
  }
  return file;
}
