/**
 * Provider-neutral domain model. All timestamps are Unix seconds (as Stripe
 * reports them) and all money amounts are integers in the currency's minor unit.
 */

export type BillingInterval = "day" | "week" | "month" | "year";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "paused"
  | "incomplete"
  | "incomplete_expired"
  | "canceled";

export interface SubscriptionItem {
  /** Price per unit in minor units. `null` for tiered/metered prices that have no fixed amount. */
  unitAmount: number | null;
  quantity: number;
  interval: BillingInterval;
  /** Number of `interval`s between invoices, e.g. 3 + "month" = quarterly. */
  intervalCount: number;
}

export interface Discount {
  /** 0-100. Mutually exclusive with `amountOff` in Stripe, but both are tolerated. */
  percentOff: number | null;
  /** Fixed amount taken off each invoice, in minor units of `currency`. */
  amountOff: number | null;
  currency: string | null;
  duration: "once" | "repeating" | "forever";
  start: number;
  /** When the discount stops applying. `null` for `forever` discounts. */
  end: number | null;
}

export interface Subscription {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  /** Lowercase ISO 4217 code. */
  currency: string;
  items: SubscriptionItem[];
  discounts: Discount[];
  created: number;
  /** When the subscription actually ended, `null` while it is still running. */
  endedAt: number | null;
}

export interface FailedInvoice {
  id: string;
  customerId: string | null;
  customerEmail: string | null;
  amountDue: number;
  currency: string;
  attemptCount: number;
  created: number;
  nextPaymentAttempt: number | null;
  status: "open" | "uncollectible";
}

export interface PaidInvoice {
  id: string;
  customerId: string | null;
  amountPaid: number;
  currency: string;
  paidAt: number;
}

export interface TimeRange {
  /** Inclusive, Unix seconds. */
  from: number;
  /** Exclusive, Unix seconds. */
  to: number;
}

/** Read-only data access used by the analytics tools. */
export interface RevenueSource {
  /** Every subscription regardless of status, including ended ones. */
  listSubscriptions(): Promise<Subscription[]>;
  /** Invoices that were attempted at least once and are still unpaid, created within `range`. */
  listFailedInvoices(range: TimeRange): Promise<FailedInvoice[]>;
  /** Invoices paid within `range`. */
  listPaidInvoices(range: TimeRange): Promise<PaidInvoice[]>;
}
