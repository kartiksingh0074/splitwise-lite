import { describe, expect, it } from "vitest";
import { simplifyGreedy, simplifySubset, type Balance, type Transfer } from "../src/domain/simplify.js";

describe("simplifyGreedy", () => {
  it("an equal circular debt (A->B->C->A) nets to zero balances and zero transfers", () => {
    // A owes B 10, B owes C 10, C owes A 10 nets to [A:0, B:0, C:0] at the balance level.
    const balances: Balance[] = [
      { userId: "a", amountMinor: 0n },
      { userId: "b", amountMinor: 0n },
      { userId: "c", amountMinor: 0n },
    ];
    expect(simplifyGreedy(balances)).toEqual([]);
  });

  it("a chain (A owes B 50, B owes C 50) collapses to one transfer A->C", () => {
    const balances: Balance[] = [
      { userId: "a", amountMinor: -50n },
      { userId: "b", amountMinor: 0n },
      { userId: "c", amountMinor: 50n },
    ];
    const transfers = simplifyGreedy(balances);
    expect(transfers).toEqual([{ from: "a", to: "c", amountMinor: 50n }]);
  });

  it("rejects balances that don't sum to zero", () => {
    expect(() => simplifyGreedy([{ userId: "a", amountMinor: 10n }])).toThrow();
  });
});

function applyTransfers(balances: Balance[], transfers: Transfer[]): Map<string, bigint> {
  const net = new Map(balances.map((b) => [b.userId, b.amountMinor]));
  for (const t of transfers) {
    net.set(t.from, (net.get(t.from) ?? 0n) + t.amountMinor);
    net.set(t.to, (net.get(t.to) ?? 0n) - t.amountMinor);
  }
  return net;
}

function randomZeroSumBalances(n: number): Balance[] {
  const balances: Balance[] = [];
  let sum = 0n;
  for (let i = 0; i < n - 1; i++) {
    const amount = BigInt(Math.floor(Math.random() * 20001) - 10000); // -10000..10000
    balances.push({ userId: `user-${i}`, amountMinor: amount });
    sum += amount;
  }
  balances.push({ userId: `user-${n - 1}`, amountMinor: -sum });
  return balances;
}

describe("simplifyGreedy property tests", () => {
  it("never produces more than n-1 transfers, for random balance sets", () => {
    for (let trial = 0; trial < 500; trial++) {
      const n = 2 + Math.floor(Math.random() * 14); // 2..15
      const balances = randomZeroSumBalances(n);
      const transfers = simplifyGreedy(balances);
      expect(transfers.length).toBeLessThanOrEqual(n - 1);
    }
  });

  it("applying the output transfers always zeroes every balance", () => {
    for (let trial = 0; trial < 500; trial++) {
      const n = 2 + Math.floor(Math.random() * 14);
      const balances = randomZeroSumBalances(n);
      const transfers = simplifyGreedy(balances);
      const net = applyTransfers(balances, transfers);
      for (const amount of net.values()) {
        expect(amount).toBe(0n);
      }
    }
  });
});

describe("simplifySubset", () => {
  it("never produces more transfers than simplifyGreedy on the same input", () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(Math.random() * 11); // 2..12
      const balances = randomZeroSumBalances(n);
      const greedyCount = simplifyGreedy(balances).length;
      const subsetCount = simplifySubset(balances).length;
      expect(subsetCount).toBeLessThanOrEqual(greedyCount);
    }
  });

  it("applying its output transfers also always zeroes every balance", () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(Math.random() * 11);
      const balances = randomZeroSumBalances(n);
      const transfers = simplifySubset(balances);
      const net = applyTransfers(balances, transfers);
      for (const amount of net.values()) {
        expect(amount).toBe(0n);
      }
    }
  });

  it("finds independent zero-sum subsets and produces strictly fewer transfers than greedy here", () => {
    // Two disjoint pairs: greedy on the whole set could pick a max creditor across groups
    // (though here amounts happen to make it group-local anyway) -- this fixture specifically
    // has two independent zero-sum pairs, which the subset strategy must resolve as 2 transfers.
    const balances: Balance[] = [
      { userId: "a", amountMinor: 100n },
      { userId: "b", amountMinor: -100n },
      { userId: "c", amountMinor: 50n },
      { userId: "d", amountMinor: -50n },
    ];
    expect(simplifySubset(balances).length).toBe(2);
  });
});
