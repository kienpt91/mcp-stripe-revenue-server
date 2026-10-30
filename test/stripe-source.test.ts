import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { computeMrr } from "../src/calc.js";
import {
  DEFAULT_MAX_ITEMS,
  PAID_INVOICE_LOOKBACK_SECONDS,
  StripeSource,
  TooManyItemsError,
  describeKeyRisk,
  mapDiscount,
  type StripeReadClient,
} from "../src/stripe-source.js";
import { ts } from "./helpers.js";

type Params = Record<string, unknown>;

async function* iterate<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function rawItem(overrides: Partial<Record<string, unknown>> = {}, price: Partial<Record<string, unknown>> = {}) {
  return {
    id: "si_1",
    quantity: 1,
    price: {
      unit_amount: 1000,
      billing_scheme: "per_unit",
      transform_quantity: null,
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
      ...price,
    },
    ...overrides,
  } as unknown as Stripe.SubscriptionItem;
}

function rawSub(overrides: Partial<Record<string, unknown>> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    currency: "usd",
    created: ts("2025-01-01T00:00:00Z"),
    ended_at: null,
    canceled_at: null,
    items: { data: [rawItem()], has_more: false },
    discounts: [],
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function rawCoupon(overrides: Partial<Record<string, unknown>> = {}): Stripe.Coupon {
  return {
    id: "coupon_1",
    percent_off: 25,
    amount_off: null,
    currency: null,
    duration: "forever",
    duration_in_months: null,
    ...overrides,
  } as unknown as Stripe.Coupon;
}

function rawDiscount(coupon: string | Stripe.Coupon, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "di_1",
    start: ts("2025-05-01T00:00:00Z"),
    end: null,
    source: { type: "coupon", coupon },
    ...overrides,
  } as unknown as Stripe.Discount;
}

