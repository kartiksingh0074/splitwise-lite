export interface Balance {
  userId: string;
  amountMinor: bigint;
}

export interface Transfer {
  from: string;
  to: string;
  amountMinor: bigint;
}

class SimplifyError extends Error {}

function assertBalancesSumToZero(balances: Balance[]): void {
  const sum = balances.reduce((acc, b) => acc + b.amountMinor, 0n);
  if (sum !== 0n) {
    throw new SimplifyError(`Balances must sum to zero, got ${sum}`);
  }
}

/**
 * Greedy max-creditor / max-debtor matching (project.md §4.3). Each iteration fully zeroes at
 * least one side, so this produces at most n-1 transfers. The true minimum-transfer problem is
 * NP-hard (reduces to set partition) -- this is a heuristic, not an optimum.
 *
 * Group sizes are small, so plain arrays re-sorted each iteration (O(n^2 log n)) are used
 * instead of a real heap -- simpler, and fast enough at this scale.
 */
export function simplifyGreedy(balances: Balance[]): Transfer[] {
  assertBalancesSumToZero(balances);

  const creditors = balances
    .filter((b) => b.amountMinor > 0n)
    .map((b) => ({ userId: b.userId, amountMinor: b.amountMinor }));
  const debtors = balances
    .filter((b) => b.amountMinor < 0n)
    .map((b) => ({ userId: b.userId, amountMinor: -b.amountMinor }));

  const byAmountDesc = (a: { amountMinor: bigint }, b: { amountMinor: bigint }) =>
    a.amountMinor < b.amountMinor ? 1 : a.amountMinor > b.amountMinor ? -1 : 0;

  const transfers: Transfer[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDesc);
    debtors.sort(byAmountDesc);

    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = c.amountMinor < d.amountMinor ? c.amountMinor : d.amountMinor;

    transfers.push({ from: d.userId, to: c.userId, amountMinor: amount });

    c.amountMinor -= amount;
    d.amountMinor -= amount;

    if (c.amountMinor === 0n) creditors.shift();
    if (d.amountMinor === 0n) debtors.shift();
  }

  return transfers;
}

/** Precomputes, for every subset mask of `amounts`, the sum of the amounts it contains. */
function computeSubsetSums(amounts: bigint[]): bigint[] {
  const size = 1 << amounts.length;
  const sums = new Array<bigint>(size).fill(0n);
  for (let mask = 1; mask < size; mask++) {
    const lowBit = mask & -mask;
    const idx = Math.log2(lowBit);
    sums[mask] = sums[mask ^ lowBit]! + amounts[idx]!;
  }
  return sums;
}

/**
 * Partitions all indices [0, n) into the maximum number of disjoint zero-sum groups, via
 * submask-of-submask DP (~3^n operations; fine up to n=12). The full set is guaranteed
 * partitionable (it sums to zero as a whole, by the caller's ledger invariant), so this always
 * succeeds, worst case as a single group.
 */
function findMaxZeroSumPartition(amounts: bigint[]): number[][] {
  const n = amounts.length;
  const full = (1 << n) - 1;
  const sums = computeSubsetSums(amounts);

  const bestCount = new Array<number>(1 << n).fill(-1);
  const choice = new Array<number>(1 << n).fill(0);
  bestCount[0] = 0;

  for (let mask = 1; mask <= full; mask++) {
    const lowBit = mask & -mask;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if ((sub & lowBit) === 0 || sums[sub] !== 0n) continue;
      const rest = mask ^ sub;
      if (bestCount[rest] === -1) continue;
      const count = bestCount[rest]! + 1;
      if (count > bestCount[mask]!) {
        bestCount[mask] = count;
        choice[mask] = sub;
      }
    }
  }

  const groups: number[][] = [];
  let mask = full;
  while (mask > 0) {
    const sub = choice[mask]!;
    const group: number[] = [];
    for (let i = 0; i < n; i++) if (sub & (1 << i)) group.push(i);
    groups.push(group);
    mask ^= sub;
  }
  return groups;
}

const SUBSET_STRATEGY_MAX_N = 12;

/**
 * Refinement over simplifyGreedy for small groups (project.md §4.3): first splits the balances
 * into independent zero-sum subsets (no transfer is ever needed *between* two such subsets),
 * then runs the greedy algorithm within each. This can only produce fewer-or-equal transfers
 * than running greedy on the whole set. Falls back to simplifyGreedy above SUBSET_STRATEGY_MAX_N
 * non-zero balances, where the O(3^n) partition search stops being cheap.
 */
export function simplifySubset(balances: Balance[]): Transfer[] {
  assertBalancesSumToZero(balances);

  const nonZero = balances.filter((b) => b.amountMinor !== 0n);
  if (nonZero.length === 0) return [];
  if (nonZero.length > SUBSET_STRATEGY_MAX_N) return simplifyGreedy(balances);

  const groups = findMaxZeroSumPartition(nonZero.map((b) => b.amountMinor));

  const transfers: Transfer[] = [];
  for (const group of groups) {
    transfers.push(...simplifyGreedy(group.map((i) => nonZero[i]!)));
  }
  return transfers;
}
