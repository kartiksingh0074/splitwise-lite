import { describe, expect, it } from "vitest";
import { CachedRateProvider, FxError, RATE_SCALE, type RateFetcher } from "../src/domain/fx.js";

function fetcherOnce(rates: Record<string, string>): RateFetcher {
  return { fetchRates: () => Promise.resolve(rates) };
}

function failingFetcher(): RateFetcher {
  return { fetchRates: () => Promise.reject(new Error("network down")) };
}

describe("CachedRateProvider", () => {
  it("a successful fetch populates the cache and getRate reflects it", async () => {
    const provider = new CachedRateProvider(fetcherOnce({ USD: "1", EUR: "0.5" }), {
      autoStart: false,
    });
    await provider.refreshNow();

    // USD->EUR: 1 USD = 0.5 EUR, so rate should be 0.5 scaled.
    expect(provider.getRate("USD", "EUR")).toBe(RATE_SCALE / 2n);
  });

  it("falls back to the last successfully fetched rates when a later refresh fails", async () => {
    let call = 0;
    const provider = new CachedRateProvider(
      {
        fetchRates: () => {
          call += 1;
          if (call === 1) return Promise.resolve({ USD: "1", EUR: "0.5" });
          return Promise.reject(new Error("network down"));
        },
      },
      { autoStart: false },
    );

    await provider.refreshNow(); // succeeds, caches EUR=0.5
    const before = provider.getRate("USD", "EUR");

    await provider.refreshNow(); // fails, should keep serving the prior cache
    const after = provider.getRate("USD", "EUR");

    expect(call).toBe(2);
    expect(after).toBe(before);
    expect(after).toBe(RATE_SCALE / 2n);
  });

  it("never fetches for a same-currency pair, regardless of cache state", async () => {
    const provider = new CachedRateProvider(failingFetcher(), { autoStart: false });
    expect(provider.getRate("USD", "USD")).toBe(RATE_SCALE);
  });

  it("throws FxError for a currency with no known rate", async () => {
    const provider = new CachedRateProvider(fetcherOnce({ USD: "1", EUR: "0.5" }), {
      autoStart: false,
    });
    await provider.refreshNow();

    expect(() => provider.getRate("USD", "ZZZ")).toThrow(FxError);
  });

  it("serves the seed table before any refresh has ever completed", () => {
    const provider = new CachedRateProvider(failingFetcher(), { autoStart: false });
    // Never called refreshNow() -- should still serve the constructor's seed table (real
    // currency codes from the static table), not throw as if the cache were empty.
    expect(() => provider.getRate("USD", "EUR")).not.toThrow();
  });
});
