const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export function currencyExponent(currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** Render minor units as a plain decimal string, e.g. (123456, "usd") -> "1234.56 USD". */
export function formatMoney(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const str = String(abs).padStart(exp + 1, "0");
  const whole = exp === 0 ? str : str.slice(0, -exp);
  const frac = exp === 0 ? "" : `.${str.slice(-exp)}`;
  return `${sign}${whole}${frac} ${currency.toUpperCase()}`;
}
