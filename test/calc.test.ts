import { describe, expect, it } from "vitest";
import {
  computeChurn,
  computeCollectedRevenue,
  computeFailedPayments,
  computeMrr,
  computeRevenueSummary,
  isDiscountActive,
  itemMonthlyAmount,
  monthlyFactor,
  safeRate,
  subscriptionMonthlyAmount,
} from "../src/calc.js";
import { DAY, discount, failedInvoice, item, paidInvoice, sub, ts } from "./helpers.js";

const NOW = ts("2025-06-15T00:00:00Z");

describe("interval normalization", () => {
  it("converts every interval to a monthly factor", () => {
    expect(monthlyFactor("month", 1)).toBe(1);
    expect(monthlyFactor("month", 3)).toBeCloseTo(1 / 3, 10);
    expect(monthlyFactor("year", 1)).toBeCloseTo(1 / 12, 10);
    expect(monthlyFactor("year", 2)).toBeCloseTo(1 / 24, 10);
    expect(monthlyFactor("week", 1)).toBeCloseTo(52 / 12, 10);
    expect(monthlyFactor("week", 2)).toBeCloseTo(26 / 12, 10);
    expect(monthlyFactor("day", 1)).toBeCloseTo(365 / 12, 10);
    expect(monthlyFactor("day", 30)).toBeCloseTo(365 / 360, 10);
  });

  it("rejects non-positive or fractional interval counts", () => {
    expect(() => monthlyFactor("month", 0)).toThrow(RangeError);
    expect(() => monthlyFactor("month", 1.5)).toThrow(RangeError);
  });

  it("multiplies by quantity and normalizes yearly prices", () => {
    expect(itemMonthlyAmount(item({ unitAmount: 120_000, interval: "year" }))).toBeCloseTo(10_000, 6);
    expect(itemMonthlyAmount(item({ unitAmount: 2000, quantity: 3 }))).toBe(6000);
    expect(itemMonthlyAmount(item({ unitAmount: 1000, interval: "week" }))).toBeCloseTo(4333.3333, 3);
    expect(itemMonthlyAmount(item({ unitAmount: 0 }))).toBe(0);
  });

  it("returns null for prices without a fixed amount", () => {
    expect(itemMonthlyAmount(item({ unitAmount: null }))).toBeNull();
  });
});

describe("discounts", () => {
  const at = NOW;

  it("applies a percent discount to the monthly amount", () => {
    const s = sub({ items: [item({ unitAmount: 10_000 })], discounts: [discount({ percentOff: 25 })] });
    expect(subscriptionMonthlyAmount(s, at).amount).toBe(7500);
  });

  it("only applies a repeating discount inside its window", () => {
    const start = ts("2025-05-01T00:00:00Z");
    const end = ts("2025-08-01T00:00:00Z");
    const d = discount({ percentOff: 50, duration: "repeating", start, end });
    const s = sub({ items: [item({ unitAmount: 10_000 })], discounts: [d] });
    expect(subscriptionMonthlyAmount(s, at).amount).toBe(5000);
    expect(subscriptionMonthlyAmount(s, start - 1).amount).toBe(10_000);
    expect(subscriptionMonthlyAmount(s, end + DAY).amount).toBe(10_000);
  });

  it("treats the end of a repeating discount as exclusive", () => {
    const end = ts("2025-06-15T00:00:00Z");
    const d = discount({ percentOff: 50, duration: "repeating", start: end - 30 * DAY, end });
    expect(isDiscountActive(d, end - 1)).toBe(true);
    expect(isDiscountActive(d, end)).toBe(false);
  });

  it("ignores one-time discounts because they do not recur", () => {
    const s = sub({
      items: [item({ unitAmount: 10_000 })],
      discounts: [discount({ percentOff: 100, duration: "once" })],
    });
    expect(subscriptionMonthlyAmount(s, at).amount).toBe(10_000);
  });

  it("converts a fixed amount_off per invoice into a monthly figure", () => {
    const monthly = sub({
      items: [item({ unitAmount: 10_000 })],
      discounts: [discount({ amountOff: 2000, currency: "usd" })],
    });
    expect(subscriptionMonthlyAmount(monthly, at).amount).toBe(8000);

    // 1200.00/year with 120.00 off each yearly invoice -> 100.00/month minus 10.00/month
    const yearly = sub({
      items: [item({ unitAmount: 120_000, interval: "year" })],
      discounts: [discount({ amountOff: 12_000, currency: "usd" })],
    });
    expect(subscriptionMonthlyAmount(yearly, at).amount).toBeCloseTo(9000, 6);
  });

  it("never goes below zero", () => {
    const s = sub({
      items: [item({ unitAmount: 1000 })],
      discounts: [discount({ amountOff: 5000, currency: "usd" })],
    });
    expect(subscriptionMonthlyAmount(s, at).amount).toBe(0);
    const free = sub({ discounts: [discount({ percentOff: 100 })] });
    expect(subscriptionMonthlyAmount(free, at).amount).toBe(0);
  });

  it("clamps out-of-range percentages", () => {
    const over = sub({ items: [item({ unitAmount: 1000 })], discounts: [discount({ percentOff: 250 })] });
    const under = sub({ items: [item({ unitAmount: 1000 })], discounts: [discount({ percentOff: -10 })] });
    expect(subscriptionMonthlyAmount(over, at).amount).toBe(0);
    expect(subscriptionMonthlyAmount(under, at).amount).toBe(1000);
  });

  it("ignores an amount_off in a different currency than the subscription", () => {
    const s = sub({
      currency: "usd",
      items: [item({ unitAmount: 10_000 })],
      discounts: [discount({ amountOff: 2000, currency: "eur" })],
    });
    expect(subscriptionMonthlyAmount(s, at).amount).toBe(10_000);
  });

  it("stacks discounts in order", () => {
    const s = sub({
      items: [item({ unitAmount: 10_000 })],
      discounts: [discount({ percentOff: 50 }), discount({ amountOff: 1000, currency: "usd" })],
    });
    expect(subscriptionMonthlyAmount(s, at).amount).toBe(4000);
  });

  it("does not apply a fixed discount when no item has a fixed price", () => {
    const s = sub({
      items: [item({ unitAmount: null })],
      discounts: [discount({ amountOff: 1000, currency: "usd" })],
    });
    expect(subscriptionMonthlyAmount(s, at)).toEqual({ amount: 0, skippedItems: 1 });
  });
});

