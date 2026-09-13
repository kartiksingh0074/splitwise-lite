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

export interface RateFetcher {
  fetchRates(): Promise<Record<string, string>>;
}

/**
 * No real external FX API is named anywhere in project.md (no key, no specified provider), so
 * this wraps the same static table above, reframed as "the fetched source" -- the caching/
 * fallback machinery below is real and tested; swapping in a genuine external API later is a
 * one-file change (implement RateFetcher).
 */
export class StaticTableRateFetcher implements RateFetcher {
  async fetchRates(): Promise<Record<string, string>> {
    return USD_RATES;
  }
}

function parseRateTable(raw: Record<string, string>): Map<string, bigint> {
  const table = new Map<string, bigint>();
  for (const [currency, value] of Object.entries(raw)) {
    table.set(currency.toUpperCase(), parseScaledDecimal(value, 8));
  }
  return table;
}

/**
 * Wraps a RateFetcher with a synchronous, always-available cache: getRate() never awaits, it
 * just reads whatever's currently cached -- the same RateProvider interface every caller already
 * uses. A background interval refreshes the cache periodically; if a refresh fails, the last
 * successfully fetched table keeps serving (falling back to the constructor's seed table if no
 * refresh has ever succeeded yet) -- the "fallback to the last-known rate" project.md asks for.
 */
export class CachedRateProvider implements RateProvider {
  private table: Map<string, bigint>;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private fetcher: RateFetcher,
    options: { ttlMs?: number; autoStart?: boolean } = {},
  ) {
    const { ttlMs = 24 * 60 * 60 * 1000, autoStart = true } = options;
    this.table = parseRateTable(USD_RATES);
    if (autoStart) {
      this.timer = setInterval(() => void this.refreshNow(), ttlMs);
      this.timer.unref();
      void this.refreshNow();
    }
  }

  /** Exposed for tests to control refresh timing deterministically (construct with autoStart: false). */
  async refreshNow(): Promise<void> {
    try {
      const raw = await this.fetcher.fetchRates();
      this.table = parseRateTable(raw);
    } catch {
      // Keep serving whatever was last successfully cached (or the seed table).
    }
  }

  getRate(from: string, to: string): bigint {
    if (from.toUpperCase() === to.toUpperCase()) {
      return RATE_SCALE;
    }
    const fromPerUsd = this.table.get(from.toUpperCase());
    const toPerUsd = this.table.get(to.toUpperCase());
    if (fromPerUsd === undefined) {
      throw new FxError(`No FX rate available for currency: ${from}`);
    }
    if (toPerUsd === undefined) {
      throw new FxError(`No FX rate available for currency: ${to}`);
    }
    return (toPerUsd * RATE_SCALE) / fromPerUsd;
  }
}

/** Shared instance -- one cache, not one per importing module. */
export const rateProvider: RateProvider = new CachedRateProvider(new StaticTableRateFetcher());

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
