import { getCurrencyDecimals, parseScaledDecimal } from "./money.js";

export class FxError extends Error {}

/** All rates are represented as an integer scaled by RATE_SCALE (1e8), matching the schema's Decimal(18,8). */
export const RATE_SCALE = 100_000_000n;

// Static, USD-pivoted table. Phase 8 swaps this for a real RateProvider (daily cache, live
// fetch) behind the same interface — historical expenses keep their snapshotted rate regardless.
const USD_RATES: Record<string, string> = {
  USD: "1",
  EUR: "0.92",
  GBP: "0.79",
  INR: "83.10",
  JPY: "149.50",
};

export interface RateProvider {
  /** Returns the from->to rate, scaled by RATE_SCALE. */
  getRate(from: string, to: string): bigint;
}

function usdRate(currency: string): bigint {
  const raw = USD_RATES[currency.toUpperCase()];
  if (raw === undefined) {
    throw new FxError(`No FX rate available for currency: ${currency}`);
  }
  return parseScaledDecimal(raw, 8);
}

export class StaticRateProvider implements RateProvider {
  getRate(from: string, to: string): bigint {
    if (from.toUpperCase() === to.toUpperCase()) {
      return RATE_SCALE;
    }
    const fromPerUsd = usdRate(from);
    const toPerUsd = usdRate(to);
    // from -> USD -> to :  rate = toPerUsd / fromPerUsd
    return (toPerUsd * RATE_SCALE) / fromPerUsd;
  }
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r * 2n >= denominator ? q + 1n : q;
}

/** Converts an amount in minor units of `from` into minor units of `to`, given a RATE_SCALE-scaled rate. */
export function convertMinor(
  amountMinor: bigint,
  from: string,
  to: string,
  rateScaled: bigint,
): bigint {
  const fromDecimals = BigInt(getCurrencyDecimals(from));
  const toDecimals = BigInt(getCurrencyDecimals(to));

  const numerator = amountMinor * rateScaled * 10n ** toDecimals;
  const denominator = RATE_SCALE * 10n ** fromDecimals;
  return divRoundHalfUp(numerator, denominator);
}

/** Formats a RATE_SCALE-scaled rate as a decimal string for the Prisma Decimal(18,8) column. */
export function formatRateForStorage(rateScaled: bigint): string {
  const whole = rateScaled / RATE_SCALE;
  const fraction = (rateScaled % RATE_SCALE).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
}
