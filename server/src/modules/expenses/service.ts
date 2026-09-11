import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/client.js";
import { uuidv7 } from "../../lib/id.js";
import { recordActivity } from "../../lib/activity.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { formatMinor, parseMinor } from "../../domain/money.js";
import { computeSplit, SplitError } from "../../domain/split.js";
import { rateProvider, convertMinor, formatRateForStorage, FxError } from "../../domain/fx.js";
import type { expenseWriteSchema, listExpensesQuerySchema } from "./schemas.js";

type ExpenseInput = z.infer<typeof expenseWriteSchema>;
type ListQuery = z.infer<typeof listExpensesQuerySchema>;

const EXPENSE_INCLUDE = {
  group: { select: { baseCurrency: true } },
  payers: { include: { user: { select: { id: true, name: true } } } },
  splits: { include: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

function runSplit<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SplitError) {
      throw new ApiError(422, "SPLIT_MISMATCH", err.message);
    }
    throw err;
  }
}

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

function buildInputsRecord(splits: ExpenseInput["splits"]): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const s of splits) {
    if (s.input !== undefined) inputs[s.userId] = s.input;
  }
  return inputs;
}

/** Same computeSplit function allocates payers: equally if no amounts given, else EXACT against the provided amounts. */
function buildPayerAllocation(
  expenseId: string,
  currency: string,
  amountMinor: bigint,
  payers: ExpenseInput["payers"],
): Map<string, bigint> {
  const participants = payers.map((p) => p.userId);
  if (payers.every((p) => p.amount === undefined)) {
    return computeSplit({
      totalMinor: amountMinor,
      participants,
      splitType: "EQUAL",
      seed: `${expenseId}:payers`,
    });
  }

  const inputs: Record<string, string> = {};
  for (const p of payers) {
    inputs[p.userId] = parseMoneyOrThrow(p.amount!, currency).toString();
  }
  return computeSplit({
    totalMinor: amountMinor,
    participants,
    splitType: "EXACT",
    inputs,
    seed: `${expenseId}:payers`,
  });
}

/**
 * Re-splits `totalMinor` (the base-currency total) in the same proportions as `originalAmounts`
 * (the original-currency per-user amounts), using computeSplit's SHARES allocation with those
 * amounts as weights. Guarantees the result sums exactly to totalMinor via largest-remainder,
 * independent of per-user FX rounding drift.
 */
function rescaleToBase(
  originalAmounts: Map<string, bigint>,
  totalMinor: bigint,
  seed: string,
): Map<string, bigint> {
  const participants = [...originalAmounts.keys()];
  const inputs: Record<string, string> = {};
  for (const [userId, amount] of originalAmounts) inputs[userId] = amount.toString();
  return computeSplit({ totalMinor, participants, splitType: "SHARES", inputs, seed });
}

async function assertActiveMembers(groupId: string, userIds: Set<string>) {
  const members = await prisma.groupMember.findMany({
    where: { groupId, userId: { in: [...userIds] }, leftAt: null },
    select: { userId: true },
  });
  if (members.length !== userIds.size) {
    throw new ApiError(
      422,
      "INVALID_PARTICIPANT",
      "One or more participants are not active members of this group.",
    );
  }
}

interface PreparedExpenseWrite {
  amountMinor: bigint;
  rateScaled: bigint;
  amountBaseMinor: bigint;
  splitsMap: Map<string, bigint>;
  payersMap: Map<string, bigint>;
  splitsBaseMap: Map<string, bigint>;
  payersBaseMap: Map<string, bigint>;
}

