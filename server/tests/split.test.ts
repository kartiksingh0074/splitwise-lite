import { describe, expect, it } from "vitest";
import { computeSplit, SplitError, type SplitType } from "../src/domain/split.js";

describe("computeSplit", () => {
  it("EQUAL: 100.00 split 3 ways sums exactly, leftover cent goes to exactly one person", () => {
    const result = computeSplit({
      totalMinor: 10000n,
      participants: ["a", "b", "c"],
      splitType: "EQUAL",
      seed: "expense-1",
    });

    const values = [...result.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(values).toEqual([3333n, 3333n, 3334n]);
    expect(values.reduce((a, b) => a + b, 0n)).toBe(10000n);
  });

  it("EQUAL: is deterministic for the same seed", () => {
    const params = {
      totalMinor: 10000n,
      participants: ["a", "b", "c"],
      splitType: "EQUAL" as const,
      seed: "expense-1",
    };
    const a = [...computeSplit(params).entries()];
    const b = [...computeSplit(params).entries()];
    expect(a).toEqual(b);
  });

  it("PERCENT: 33.33/33.33/33.34 sums exactly", () => {
    const result = computeSplit({
      totalMinor: 10000n,
      participants: ["a", "b", "c"],
      splitType: "PERCENT",
      inputs: { a: "33.33", b: "33.33", c: "33.34" },
      seed: "x",
    });

    expect(result.get("a")).toBe(3333n);
    expect(result.get("b")).toBe(3333n);
    expect(result.get("c")).toBe(3334n);
  });

  it("PERCENT: rejects percentages that don't sum to ~100", () => {
    expect(() =>
      computeSplit({
        totalMinor: 10000n,
        participants: ["a", "b"],
        splitType: "PERCENT",
        inputs: { a: "40", b: "40" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("EXACT: rejects amounts that don't sum to the total", () => {
    expect(() =>
      computeSplit({
        totalMinor: 10000n,
        participants: ["a", "b"],
        splitType: "EXACT",
        inputs: { a: "4000", b: "5000" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("EXACT: accepts amounts that do sum exactly", () => {
    const result = computeSplit({
      totalMinor: 10000n,
      participants: ["a", "b"],
      splitType: "EXACT",
      inputs: { a: "4000", b: "6000" },
      seed: "x",
    });
    expect(result.get("a")).toBe(4000n);
    expect(result.get("b")).toBe(6000n);
  });

  it("SHARES: allocates proportionally to integer weights", () => {
    const result = computeSplit({
      totalMinor: 10000n,
      participants: ["a", "b", "c"],
      splitType: "SHARES",
      inputs: { a: "1", b: "1", c: "2" },
      seed: "x",
    });
    expect(result.get("a")).toBe(2500n);
    expect(result.get("b")).toBe(2500n);
    expect(result.get("c")).toBe(5000n);
  });
});

describe("computeSplit: input validation", () => {
  it("rejects an empty participant list", () => {
    expect(() =>
      computeSplit({ totalMinor: 100n, participants: [], splitType: "EQUAL", seed: "x" }),
    ).toThrow(SplitError);
  });

  it("rejects a duplicate participant", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "a"],
        splitType: "EQUAL",
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("rejects a negative total", () => {
    expect(() =>
      computeSplit({
        totalMinor: -100n,
        participants: ["a", "b"],
        splitType: "EQUAL",
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("EXACT: rejects a missing input for a participant", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "EXACT",
        inputs: { a: "100" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("EXACT: rejects a non-integer input", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "EXACT",
        inputs: { a: "fifty", b: "50" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("PERCENT: rejects a missing input for a participant", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "PERCENT",
        inputs: { a: "100" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("PERCENT: rejects a malformed (non-decimal) percentage string", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "PERCENT",
        inputs: { a: "abc", b: "100" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("PERCENT: rejects a negative percentage", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "PERCENT",
        inputs: { a: "-10", b: "110" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("SHARES: rejects a missing input for a participant", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "SHARES",
        inputs: { a: "1" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("SHARES: rejects a non-integer input", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "SHARES",
        inputs: { a: "one", b: "1" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("SHARES: rejects all-zero weights (nothing to allocate proportionally)", () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        participants: ["a", "b"],
        splitType: "SHARES",
        inputs: { a: "0", b: "0" },
        seed: "x",
      }),
    ).toThrow(SplitError);
  });

  it("EXACT/PERCENT/SHARES: rejects when inputs is omitted entirely", () => {
    for (const splitType of ["EXACT", "PERCENT", "SHARES"] as const) {
      expect(() =>
        computeSplit({ totalMinor: 100n, participants: ["a", "b"], splitType, seed: "x" }),
      ).toThrow(SplitError);
    }
  });

  it("has a stable tie-break by userId when two participants share the largest remainder", () => {
    // Equal weights on a total not divisible by 3: all three remainders tie exactly, exercising
    // the tie-break comparator's a.p < b.p branch deterministically.
    const result = computeSplit({
      totalMinor: 10n,
      participants: ["c", "a", "b"],
      splitType: "SHARES",
      inputs: { a: "1", b: "1", c: "1" },
      seed: "x",
    });
    // floor(10/3) = 3 each, 1 leftover unit goes to the alphabetically-first tied participant.
    expect(result.get("a")).toBe(4n);
    expect(result.get("b")).toBe(3n);
    expect(result.get("c")).toBe(3n);
  });
});

function randomPartition(total: bigint, parts: number): bigint[] {
  if (parts === 1) return [total];
  const totalNum = Number(total);
  const cuts = new Set<number>();
  while (cuts.size < parts - 1) {
    cuts.add(Math.floor(Math.random() * (totalNum + 1)));
  }
  const sorted = [0, ...[...cuts].sort((a, b) => a - b), totalNum];
  const result: bigint[] = [];
  for (let i = 0; i < parts; i++) {
    result.push(BigInt(sorted[i + 1]! - sorted[i]!));
  }
  return result;
}

function buildInputs(
  splitType: SplitType,
  participants: string[],
  totalMinor: bigint,
): Record<string, string> | undefined {
  if (splitType === "EQUAL") return undefined;

  if (splitType === "EXACT") {
    const parts = randomPartition(totalMinor, participants.length);
    const inputs: Record<string, string> = {};
    participants.forEach((p, i) => {
      inputs[p] = parts[i]!.toString();
    });
    return inputs;
  }

  if (splitType === "PERCENT") {
    const parts = randomPartition(10000n, participants.length);
    const inputs: Record<string, string> = {};
    participants.forEach((p, i) => {
      const scaled = parts[i]!;
      const whole = scaled / 100n;
      const frac = (scaled % 100n).toString().padStart(2, "0");
      inputs[p] = `${whole}.${frac}`;
    });
    return inputs;
  }

  const inputs: Record<string, string> = {};
  participants.forEach((p) => {
    inputs[p] = String(1 + Math.floor(Math.random() * 5));
  });
  return inputs;
}

describe("computeSplit property: output always sums to the input total", () => {
  const splitTypes: SplitType[] = ["EQUAL", "EXACT", "PERCENT", "SHARES"];

  for (const splitType of splitTypes) {
    it(`${splitType}: random totals and 2-10 participants always sum exactly`, () => {
      for (let trial = 0; trial < 50; trial++) {
        const n = 2 + Math.floor(Math.random() * 9);
        const participants = Array.from({ length: n }, (_, i) => `user-${i}`);
        const totalMinor = BigInt(1 + Math.floor(Math.random() * 1_000_000));

        const result = computeSplit({
          totalMinor,
          participants,
          splitType,
          inputs: buildInputs(splitType, participants, totalMinor),
          seed: `trial-${trial}`,
        });

        const sum = [...result.values()].reduce((a, b) => a + b, 0n);
        expect(sum).toBe(totalMinor);
        expect(result.size).toBe(n);
      }
    });
  }
});