describe("computeMrr", () => {
  it("only counts active and past_due subscriptions", () => {
    const statuses = [
      "active",
      "past_due",
      "trialing",
      "unpaid",
      "paused",
      "incomplete",
      "incomplete_expired",
      "canceled",
    ] as const;
    const subs = statuses.map((status) => sub({ status, items: [item({ unitAmount: 1000 })] }));
    const result = computeMrr(subs, NOW);
    expect(result.byCurrency).toEqual([
      { currency: "usd", mrr: 2000, arr: 24_000, subscriptions: 2, customers: 2 },
    ]);
  });

  it("never sums across currencies", () => {
    const result = computeMrr(
      [
        sub({ currency: "usd", items: [item({ unitAmount: 5000 })] }),
        sub({ currency: "eur", items: [item({ unitAmount: 3000 })] }),
        sub({ currency: "USD", items: [item({ unitAmount: 1000 })] }),
        sub({ currency: "jpy", items: [item({ unitAmount: 9000 })] }),
      ],
      NOW,
    );
    expect(result.byCurrency.map((c) => [c.currency, c.mrr])).toEqual([
      ["eur", 3000],
      ["jpy", 9000],
      ["usd", 6000],
    ]);
  });

  it("rounds the per-currency total, not each subscription", () => {
    // 1001/week = 4337.67/month each; 2 subs = 8675.33 -> 8675 (per-sub rounding would give 8676)
    const weekly = () => sub({ items: [item({ unitAmount: 1001, interval: "week" })] });
    const result = computeMrr([weekly(), weekly()], NOW);
    expect(result.byCurrency[0]?.mrr).toBe(8675);
    expect(result.byCurrency[0]?.arr).toBe(104_104);
  });

  it("counts a customer with several subscriptions once", () => {
    const result = computeMrr(
      [sub({ customerId: "cus_a" }), sub({ customerId: "cus_a" }), sub({ customerId: "cus_b" })],
      NOW,
    );
    expect(result.byCurrency[0]).toMatchObject({ subscriptions: 3, customers: 2 });
  });

  it("sums multi-item subscriptions and quarterly prices", () => {
    const s = sub({
      items: [
        item({ unitAmount: 3000, interval: "month", intervalCount: 3, quantity: 2 }), // 2000/mo
        item({ unitAmount: 500, quantity: 4 }), // 2000/mo
      ],
    });
    expect(computeMrr([s], NOW).byCurrency[0]?.mrr).toBe(4000);
  });

  it("reports items it could not price instead of silently dropping them", () => {
    const s = sub({ items: [item({ unitAmount: 1000 }), item({ unitAmount: null })] });
    const result = computeMrr([s], NOW);
    expect(result.skippedItems).toBe(1);
    expect(result.byCurrency[0]?.mrr).toBe(1000);
  });

  it("returns an empty result for no subscriptions", () => {
    expect(computeMrr([], NOW)).toEqual({ byCurrency: [], skippedItems: 0 });
  });

  it("keeps a fully discounted subscription in the count with zero MRR", () => {
    const result = computeMrr([sub({ discounts: [discount({ percentOff: 100 })] })], NOW);
    expect(result.byCurrency[0]).toMatchObject({ mrr: 0, subscriptions: 1 });
  });
});

