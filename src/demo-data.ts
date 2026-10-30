/**
 * Deterministic sample data for `--demo` mode and tests. Everything is anchored to
 * `DEMO_NOW`, so tool output never changes between runs.
 */
import { MemorySource, type MemoryData } from "./memory-source.js";
import type {
  BillingInterval,
  Discount,
  FailedInvoice,
  PaidInvoice,
  Subscription,
  SubscriptionItem,
  SubscriptionStatus,
} from "./types.js";

const ts = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** The fixed "current time" of demo mode: 2025-06-15T12:00:00Z. */
export const DEMO_NOW = ts("2025-06-15T12:00:00Z");

function line(
  unitAmount: number | null,
  interval: BillingInterval = "month",
  quantity = 1,
  intervalCount = 1,
): SubscriptionItem {
  return { unitAmount, quantity, interval, intervalCount };
}

function percentOff(
  percent: number,
  start: string,
  end: string | null,
): Discount {
  return {
    percentOff: percent,
    amountOff: null,
    currency: null,
    duration: end === null ? "forever" : "repeating",
    start: ts(start),
    end: end === null ? null : ts(end),
  };
}

function amountOff(amount: number, currency: string, start: string): Discount {
  return { percentOff: null, amountOff: amount, currency, duration: "forever", start: ts(start), end: null };
}

function subscription(
  n: number,
  customer: number,
  created: string,
  items: SubscriptionItem[],
  opts: {
    status?: SubscriptionStatus;
    currency?: string;
    discounts?: Discount[];
    endedAt?: string;
  } = {},
): Subscription {
  return {
    id: `sub_demo_${String(n).padStart(2, "0")}`,
    customerId: `cus_demo_${String(customer).padStart(2, "0")}`,
    status: opts.status ?? "active",
    currency: opts.currency ?? "usd",
    items,
    discounts: opts.discounts ?? [],
    created: ts(created),
    endedAt: opts.endedAt === undefined ? null : ts(opts.endedAt),
  };
}

const subscriptions: Subscription[] = [
  subscription(1, 1, "2024-09-03T09:00:00Z", [line(4900)]),
  subscription(2, 2, "2024-11-10T09:00:00Z", [line(120_000, "year")]),
  subscription(3, 3, "2025-03-20T09:00:00Z", [line(2000, "month", 5)], {
    discounts: [percentOff(20, "2025-04-01T00:00:00Z", "2025-10-01T00:00:00Z")],
  }),
  subscription(4, 4, "2025-02-14T09:00:00Z", [line(1000, "week")]),
  subscription(5, 5, "2024-12-01T09:00:00Z", [line(3900)], { currency: "eur" }),
  subscription(6, 6, "2025-02-01T09:00:00Z", [line(46_800, "year")], { currency: "eur" }),
  subscription(7, 7, "2024-08-15T09:00:00Z", [line(9900)], {
    discounts: [amountOff(1000, "usd", "2024-08-15T09:00:00Z")],
  }),
  // The launch discount on this one expired on 2025-05-01, so it is back to full price.
  subscription(8, 8, "2025-01-05T09:00:00Z", [line(7900)], {
    discounts: [percentOff(50, "2025-01-05T09:00:00Z", "2025-05-01T00:00:00Z")],
  }),
  subscription(9, 9, "2024-10-01T09:00:00Z", [line(15_000, "month", 1, 3)], { currency: "gbp" }),
  subscription(10, 10, "2025-01-20T09:00:00Z", [line(4900)], { status: "past_due" }),
  subscription(11, 11, "2025-06-10T09:00:00Z", [line(4900)], { status: "trialing" }),
  subscription(12, 12, "2024-12-12T09:00:00Z", [line(4900)], {
    status: "canceled",
    endedAt: "2025-06-02T08:00:00Z",
  }),
  subscription(13, 13, "2025-02-01T09:00:00Z", [line(3900)], {
    status: "canceled",
    currency: "eur",
    endedAt: "2025-05-20T08:00:00Z",
  }),
  subscription(14, 14, "2024-10-20T09:00:00Z", [line(4900)], {
    status: "canceled",
    endedAt: "2025-03-05T08:00:00Z",
  }),
  subscription(15, 15, "2025-06-01T09:00:00Z", [line(4900)], {
    status: "incomplete_expired",
    endedAt: "2025-06-02T09:00:00Z",
  }),
  // Customer 2 also runs a monthly add-on next to the yearly plan.
  subscription(16, 2, "2025-01-12T09:00:00Z", [line(1500)]),
  subscription(17, 16, "2025-05-28T09:00:00Z", [line(4900)]),
  // Customer 17 moved from Starter to Pro: one subscription ends, a new one starts. Not churn.
  subscription(18, 17, "2025-01-01T09:00:00Z", [line(1900)], {
    status: "canceled",
    endedAt: "2025-06-08T10:00:00Z",
  }),
  subscription(19, 17, "2025-06-08T10:00:00Z", [line(6900)]),
  subscription(20, 18, "2025-04-02T09:00:00Z", [line(30_000)], { currency: "jpy" }),
  // One flat-fee item plus one metered item that has no fixed amount.
  subscription(21, 19, "2025-03-03T09:00:00Z", [line(4900), line(null)]),
];

