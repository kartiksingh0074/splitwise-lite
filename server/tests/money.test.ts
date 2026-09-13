import { describe, expect, it } from "vitest";
import { addMinor, formatMinor, getCurrencyDecimals, parseMinor, subMinor } from "../src/domain/money.js";

describe("money", () => {
  it("parses and formats a 2-decimal currency round trip", () => {
    expect(parseMinor("100.00", "USD")).toBe(10000n);
    expect(parseMinor("0.01", "USD")).toBe(1n);
    expect(formatMinor(10034n, "USD")).toBe("100.34");
  });

  it("treats JPY as a zero-decimal currency", () => {
    expect(getCurrencyDecimals("JPY")).toBe(0);
    expect(parseMinor("15000", "JPY")).toBe(15000n);
    expect(formatMinor(15000n, "JPY")).toBe("15000");
  });

  it("formats a negative zero-decimal amount (e.g. a JPY ledger reversal)", () => {
    expect(formatMinor(-15000n, "JPY")).toBe("-15000");
  });

  it("rejects more precision than the currency supports", () => {
    expect(() => parseMinor("100.001", "USD")).toThrow();
    expect(() => parseMinor("100.5", "JPY")).toThrow();
  });

  it("rejects non-decimal input", () => {
    expect(() => parseMinor("abc", "USD")).toThrow();
    expect(() => parseMinor("1e5", "USD")).toThrow();
  });

  it("round-trips negative amounts (for ledger deltas)", () => {
    expect(parseMinor("-50.00", "USD")).toBe(-5000n);
    expect(formatMinor(-5000n, "USD")).toBe("-50.00");
  });

  it("addMinor and subMinor do exact bigint arithmetic", () => {
    expect(addMinor(100n, 50n)).toBe(150n);
    expect(subMinor(100n, 150n)).toBe(-50n);
  });
});