function prepareExpenseWrite(
  baseCurrency: string,
  expenseId: string,
  input: ExpenseInput,
): PreparedExpenseWrite {
  const amountMinor = parseMoneyOrThrow(input.amount, input.currency);
  if (amountMinor <= 0n) {
    throw new ApiError(422, "VALIDATION_ERROR", "Expense amount must be positive.");
  }

  const rateScaled = getRateOrThrow(input.currency, baseCurrency);
  const amountBaseMinor = convertMinor(amountMinor, input.currency, baseCurrency, rateScaled);

  const splitsMap = runSplit(() =>
    computeSplit({
      totalMinor: amountMinor,
      participants: input.splits.map((s) => s.userId),
      splitType: input.splitType,
      inputs: buildInputsRecord(input.splits),
      seed: expenseId,
    }),
  );

  const payersMap = runSplit(() =>
    buildPayerAllocation(expenseId, input.currency, amountMinor, input.payers),
  );

  const splitsBaseMap = runSplit(() =>
    rescaleToBase(splitsMap, amountBaseMinor, `${expenseId}:splits-base`),
  );
  const payersBaseMap = runSplit(() =>
    rescaleToBase(payersMap, amountBaseMinor, `${expenseId}:payers-base`),
  );

  return { amountMinor, rateScaled, amountBaseMinor, splitsMap, payersMap, splitsBaseMap, payersBaseMap };
}

async function writeExpenseLedgerEntries(
  tx: Prisma.TransactionClient,
  params: {
    expenseId: string;
    groupId: string;
    payersBase: Map<string, bigint>;
    splitsBase: Map<string, bigint>;
  },
) {
  const rows: Prisma.LedgerEntryCreateManyInput[] = [];

  for (const [userId, amount] of params.payersBase) {
    rows.push({
      id: uuidv7(),
      groupId: params.groupId,
      userId,
      amountBaseMinor: amount,
      sourceType: "EXPENSE",
      sourceId: params.expenseId,
    });
  }
  for (const [userId, amount] of params.splitsBase) {
    rows.push({
      id: uuidv7(),
      groupId: params.groupId,
      userId,
      amountBaseMinor: -amount,
      sourceType: "EXPENSE",
      sourceId: params.expenseId,
    });
  }

  await tx.ledgerEntry.createMany({ data: rows });
}

/** Zeroes out this expense's net-to-date ledger contribution, regardless of how many prior edits ran. */
async function reverseExistingLedger(tx: Prisma.TransactionClient, expenseId: string, groupId: string) {
  const nets = await tx.ledgerEntry.groupBy({
    by: ["userId"],
    where: { sourceId: expenseId },
    _sum: { amountBaseMinor: true },
  });

  const rows = nets
    .filter((n) => (n._sum.amountBaseMinor ?? 0n) !== 0n)
    .map((n) => ({
      id: uuidv7(),
      groupId,
      userId: n.userId,
      amountBaseMinor: -(n._sum.amountBaseMinor ?? 0n),
      sourceType: "EXPENSE_REVERSAL" as const,
      sourceId: expenseId,
    }));

  if (rows.length > 0) {
    await tx.ledgerEntry.createMany({ data: rows });
  }
}

function toPublicExpense(expense: ExpenseWithRelations) {
  const baseCurrency = expense.group.baseCurrency;
  return {
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    category: expense.category,
    currency: expense.currency,
    amount: formatMinor(expense.amountMinor, expense.currency),
    baseCurrency,
    amountBase: formatMinor(expense.amountBaseMinor, baseCurrency),
    fxRateToBase: expense.fxRateToBase.toString(),
    splitType: expense.splitType,
    paidAt: expense.paidAt,
    createdById: expense.createdById,
    version: expense.version,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    payers: expense.payers.map((p) => ({
      userId: p.userId,
      name: p.user.name,
      amount: formatMinor(p.amountMinor, expense.currency),
      amountBase: formatMinor(p.amountBaseMinor, baseCurrency),
    })),
    splits: expense.splits.map((s) => ({
      userId: s.userId,
      name: s.user.name,
      amount: formatMinor(s.amountMinor, expense.currency),
      amountBase: formatMinor(s.amountBaseMinor, baseCurrency),
      // The raw input as originally entered (EXACT minor units / PERCENT / SHARES) — kept for
      // re-editing per project.md's schema comment; null for EQUAL, which has no raw input.
      input: s.shareInput?.toString() ?? null,
    })),
  };
}

