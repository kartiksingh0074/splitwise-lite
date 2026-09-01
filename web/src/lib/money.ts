const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function getCurrencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Parses a decimal string (e.g. "100.00") into minor units. Never touches a JS number. */
export function parseMinor(amount: string, currency: string): bigint {
  if (!DECIMAL_STRING.test(amount)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  const decimals = getCurrencyDecimals(currency);
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction = ""] = unsigned.split(".");

  if (fraction.length > decimals) {
    throw new Error(`Amount ${amount} has more precision than ${currency} supports`);
  }

  const minor = BigInt(whole + fraction.padEnd(decimals, "0"));
  return negative ? -minor : minor;
}

/** Formats minor units back into a decimal string, e.g. 10034n USD -> "100.34". */
export function formatMinor(minor: bigint, currency: string): string {
  const decimals = getCurrencyDecimals(currency);
  const negative = minor < 0n;
  const unsigned = negative ? -minor : minor;

  if (decimals === 0) {
    return (negative ? "-" : "") + unsigned.toString();
  }

  const digits = unsigned.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
