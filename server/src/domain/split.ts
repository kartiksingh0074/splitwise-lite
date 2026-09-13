import { createHash } from "node:crypto";
import { parseScaledDecimal as parseScaledDecimalRaw } from "./money.js";

export type SplitType = "EQUAL" | "EXACT" | "PERCENT" | "SHARES";

export class SplitError extends Error {}

export interface ComputeSplitParams {
  totalMinor: bigint;
  participants: string[];
  splitType: SplitType;
  /** Raw per-participant input: minor-unit integer (EXACT), percentage (PERCENT), or share weight (SHARES). */
  inputs?: Record<string, string>;
  /** Seeds the deterministic remainder rotation for EQUAL (e.g. the expense id). */
  seed: string;
}

function parseScaledDecimal(value: string, scale: number): bigint {
  try {
    return parseScaledDecimalRaw(value, scale);
  } catch (err) {
    // money.ts's parseScaledDecimal only ever throws a real Error.
    throw new SplitError((err as Error).message);
  }
}

function parseNonNegativeInteger(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new SplitError(`Invalid non-negative integer: ${value}`);
  }
  return BigInt(value);
}

// Both helpers below are only ever called from computeEqual, which is only reached after
// computeSplit's own "at least one participant" guard -- n is always >= 1 here.
function rotate<T>(arr: T[], offset: number): T[] {
  const n = arr.length;
  const o = ((offset % n) + n) % n;
  return [...arr.slice(o), ...arr.slice(0, o)];
}

function seedRotation(seed: string, n: number): number {
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0) % n;
}

function computeEqual(totalMinor: bigint, participants: string[], seed: string): Map<string, bigint> {
  const n = BigInt(participants.length);
  const base = totalMinor / n;
  const remainder = totalMinor - base * n;

  const sorted = [...participants].sort();
  const result = new Map<string, bigint>();
  for (const p of sorted) result.set(p, base);

  const rotated = rotate(sorted, seedRotation(seed, sorted.length));
  for (let i = 0; i < Number(remainder); i++) {
    const user = rotated[i]!;
    result.set(user, result.get(user)! + 1n);
  }

  return result;
}

function computeExact(
  totalMinor: bigint,
  participants: string[],
  inputs: Record<string, string>,
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  let sum = 0n;

  for (const p of participants) {
    const raw = inputs[p];
    if (raw === undefined) throw new SplitError(`Missing exact amount for participant ${p}`);
    const value = parseNonNegativeInteger(raw);
    result.set(p, value);
    sum += value;
  }

  if (sum !== totalMinor) {
    throw new SplitError(`Exact split sums to ${sum}, expected ${totalMinor}`);
  }

  return result;
}

/** Allocates totalMinor proportionally to each participant's weight, exactly, via largest-remainder. */
function largestRemainderAllocate(
  totalMinor: bigint,
  participants: string[],
  weightOf: (p: string) => bigint,
): Map<string, bigint> {
  const weightSum = participants.reduce((sum, p) => sum + weightOf(p), 0n);
  if (weightSum <= 0n) {
    throw new SplitError("Total weight must be positive");
  }

  const floors = new Map<string, bigint>();
  const remainders: { p: string; rem: bigint }[] = [];
  let allocated = 0n;

  // weightOf's two current callers (computeShares' parseNonNegativeInteger, computePercent's
  // explicit check) both already guarantee a non-negative weight before it reaches here.
  for (const p of participants) {
    const w = weightOf(p);
    const product = totalMinor * w;
    const floor = product / weightSum;
    const rem = product % weightSum;
    floors.set(p, floor);
    remainders.push({ p, rem });
    allocated += floor;
  }

  let leftover = totalMinor - allocated;

  // Participants are always unique (computeSplit rejects duplicates), so a.p === b.p can't happen.
  remainders.sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return a.p < b.p ? -1 : 1;
  });

  for (let i = 0; i < remainders.length && leftover > 0n; i++) {
    const p = remainders[i]!.p;
    floors.set(p, floors.get(p)! + 1n);
    leftover -= 1n;
  }

  return floors;
}

const PERCENT_SCALE = 2;
const PERCENT_TOLERANCE = 1n; // ±0.01 at PERCENT_SCALE=2

function computePercent(
  totalMinor: bigint,
  participants: string[],
  inputs: Record<string, string>,
): Map<string, bigint> {
  const scaled = new Map<string, bigint>();
  let sum = 0n;

  for (const p of participants) {
    const raw = inputs[p];
    if (raw === undefined) throw new SplitError(`Missing percent for participant ${p}`);
    const value = parseScaledDecimal(raw, PERCENT_SCALE);
    if (value < 0n) throw new SplitError(`Percent for ${p} must be non-negative`);
    scaled.set(p, value);
    sum += value;
  }

  const target = 100n * 10n ** BigInt(PERCENT_SCALE);
  if (sum < target - PERCENT_TOLERANCE || sum > target + PERCENT_TOLERANCE) {
    throw new SplitError(`Percent split sums to ${sum}, expected ~${target} (tolerance ${PERCENT_TOLERANCE})`);
  }

  return largestRemainderAllocate(totalMinor, participants, (p) => scaled.get(p)!);
}

function computeShares(
  totalMinor: bigint,
  participants: string[],
  inputs: Record<string, string>,
): Map<string, bigint> {
  const shares = new Map<string, bigint>();

  for (const p of participants) {
    const raw = inputs[p];
    if (raw === undefined) throw new SplitError(`Missing share weight for participant ${p}`);
    shares.set(p, parseNonNegativeInteger(raw));
  }

  return largestRemainderAllocate(totalMinor, participants, (p) => shares.get(p)!);
}

export function computeSplit(params: ComputeSplitParams): Map<string, bigint> {
  const { totalMinor, participants, splitType, inputs, seed } = params;

  if (participants.length === 0) {
    throw new SplitError("At least one participant is required");
  }
  if (new Set(participants).size !== participants.length) {
    throw new SplitError("Duplicate participant in split");
  }
  if (totalMinor < 0n) {
    throw new SplitError("Total must be non-negative");
  }

  switch (splitType) {
    case "EQUAL":
      return computeEqual(totalMinor, participants, seed);
    case "EXACT":
      return computeExact(totalMinor, participants, inputs ?? {});
    case "PERCENT":
      return computePercent(totalMinor, participants, inputs ?? {});
    case "SHARES":
      return computeShares(totalMinor, participants, inputs ?? {});
  }
}