function rawInvoice(overrides: Partial<Record<string, unknown>> = {}): Stripe.Invoice {
  return {
    id: "in_1",
    customer: "cus_1",
    customer_email: "billing@example.com",
    amount_due: 5000,
    amount_remaining: 5000,
    amount_paid: 0,
    currency: "usd",
    attempt_count: 1,
    created: ts("2025-06-10T00:00:00Z"),
    next_payment_attempt: null,
    status: "open",
    status_transitions: { paid_at: null },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

interface FakeOptions {
  subscriptions?: Stripe.Subscription[];
  items?: Stripe.SubscriptionItem[];
  invoices?: (params: Stripe.InvoiceListParams) => Stripe.Invoice[];
  coupons?: Record<string, Stripe.Coupon>;
}

function fakeStripe(options: FakeOptions = {}) {
  const subscriptionsList = vi.fn((_params: Stripe.SubscriptionListParams) =>
    iterate(options.subscriptions ?? []),
  );
  const itemsList = vi.fn((_params: Stripe.SubscriptionItemListParams) => iterate(options.items ?? []));
  const invoicesList = vi.fn((params: Stripe.InvoiceListParams) =>
    iterate(options.invoices?.(params) ?? []),
  );
  const retrieve = vi.fn(async (id: string) => {
    const coupon = options.coupons?.[id];
    if (!coupon) throw new Error(`No such coupon: ${id}`);
    return coupon;
  });
  const client: StripeReadClient = {
    subscriptions: { list: subscriptionsList },
    subscriptionItems: { list: itemsList },
    invoices: { list: invoicesList },
    coupons: { retrieve },
  };
  return { client, subscriptionsList, itemsList, invoicesList, retrieve };
}

describe("StripeSource.listSubscriptions", () => {
  it("requests every status with expanded discounts and maps the fields", async () => {
    const fake = fakeStripe({
      subscriptions: [
        rawSub({
          items: {
            data: [
              rawItem(
                { quantity: 3 },
                { unit_amount: 40_000, recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
              ),
            ],
            has_more: false,
          },
          discounts: [rawDiscount(rawCoupon({ percent_off: 10 }))],
        }),
      ],
    });

    const [sub] = await new StripeSource(fake.client).listSubscriptions();

    expect(fake.subscriptionsList).toHaveBeenCalledWith({
      status: "all",
      limit: 100,
      expand: ["data.discounts"],
    });
    expect(sub).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      status: "active",
      currency: "usd",
      items: [{ unitAmount: 40_000, quantity: 3, interval: "year", intervalCount: 1 }],
      discounts: [
        { percentOff: 10, amountOff: null, currency: null, duration: "forever", start: ts("2025-05-01T00:00:00Z"), end: null },
      ],
      created: ts("2025-01-01T00:00:00Z"),
      endedAt: null,
    });
  });

  it("accepts an expanded customer object and resolves coupon ids once per coupon", async () => {
    const fake = fakeStripe({
      subscriptions: [
        rawSub({ id: "sub_a", customer: { id: "cus_obj" }, discounts: [rawDiscount("SAVE25")] }),
        rawSub({ id: "sub_b", discounts: [rawDiscount("SAVE25")] }),
      ],
      coupons: { SAVE25: rawCoupon({ percent_off: 25 }) },
    });

    const subs = await new StripeSource(fake.client).listSubscriptions();

    expect(subs[0]?.customerId).toBe("cus_obj");
    expect(subs.map((s) => s.discounts[0]?.percentOff)).toEqual([25, 25]);
    expect(fake.retrieve).toHaveBeenCalledTimes(1);
  });

  it("treats tiered, transformed and metered prices as having no fixed amount", async () => {
    const fake = fakeStripe({
      subscriptions: [
        rawSub({
          items: {
            data: [
              rawItem({}, { billing_scheme: "tiered", unit_amount: null }),
              rawItem({}, { transform_quantity: { divide_by: 10, round: "up" } }),
              rawItem(
                { quantity: undefined },
                { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
              ),
            ],
            has_more: false,
          },
        }),
      ],
    });

    const [sub] = await new StripeSource(fake.client).listSubscriptions();
    expect(sub?.items.map((i) => i.unitAmount)).toEqual([null, null, null]);
    expect(sub?.items[2]?.quantity).toBe(1);
    expect(computeMrr([sub!], ts("2025-06-15T00:00:00Z")).skippedItems).toBe(3);
  });

  it("fetches the full item list when the embedded one is truncated", async () => {
    const fake = fakeStripe({
      subscriptions: [rawSub({ items: { data: [rawItem()], has_more: true } })],
      items: [rawItem({ id: "si_1" }), rawItem({ id: "si_2" }, { unit_amount: 500 })],
    });

    const [sub] = await new StripeSource(fake.client).listSubscriptions();

    expect(fake.itemsList).toHaveBeenCalledWith({ subscription: "sub_1", limit: 100 });
    expect(sub?.items.map((i) => i.unitAmount)).toEqual([1000, 500]);
  });

  it("derives endedAt from ended_at, falling back to canceled_at for canceled subscriptions", async () => {
    const fake = fakeStripe({
      subscriptions: [
        rawSub({ id: "a", status: "canceled", ended_at: 1_700_000_000, canceled_at: 1_600_000_000 }),
        rawSub({ id: "b", status: "canceled", ended_at: null, canceled_at: 1_650_000_000 }),
        rawSub({ id: "c", status: "active", ended_at: null, canceled_at: 1_650_000_000 }), // cancel scheduled
      ],
    });
    const subs = await new StripeSource(fake.client).listSubscriptions();
    expect(subs.map((s) => s.endedAt)).toEqual([1_700_000_000, 1_650_000_000, null]);
  });

  it("fails loudly on a status or interval it does not understand", async () => {
    const badStatus = fakeStripe({ subscriptions: [rawSub({ status: "teleported" })] });
    await expect(new StripeSource(badStatus.client).listSubscriptions()).rejects.toThrow(/unsupported status/);

    const badInterval = fakeStripe({
      subscriptions: [
        rawSub({
          items: {
            data: [rawItem({}, { recurring: { interval: "fortnight", interval_count: 1, usage_type: "licensed" } })],
            has_more: false,
          },
        }),
      ],
    });
    await expect(new StripeSource(badInterval.client).listSubscriptions()).rejects.toThrow(/unsupported interval/);
  });

  it("propagates Stripe errors", async () => {
    const fake = fakeStripe({ subscriptions: [rawSub({ discounts: [rawDiscount("GONE")] })] });
    await expect(new StripeSource(fake.client).listSubscriptions()).rejects.toThrow("No such coupon: GONE");
  });

  it("produces data the MRR calculation can use end to end", async () => {
    const fake = fakeStripe({
      subscriptions: [
        rawSub({ id: "s1", discounts: [rawDiscount(rawCoupon({ percent_off: 50 }))] }), // 1000 -> 500
        rawSub({ id: "s2", status: "canceled", ended_at: ts("2025-02-01T00:00:00Z") }),
        rawSub({
          id: "s3",
          currency: "eur",
          items: {
            data: [rawItem({}, { unit_amount: 12_000, recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } })],
            has_more: false,
          },
        }),
      ],
    });
    const subs = await new StripeSource(fake.client).listSubscriptions();
    const mrr = computeMrr(subs, ts("2025-06-15T00:00:00Z"));
    expect(mrr.byCurrency.map((c) => [c.currency, c.mrr])).toEqual([
      ["eur", 1000],
      ["usd", 500],
    ]);
  });
});

describe("mapDiscount", () => {
  it("computes the end of a repeating discount from duration_in_months when Stripe omits it", () => {
    const mapped = mapDiscount(
      rawDiscount("c", { start: ts("2025-01-31T00:00:00Z"), end: null }),
      rawCoupon({ duration: "repeating", duration_in_months: 3, percent_off: 20 }),
    );
    expect(mapped.duration).toBe("repeating");
    expect(mapped.end).not.toBeNull();
    expect(mapped.end!).toBeGreaterThan(ts("2025-04-25T00:00:00Z"));
    expect(mapped.end!).toBeLessThan(ts("2025-05-05T00:00:00Z"));
  });

  it("keeps amount_off and its currency", () => {
    const mapped = mapDiscount(rawDiscount("c"), rawCoupon({ percent_off: null, amount_off: 500, currency: "usd" }));
    expect(mapped).toMatchObject({ percentOff: null, amountOff: 500, currency: "usd" });
  });
});

describe("StripeSource invoices", () => {
  const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-06-15T00:00:00Z") };

  it("lists open and uncollectible invoices in the range and keeps attempted ones", async () => {
    const fake = fakeStripe({
      invoices: (params) =>
        params.status === "open"
          ? [
              rawInvoice({ id: "in_open", attempt_count: 2, next_payment_attempt: ts("2025-06-17T00:00:00Z") }),
              rawInvoice({ id: "in_new", attempt_count: 0 }),
            ]
          : [rawInvoice({ id: "in_unc", attempt_count: 4, status: "uncollectible", customer: { id: "cus_obj" } })],
    });

    const invoices = await new StripeSource(fake.client).listFailedInvoices(range);

    expect(fake.invoicesList).toHaveBeenCalledWith({
      status: "open",
      created: { gte: range.from, lt: range.to },
      limit: 100,
    });
    expect(fake.invoicesList).toHaveBeenCalledWith({
      status: "uncollectible",
      created: { gte: range.from, lt: range.to },
      limit: 100,
    });
    expect(invoices.map((i) => i.id)).toEqual(["in_open", "in_unc"]);
    expect(invoices[0]).toEqual({
      id: "in_open",
      customerId: "cus_1",
      customerEmail: "billing@example.com",
      amountDue: 5000,
      currency: "usd",
      attemptCount: 2,
      created: ts("2025-06-10T00:00:00Z"),
      nextPaymentAttempt: ts("2025-06-17T00:00:00Z"),
      status: "open",
    });
    expect(invoices[1]).toMatchObject({ status: "uncollectible", customerId: "cus_obj" });
  });

  it("reports the remaining balance of a partially paid invoice", async () => {
    const fake = fakeStripe({
      invoices: (p) => (p.status === "open" ? [rawInvoice({ amount_due: 5000, amount_remaining: 1800 })] : []),
    });
    const [invoice] = await new StripeSource(fake.client).listFailedInvoices(range);
    expect(invoice?.amountDue).toBe(1800);
  });

  it("looks back past the window for paid invoices but only returns those paid inside it", async () => {
    const fake = fakeStripe({
      invoices: () => [
        rawInvoice({ id: "in_in", amount_paid: 4000, status: "paid", status_transitions: { paid_at: ts("2025-06-05T00:00:00Z") } }),
        rawInvoice({ id: "in_before", amount_paid: 4000, status: "paid", status_transitions: { paid_at: ts("2025-05-30T00:00:00Z") } }),
        rawInvoice({ id: "in_after", amount_paid: 4000, status: "paid", status_transitions: { paid_at: ts("2025-06-15T00:00:00Z") } }),
        rawInvoice({ id: "in_zero", amount_paid: 0, status: "paid", status_transitions: { paid_at: ts("2025-06-05T00:00:00Z") } }),
        rawInvoice({ id: "in_nopaidat", amount_paid: 900, status: "paid", status_transitions: { paid_at: null }, created: ts("2025-06-07T00:00:00Z") }),
      ],
    });

    const invoices = await new StripeSource(fake.client).listPaidInvoices(range);

    expect(fake.invoicesList).toHaveBeenCalledWith({
      status: "paid",
      created: { gte: range.from - PAID_INVOICE_LOOKBACK_SECONDS, lt: range.to },
      limit: 100,
    });
    expect(invoices.map((i) => [i.id, i.amountPaid])).toEqual([
      ["in_in", 4000],
      ["in_nopaidat", 900],
    ]);
  });
});

describe("max items guard", () => {
  const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-06-15T00:00:00Z") };

  it("fails with a clear error once more than maxItems subscriptions are read", async () => {
    const fake = fakeStripe({ subscriptions: [rawSub({ id: "a" }), rawSub({ id: "b" }), rawSub({ id: "c" })] });
    const source = new StripeSource(fake.client, 2);
    await expect(source.listSubscriptions()).rejects.toThrow(TooManyItemsError);
    await expect(source.listSubscriptions()).rejects.toThrow(/more than 2 objects.*STRIPE_MAX_ITEMS/);
  });

  it("allows exactly maxItems objects", async () => {
    const fake = fakeStripe({ subscriptions: [rawSub({ id: "a" }), rawSub({ id: "b" })] });
    expect(await new StripeSource(fake.client, 2).listSubscriptions()).toHaveLength(2);
  });

  it("stops pulling pages as soon as the limit is exceeded", async () => {
    let pulled = 0;
    async function* endless(): AsyncGenerator<Stripe.Subscription> {
      for (;;) {
        pulled += 1;
        yield rawSub({ id: `sub_${pulled}` });
      }
    }
    const fake = fakeStripe();
    fake.client.subscriptions.list = () => endless();
    await expect(new StripeSource(fake.client, 5).listSubscriptions()).rejects.toThrow(TooManyItemsError);
    expect(pulled).toBe(6);
  });

  it("applies to invoice lists too, naming the list that overflowed", async () => {
    const invoices = (p: Stripe.InvoiceListParams) =>
      p.status === "open" ? [rawInvoice({ id: "1" }), rawInvoice({ id: "2" })] : [];
    const failed = new StripeSource(fakeStripe({ invoices }).client, 1);
    await expect(failed.listFailedInvoices(range)).rejects.toThrow(/open invoices/);

    const paid = new StripeSource(fakeStripe({ invoices: () => [rawInvoice(), rawInvoice()] }).client, 1);
    await expect(paid.listPaidInvoices(range)).rejects.toThrow(/paid invoices/);
  });

  it("defaults to 50,000", () => {
    expect(DEFAULT_MAX_ITEMS).toBe(50_000);
  });
});

describe("describeKeyRisk", () => {
  it("flags unrestricted secret keys and accepts restricted ones", () => {
    expect(describeKeyRisk("sk_live_abc123")).toMatch(/restricted key/);
    expect(describeKeyRisk("sk_test_abc123")).toMatch(/restricted key/);
    expect(describeKeyRisk("rk_live_abc123")).toBeNull();
    expect(describeKeyRisk("rk_test_abc123")).toBeNull();
  });
});
