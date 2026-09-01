const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function getCurrencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Parses a decimal string (e.g. "33.33") into an integer scaled by 10^scale. Never touches a JS number. */
export function parseScaledDecimal(value: string, scale: number): bigint {
  if (!DECIMAL_STRING.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");

  if (fraction.length > scale) {
    throw new Error(`Value ${value} has more than ${scale} decimal places`);
  }

  const scaled = BigInt(whole + fraction.padEnd(scale, "0"));
  return negative ? -scaled : scaled;
}

/** Parses a decimal string (e.g. "100.00") into minor units. Never touches a JS number. */
export function parseMinor(amount: string, currency: string): bigint {
  try {
    return parseScaledDecimal(amount, getCurrencyDecimals(currency));
  } catch {
    throw new Error(
      `Invalid amount ${amount} for ${currency} (expects up to ${getCurrencyDecimals(currency)} decimal places)`,
    );
  }
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

export function addMinor(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subMinor(a: bigint, b: bigint): bigint {
  return a - b;
}
