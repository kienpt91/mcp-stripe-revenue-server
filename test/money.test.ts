import { describe, expect, it } from "vitest";
import { currencyExponent, formatMoney } from "../src/money.js";
import { maskEmail, redactSecrets } from "../src/redact.js";

describe("formatMoney", () => {
  it("formats two-decimal currencies", () => {
    expect(formatMoney(123_456, "usd")).toBe("1234.56 USD");
    expect(formatMoney(5, "eur")).toBe("0.05 EUR");
    expect(formatMoney(0, "gbp")).toBe("0.00 GBP");
  });

  it("handles zero- and three-decimal currencies", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(formatMoney(30_000, "jpy")).toBe("30000 JPY");
    expect(formatMoney(1500, "kwd")).toBe("1.500 KWD");
    expect(formatMoney(7, "kwd")).toBe("0.007 KWD");
  });

  it("keeps the sign of negative amounts", () => {
    expect(formatMoney(-1999, "usd")).toBe("-19.99 USD");
  });
});

describe("redactSecrets", () => {
  it("removes Stripe keys of every kind and leaves other text alone", () => {
    const text = "bad key sk_live_51Habc123 and rk_test_ZZ99 or pk_live_abc; code 401";
    expect(redactSecrets(text)).toBe("bad key [redacted] and [redacted] or [redacted]; code 401");
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
    expect(maskEmail("a@b.io")).toBe("a***@b.io");
    expect(maskEmail("billing@northwind.example")).toBe("b***@northwind.example");
  });

  it("passes null through and fully masks values that are not an email", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});
