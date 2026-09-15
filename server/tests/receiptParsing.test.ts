import { describe, expect, it } from "vitest";
import { guessAmount, guessMerchant } from "../src/domain/receiptParsing.js";

describe("guessAmount", () => {
  it("prefers a currency amount on a line mentioning 'total', even with other numbers present", () => {
    const text = "Corner Cafe\nItem A  10.00\nItem B  15.00\nSubtotal  25.00\nTotal: $42.50\n";
    expect(guessAmount(text)).toBe("42.50");
  });

  it("falls back to the largest amount when no total-like keyword line exists", () => {
    const text = "Corner Cafe\nItem A  10.00\nItem B  15.00\n";
    expect(guessAmount(text)).toBe("15.00");
  });

  it("strips comma thousands separators on a total line", () => {
    const text = "Big Store\nTotal: 1,234.56\n";
    expect(guessAmount(text)).toBe("1234.56");
  });

  it("recognizes 'amount due' and 'balance due' as total-like keywords", () => {
    expect(guessAmount("Amount Due: 99.99")).toBe("99.99");
    expect(guessAmount("Balance Due: 12.34")).toBe("12.34");
  });

  it("returns null when no currency-like number is found anywhere", () => {
    expect(guessAmount("Thanks for visiting!\nNo prices here.")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(guessAmount("")).toBeNull();
  });
});

describe("guessMerchant", () => {
  it("returns the first non-blank trimmed line", () => {
    const text = "\n  \nCorner Cafe\n123 Main St\n";
    expect(guessMerchant(text)).toBe("Corner Cafe");
  });

  it("returns null for blank/empty text", () => {
    expect(guessMerchant("")).toBeNull();
    expect(guessMerchant("   \n\n  ")).toBeNull();
  });
});