describe("safeRate", () => {
  it("returns null instead of dividing by zero", () => {
    expect(safeRate(0, 0)).toBeNull();
    expect(safeRate(3, 0)).toBeNull();
  });

  it("rounds to four decimals", () => {
    expect(safeRate(1, 3)).toBe(0.3333);
    expect(safeRate(2, 3)).toBe(0.6667);
    expect(safeRate(0, 5)).toBe(0);
  });
});

describe("computeChurn", () => {
  const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-07-01T00:00:00Z") };
  const old = ts("2025-01-01T00:00:00Z");

  it("compares cancellations in the window against the cohort at the start", () => {
    const subs = [
      sub({ created: old }),
      sub({ created: old }),
      sub({ created: old, status: "canceled", endedAt: ts("2025-06-10T00:00:00Z") }),
      sub({ created: old, status: "canceled", endedAt: ts("2025-02-10T00:00:00Z") }), // before window
      sub({ created: ts("2025-06-05T00:00:00Z") }), // joined during window
      sub({ created: old, status: "incomplete_expired", endedAt: ts("2025-01-02T00:00:00Z") }),
    ];
    const result = computeChurn(subs, range);
    expect(result.subscriptions).toEqual({
      activeAtStart: 3,
      canceled: 1,
      churnRate: 0.3333,
      newInPeriod: 1,
    });
    expect(result.customers).toEqual({ activeAtStart: 3, churned: 1, churnRate: 0.3333 });
  });

  it("returns null rates when nothing existed at the start", () => {
    const empty = computeChurn([], range);
    expect(empty.subscriptions).toEqual({ activeAtStart: 0, canceled: 0, churnRate: null, newInPeriod: 0 });
    expect(empty.customers.churnRate).toBeNull();
    expect(empty.revenueByCurrency).toEqual([]);

    const onlyNew = computeChurn([sub({ created: ts("2025-06-20T00:00:00Z") })], range);
    expect(onlyNew.subscriptions.churnRate).toBeNull();
    expect(onlyNew.subscriptions.newInPeriod).toBe(1);
  });

  it("is zero, not null, when the cohort exists but nobody left", () => {
    const result = computeChurn([sub({ created: old })], range);
    expect(result.subscriptions.churnRate).toBe(0);
  });

  it("uses [from, to) boundaries", () => {
    const subs = [
      sub({ created: old, status: "canceled", endedAt: range.from }), // ended exactly at start: churned
      sub({ created: old, status: "canceled", endedAt: range.to }), // ends exactly at end: next period
      sub({ created: range.from }), // created at start: new, not cohort
    ];
    const result = computeChurn(subs, range);
    expect(result.subscriptions).toMatchObject({ activeAtStart: 2, canceled: 1, newInPeriod: 1 });
  });

  it("does not count a customer as churned while another subscription survives", () => {
    const subs = [
      sub({ customerId: "cus_x", created: old, status: "canceled", endedAt: ts("2025-06-10T00:00:00Z") }),
      sub({ customerId: "cus_x", created: old }),
    ];
    const result = computeChurn(subs, range);
    expect(result.subscriptions.canceled).toBe(1);
    expect(result.customers).toEqual({ activeAtStart: 1, churned: 0, churnRate: 0 });
  });

  it("treats a plan switch inside the window as retention", () => {
    const subs = [
      sub({ customerId: "cus_y", created: old, status: "canceled", endedAt: ts("2025-06-12T00:00:00Z") }),
      sub({ customerId: "cus_y", created: ts("2025-06-12T00:00:00Z") }),
    ];
    expect(computeChurn(subs, range).customers.churned).toBe(0);
  });

  it("measures revenue churn per currency using the discount active at the start", () => {
    const subs = [
      sub({ currency: "usd", created: old, items: [item({ unitAmount: 10_000 })] }),
      sub({
        currency: "usd",
        created: old,
        items: [item({ unitAmount: 10_000 })],
        discounts: [discount({ percentOff: 50 })],
        status: "canceled",
        endedAt: ts("2025-06-20T00:00:00Z"),
      }),
      sub({
        currency: "eur",
        created: old,
        items: [item({ unitAmount: 4000 })],
        status: "canceled",
        endedAt: ts("2025-06-02T00:00:00Z"),
      }),
    ];
    expect(computeChurn(subs, range).revenueByCurrency).toEqual([
      { currency: "eur", mrrAtStart: 4000, mrrChurned: 4000, churnRate: 1 },
      { currency: "usd", mrrAtStart: 15_000, mrrChurned: 5000, churnRate: 0.3333 },
    ]);
  });
});

