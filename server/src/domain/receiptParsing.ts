// Simple, demo-scope heuristics for prefilling an expense form from OCR-recognized receipt
// text -- not a production-grade receipt parser. Assumes US-style number formatting
// (comma thousands separator, dot decimal).

const AMOUNT_PATTERN = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g;
const TOTAL_KEYWORD = /total|amount due|balance due/i;

function amountsInLine(line: string): number[] {
  return (line.match(AMOUNT_PATTERN) ?? []).map((m) => Number(m.replace(/,/g, "")));
}

function formatAmount(n: number): string {
  return n.toFixed(2);
}

/** Prefers a currency-like number on a line mentioning "total"/"amount due"/"balance due";
 * falls back to the largest currency-like number found anywhere in the text. */
export function guessAmount(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const totalLineAmounts = lines.filter((l) => TOTAL_KEYWORD.test(l)).flatMap(amountsInLine);
  if (totalLineAmounts.length > 0) {
    return formatAmount(Math.max(...totalLineAmounts));
  }

  const allAmounts = lines.flatMap(amountsInLine);
  if (allAmounts.length === 0) {
    return null;
  }
  return formatAmount(Math.max(...allAmounts));
}

/** Receipts conventionally print the merchant name on the first line. */
export function guessMerchant(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[0] ?? null;
}
