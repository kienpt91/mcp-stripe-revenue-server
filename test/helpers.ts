import type { Discount, FailedInvoice, PaidInvoice, Subscription, SubscriptionItem } from "../src/types.js";

export const DAY = 86_400;

/** Unix seconds for an ISO date/time string. */
export const ts = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

export function item(overrides: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return { unitAmount: 1000, quantity: 1, interval: "month", intervalCount: 1, ...overrides };
}

export function discount(overrides: Partial<Discount> = {}): Discount {
  return {
    percentOff: null,
    amountOff: null,
    currency: null,
    duration: "forever",
    start: ts("2024-01-01T00:00:00Z"),
    end: null,
    ...overrides,
  };
}

let counter = 0;

export function sub(overrides: Partial<Subscription> = {}): Subscription {
  counter += 1;
  return {
    id: `sub_${counter}`,
    customerId: `cus_${counter}`,
    status: "active",
    currency: "usd",
    items: [item()],
    discounts: [],
    created: ts("2024-01-01T00:00:00Z"),
    endedAt: null,
    ...overrides,
  };
}

export function failedInvoice(overrides: Partial<FailedInvoice> = {}): FailedInvoice {
  counter += 1;
  return {
    id: `in_${counter}`,
    customerId: `cus_${counter}`,
    customerEmail: null,
    amountDue: 1000,
    currency: "usd",
    attemptCount: 1,
    created: ts("2025-06-01T00:00:00Z"),
    nextPaymentAttempt: null,
    status: "open",
    ...overrides,
  };
}

export function paidInvoice(overrides: Partial<PaidInvoice> = {}): PaidInvoice {
  counter += 1;
  return {
    id: `in_${counter}`,
    customerId: `cus_${counter}`,
    amountPaid: 1000,
    currency: "usd",
    paidAt: ts("2025-06-01T00:00:00Z"),
    ...overrides,
  };
}