function failed(
  n: number,
  customer: number,
  email: string,
  amountDue: number,
  currency: string,
  attemptCount: number,
  created: string,
  nextAttempt: string | null,
  status: FailedInvoice["status"] = "open",
): FailedInvoice {
  return {
    id: `in_demo_failed_${n}`,
    customerId: `cus_demo_${String(customer).padStart(2, "0")}`,
    customerEmail: email,
    amountDue,
    currency,
    attemptCount,
    created: ts(created),
    nextPaymentAttempt: nextAttempt === null ? null : ts(nextAttempt),
    status,
  };
}

const failedInvoices: FailedInvoice[] = [
  failed(1, 10, "billing@northwind.example", 4900, "usd", 2, "2025-06-10T09:00:00Z", "2025-06-17T09:00:00Z"),
  failed(2, 5, "ops@fabrikam.example", 3900, "eur", 1, "2025-06-14T09:00:00Z", "2025-06-16T09:00:00Z"),
  failed(3, 12, "finance@contoso.example", 4900, "usd", 4, "2025-05-28T09:00:00Z", null, "uncollectible"),
  failed(4, 4, "pay@tailspin.example", 1000, "usd", 3, "2025-06-02T09:00:00Z", "2025-06-18T09:00:00Z"),
  // Older than 30 days: only shows up when a longer window is requested.
  failed(5, 13, "accounts@wingtip.example", 3900, "eur", 3, "2025-04-20T09:00:00Z", null, "uncollectible"),
];

function paid(n: number, customer: number, amountPaid: number, currency: string, at: string): PaidInvoice {
  return {
    id: `in_demo_paid_${String(n).padStart(2, "0")}`,
    customerId: `cus_demo_${String(customer).padStart(2, "0")}`,
    amountPaid,
    currency,
    paidAt: ts(at),
  };
}

const paidInvoices: PaidInvoice[] = [
  paid(1, 1, 4900, "usd", "2025-06-03T09:00:00Z"),
  paid(2, 3, 8000, "usd", "2025-06-01T09:00:00Z"),
  paid(3, 4, 1000, "usd", "2025-06-06T09:00:00Z"),
  paid(4, 4, 1000, "usd", "2025-06-13T09:00:00Z"),
  paid(5, 5, 3900, "eur", "2025-06-01T09:00:00Z"),
  paid(6, 7, 8900, "usd", "2025-06-15T09:00:00Z"),
  paid(7, 8, 7900, "usd", "2025-06-05T09:00:00Z"),
  paid(8, 9, 15_000, "gbp", "2025-06-01T09:00:00Z"),
  paid(9, 16, 4900, "usd", "2025-05-28T09:00:00Z"),
  paid(10, 17, 6900, "usd", "2025-06-08T10:00:00Z"),
  paid(11, 18, 30_000, "jpy", "2025-06-02T09:00:00Z"),
  paid(12, 2, 1500, "usd", "2025-06-12T09:00:00Z"),
  paid(13, 13, 3900, "eur", "2025-05-01T09:00:00Z"),
  paid(14, 12, 4900, "usd", "2025-05-02T09:00:00Z"),
  // Paid in March: outside the default 30-day window.
  paid(15, 1, 4900, "usd", "2025-03-03T09:00:00Z"),
];

export function demoData(): MemoryData {
  return {
    subscriptions: structuredClone(subscriptions),
    failedInvoices: structuredClone(failedInvoices),
    paidInvoices: structuredClone(paidInvoices),
  };
}

export function createDemoSource(): MemorySource {
  return new MemorySource(demoData());
}