describe("computeFailedPayments", () => {
  const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-06-16T00:00:00Z") };

  it("keeps attempted invoices inside the range, newest first", () => {
    const a = failedInvoice({ id: "in_a", created: ts("2025-06-03T00:00:00Z") });
    const b = failedInvoice({ id: "in_b", created: ts("2025-06-10T00:00:00Z") });
    const never = failedInvoice({ id: "in_never", attemptCount: 0, created: ts("2025-06-11T00:00:00Z") });
    const old = failedInvoice({ id: "in_old", created: ts("2025-05-01T00:00:00Z") });
    const future = failedInvoice({ id: "in_future", created: ts("2025-06-16T00:00:00Z") });
    const result = computeFailedPayments([a, never, old, b, future], range, 10);
    expect(result.invoices.map((i) => i.id)).toEqual(["in_b", "in_a"]);
    expect(result.totalCount).toBe(2);
  });

  it("groups totals by currency and truncates the list but not the totals", () => {
    const invoices = [
      failedInvoice({ amountDue: 1000, currency: "usd", created: range.from + 1 }),
      failedInvoice({ amountDue: 2500, currency: "usd", created: range.from + 2 }),
      failedInvoice({ amountDue: 700, currency: "eur", created: range.from + 3 }),
    ];
    const result = computeFailedPayments(invoices, range, 1);
    expect(result.invoices).toHaveLength(1);
    expect(result.byCurrency).toEqual([
      { currency: "eur", count: 1, amountDue: 700 },
      { currency: "usd", count: 2, amountDue: 3500 },
    ]);
  });

  it("counts distinct customers and tolerates invoices without one", () => {
    const invoices = [
      failedInvoice({ customerId: "cus_1", created: range.from + 1 }),
      failedInvoice({ customerId: "cus_1", created: range.from + 2 }),
      failedInvoice({ customerId: null, created: range.from + 3 }),
    ];
    expect(computeFailedPayments(invoices, range, 10).customers).toBe(1);
  });

  it("handles a limit of zero and no invoices", () => {
    expect(computeFailedPayments([], range, 10)).toEqual({
      totalCount: 0,
      customers: 0,
      byCurrency: [],
      invoices: [],
    });
    const one = [failedInvoice({ created: range.from + 1 })];
    expect(computeFailedPayments(one, range, 0).invoices).toEqual([]);
  });
});

describe("computeCollectedRevenue", () => {
  const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-07-01T00:00:00Z") };

  it("sums paid invoices per currency inside the window only", () => {
    const result = computeCollectedRevenue(
      [
        paidInvoice({ amountPaid: 1000, currency: "usd", paidAt: range.from }),
        paidInvoice({ amountPaid: 2000, currency: "usd", paidAt: range.to - 1 }),
        paidInvoice({ amountPaid: 9999, currency: "usd", paidAt: range.to }),
        paidInvoice({ amountPaid: 500, currency: "eur", paidAt: range.from + 10 }),
        paidInvoice({ amountPaid: 7777, currency: "eur", paidAt: range.from - 1 }),
      ],
      range,
    );
    expect(result.byCurrency).toEqual([
      { currency: "eur", collected: 500, invoices: 1, customers: 1 },
      { currency: "usd", collected: 3000, invoices: 2, customers: 2 },
    ]);
  });
});

describe("computeRevenueSummary", () => {
  it("combines MRR, collected revenue, failures and churn for one period", () => {
    const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-07-01T00:00:00Z") };
    const summary = computeRevenueSummary({
      range,
      subscriptions: [
        sub({ created: ts("2025-01-01T00:00:00Z"), items: [item({ unitAmount: 5000 })] }),
        sub({
          created: ts("2025-01-01T00:00:00Z"),
          status: "canceled",
          endedAt: ts("2025-06-10T00:00:00Z"),
        }),
      ],
      failedInvoices: [failedInvoice({ created: ts("2025-06-05T00:00:00Z"), amountDue: 1200 })],
      paidInvoices: [paidInvoice({ amountPaid: 5000, paidAt: ts("2025-06-02T00:00:00Z") })],
    });
    expect(summary.mrr.byCurrency).toEqual([
      { currency: "usd", mrr: 5000, arr: 60_000, subscriptions: 1, customers: 1 },
    ]);
    expect(summary.collected.byCurrency[0]?.collected).toBe(5000);
    expect(summary.failedPayments).toMatchObject({
      totalCount: 1,
      byCurrency: [{ currency: "usd", count: 1, amountDue: 1200 }],
    });
    expect(summary.churn.subscriptions).toMatchObject({ activeAtStart: 2, canceled: 1, churnRate: 0.5 });
  });
});