async function loadExpenseWithMembership(expenseId: string, userId: string) {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense || expense.deletedAt) {
    throw new ApiError(404, "NOT_FOUND", "Expense not found.");
  }
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: expense.groupId, userId } },
  });
  if (!membership || membership.leftAt) {
    throw new ApiError(404, "NOT_FOUND", "Expense not found.");
  }
  return { expense, membership };
}

export async function createExpense(groupId: string, actorId: string, input: ExpenseInput) {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

  const participantIds = new Set([
    ...input.splits.map((s) => s.userId),
    ...input.payers.map((p) => p.userId),
  ]);
  await assertActiveMembers(groupId, participantIds);

  const expenseId = uuidv7();
  const prepared = prepareExpenseWrite(group.baseCurrency, expenseId, input);

  await prisma.$transaction(async (tx) => {
    await tx.expense.create({
      data: {
        id: expenseId,
        groupId,
        description: input.description,
        category: input.category,
        currency: input.currency,
        amountMinor: prepared.amountMinor,
        fxRateToBase: formatRateForStorage(prepared.rateScaled),
        amountBaseMinor: prepared.amountBaseMinor,
        splitType: input.splitType,
        paidAt: new Date(input.paidAt),
        createdById: actorId,
      },
    });

    await tx.expensePayer.createMany({
      data: [...prepared.payersMap.entries()].map(([userId, amount]) => ({
        expenseId,
        userId,
        amountMinor: amount,
        amountBaseMinor: prepared.payersBaseMap.get(userId)!,
      })),
    });

    await tx.expenseSplit.createMany({
      data: [...prepared.splitsMap.entries()].map(([userId, amount]) => ({
        expenseId,
        userId,
        amountMinor: amount,
        amountBaseMinor: prepared.splitsBaseMap.get(userId)!,
        shareInput: input.splits.find((s) => s.userId === userId)?.input ?? null,
      })),
    });

    await writeExpenseLedgerEntries(tx, {
      expenseId,
      groupId,
      payersBase: prepared.payersBaseMap,
      splitsBase: prepared.splitsBaseMap,
    });

    await recordActivity(tx, {
      groupId,
      actorId,
      type: "EXPENSE_ADDED",
      entityType: "Expense",
      entityId: expenseId,
      payload: { description: input.description, amount: input.amount, currency: input.currency },
    });
  });

  return getExpense(expenseId, actorId);
}

