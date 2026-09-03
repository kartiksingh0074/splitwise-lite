import { prisma } from "../../db/client.js";
import { formatMinor } from "../../domain/money.js";
import { simplifyGreedy, simplifySubset, type Balance } from "../../domain/simplify.js";

async function getBaseCurrency(groupId: string): Promise<string> {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { baseCurrency: true },
  });
  return group.baseCurrency;
}

/** Net balance per active group member, defaulting to 0 for members with no ledger activity yet. */
async function getRawNetBalances(groupId: string): Promise<{ userId: string; name: string; amountMinor: bigint }[]> {
  const [members, sums] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId, leftAt: null },
      include: { user: { select: { name: true } } },
    }),
    prisma.ledgerEntry.groupBy({
      by: ["userId"],
      where: { groupId },
      _sum: { amountBaseMinor: true },
    }),
  ]);

  const sumByUser = new Map(sums.map((s) => [s.userId, s._sum.amountBaseMinor ?? 0n]));

  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    amountMinor: sumByUser.get(m.userId) ?? 0n,
  }));
}

export async function getUserNetBalance(groupId: string, userId: string): Promise<bigint> {
  const result = await prisma.ledgerEntry.aggregate({
    where: { groupId, userId },
    _sum: { amountBaseMinor: true },
  });
  return result._sum.amountBaseMinor ?? 0n;
}

/**
 * Derives "who owes whom" directly from current, non-deleted Expense/ExpensePayer/ExpenseSplit
 * rows -- not replayed from LedgerEntry history. A participant's share of an expense is
 * distributed across that expense's payers proportional to their contribution, then netted per
 * unordered pair across the whole group. Informational only (floor-rounded per pair) -- the net
 * balance from LedgerEntry remains the source of truth for money.
 */
async function getRawPairwiseView(
  groupId: string,
): Promise<{ from: string; to: string; amountMinor: bigint }[]> {
  const expenses = await prisma.expense.findMany({
    where: { groupId, deletedAt: null },
    select: {
      payers: { select: { userId: true, amountBaseMinor: true } },
      splits: { select: { userId: true, amountBaseMinor: true } },
    },
  });

  const owed = new Map<string, Map<string, bigint>>();
  const addDebt = (debtor: string, creditor: string, amount: bigint) => {
    if (amount <= 0n || debtor === creditor) return;
    const row = owed.get(debtor) ?? new Map<string, bigint>();
    row.set(creditor, (row.get(creditor) ?? 0n) + amount);
    owed.set(debtor, row);
  };

  for (const expense of expenses) {
    const payerTotal = expense.payers.reduce((sum, p) => sum + p.amountBaseMinor, 0n);
    if (payerTotal <= 0n) continue;

    for (const split of expense.splits) {
      for (const payer of expense.payers) {
        if (payer.userId === split.userId) continue;
        const share = (split.amountBaseMinor * payer.amountBaseMinor) / payerTotal;
        addDebt(split.userId, payer.userId, share);
      }
    }
  }

  const netted: { from: string; to: string; amountMinor: bigint }[] = [];
  const seenPairs = new Set<string>();

  for (const [debtor, row] of owed) {
    for (const [creditor] of row) {
      const pairKey = [debtor, creditor].sort().join(":");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const forward = row.get(creditor) ?? 0n;
      const backward = owed.get(creditor)?.get(debtor) ?? 0n;
      const net = forward - backward;

      if (net > 0n) netted.push({ from: debtor, to: creditor, amountMinor: net });
      else if (net < 0n) netted.push({ from: creditor, to: debtor, amountMinor: -net });
    }
  }

  return netted;
}

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function getBalances(groupId: string) {
  const baseCurrency = await getBaseCurrency(groupId);
  const [net, pairwise] = await Promise.all([
    getRawNetBalances(groupId),
    getRawPairwiseView(groupId),
  ]);

  const names = await namesFor(pairwise.flatMap((p) => [p.from, p.to]));

  return {
    net: net.map((b) => ({
      userId: b.userId,
      name: b.name,
      amount: formatMinor(b.amountMinor, baseCurrency),
    })),
    pairwise: pairwise.map((p) => ({
      from: p.from,
      fromName: names.get(p.from) ?? "",
      to: p.to,
      toName: names.get(p.to) ?? "",
      amount: formatMinor(p.amountMinor, baseCurrency),
    })),
  };
}

export async function getSettlePlan(groupId: string, strategy: "greedy" | "subset") {
  const baseCurrency = await getBaseCurrency(groupId);
  const net = await getRawNetBalances(groupId);
  const balances: Balance[] = net.map((b) => ({ userId: b.userId, amountMinor: b.amountMinor }));

  const transfers = strategy === "subset" ? simplifySubset(balances) : simplifyGreedy(balances);
  const pairwise = await getRawPairwiseView(groupId);
  const names = await namesFor(transfers.flatMap((t) => [t.from, t.to]));

  return {
    strategy,
    transfers: transfers.map((t) => ({
      from: t.from,
      fromName: names.get(t.from) ?? "",
      to: t.to,
      toName: names.get(t.to) ?? "",
      amount: formatMinor(t.amountMinor, baseCurrency),
    })),
    transferCount: transfers.length,
    naiveCount: pairwise.length,
  };
}