export async function listExpenses(groupId: string, query: ListQuery) {
  const where: Prisma.ExpenseWhereInput = {
    groupId,
    deletedAt: null,
    ...(query.paidBy ? { payers: { some: { userId: query.paidBy } } } : {}),
    ...(query.from || query.to
      ? {
          paidAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const rows = await prisma.expense.findMany({
    where,
    include: EXPENSE_INCLUDE,
    orderBy: [{ paidAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  return { expenses: page.map(toPublicExpense), nextCursor };
}

type ExpenseFieldChange = { before: string | null; after: string | null };

/** Before/after diff of Expense's own scalar fields (not the payer/split composition). */
function buildExpenseDiff(
  before: { description: string; category: string | null; currency: string; amountMinor: bigint; splitType: string; paidAt: Date },
  input: ExpenseInput,
): Record<string, ExpenseFieldChange> {
  const changes: Record<string, ExpenseFieldChange> = {};

  const beforeAmount = formatMinor(before.amountMinor, before.currency);
  const beforePaidAt = before.paidAt.toISOString();
  const afterPaidAt = new Date(input.paidAt).toISOString();
  const beforeCategory = before.category ?? null;
  const afterCategory = input.category ?? null;

  if (before.description !== input.description) {
    changes.description = { before: before.description, after: input.description };
  }
  if (beforeCategory !== afterCategory) {
    changes.category = { before: beforeCategory, after: afterCategory };
  }
  if (before.currency !== input.currency) {
    changes.currency = { before: before.currency, after: input.currency };
  }
  if (beforeAmount !== input.amount) {
    changes.amount = { before: beforeAmount, after: input.amount };
  }
  if (before.splitType !== input.splitType) {
    changes.splitType = { before: before.splitType, after: input.splitType };
  }
  if (beforePaidAt !== afterPaidAt) {
    changes.paidAt = { before: beforePaidAt, after: afterPaidAt };
  }

  return changes;
}

export async function getExpense(expenseId: string, userId: string) {
  await loadExpenseWithMembership(expenseId, userId);
  const expense = await prisma.expense.findUniqueOrThrow({
    where: { id: expenseId },
    include: EXPENSE_INCLUDE,
  });
  return toPublicExpense(expense);
}

export async function updateExpense(
  expenseId: string,
  actorId: string,
  ifMatchVersion: number,
  input: ExpenseInput,
) {
  const { expense, membership } = await loadExpenseWithMembership(expenseId, actorId);
  if (expense.createdById !== actorId && membership.role !== "OWNER") {
    throw new ApiError(403, "FORBIDDEN", "Only the expense's creator or the group owner can do that.");
  }
  if (expense.version !== ifMatchVersion) {
    throw new ApiError(409, "STALE_VERSION", "Expense has changed since you last loaded it.");
  }

  const group = await prisma.group.findUniqueOrThrow({ where: { id: expense.groupId } });

  const participantIds = new Set([
    ...input.splits.map((s) => s.userId),
    ...input.payers.map((p) => p.userId),
  ]);
  await assertActiveMembers(expense.groupId, participantIds);

  const prepared = prepareExpenseWrite(group.baseCurrency, expenseId, input);
  const changes = buildExpenseDiff(expense, input);

  await prisma.$transaction(async (tx) => {
    await reverseExistingLedger(tx, expenseId, expense.groupId);

    await tx.expensePayer.deleteMany({ where: { expenseId } });
    await tx.expenseSplit.deleteMany({ where: { expenseId } });

    await tx.expensePayer.createMany({
      data: [...prepared.payersMap.entries()].map(([userId, amount]) => ({
        expenseId,
        userId,
        amountMinor: amount,
        amountBaseMinor: prepared.payersBaseMap.get(userId)!,
      })),
    });

    await tx.expenseSplit.createMany({
      data: [...prepared.splitsMap.entries()].map(([userId, amount]) => ({
        expenseId,
        userId,
        amountMinor: amount,
        amountBaseMinor: prepared.splitsBaseMap.get(userId)!,
        shareInput: input.splits.find((s) => s.userId === userId)?.input ?? null,
      })),
    });

    await writeExpenseLedgerEntries(tx, {
      expenseId,
      groupId: expense.groupId,
      payersBase: prepared.payersBaseMap,
      splitsBase: prepared.splitsBaseMap,
    });

    await tx.expense.update({
      where: { id: expenseId },
      data: {
        description: input.description,
        category: input.category,
        currency: input.currency,
        amountMinor: prepared.amountMinor,
        fxRateToBase: formatRateForStorage(prepared.rateScaled),
        amountBaseMinor: prepared.amountBaseMinor,
        splitType: input.splitType,
        paidAt: new Date(input.paidAt),
        version: { increment: 1 },
      },
    });

    await recordActivity(tx, {
      groupId: expense.groupId,
      actorId,
      type: "EXPENSE_EDITED",
      entityType: "Expense",
      entityId: expenseId,
      payload: { changes },
    });
  });

  return getExpense(expenseId, actorId);
}

export async function deleteExpense(expenseId: string, actorId: string) {
  const { expense, membership } = await loadExpenseWithMembership(expenseId, actorId);
  if (expense.createdById !== actorId && membership.role !== "OWNER") {
    throw new ApiError(403, "FORBIDDEN", "Only the expense's creator or the group owner can do that.");
  }

  await prisma.$transaction(async (tx) => {
    await reverseExistingLedger(tx, expenseId, expense.groupId);
    await tx.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date() } });
    await recordActivity(tx, {
      groupId: expense.groupId,
      actorId,
      type: "EXPENSE_DELETED",
      entityType: "Expense",
      entityId: expenseId,
      payload: { description: expense.description },
    });
  });
}
