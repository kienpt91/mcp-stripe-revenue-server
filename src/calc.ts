/**
 * Pure revenue calculations. Nothing in here performs I/O or reads the clock;
 * every function takes the data and the point in time it should evaluate at.
 *
 * Amounts stay in minor units and are never summed across currencies: every
 * aggregate is returned per currency.
 */
import type {
  BillingInterval,
  Discount,
  FailedInvoice,
  PaidInvoice,
  Subscription,
  SubscriptionItem,
  SubscriptionStatus,
  TimeRange,
} from "./types.js";

export const SECONDS_PER_DAY = 86_400;

/** Average month length used for week/day prices: 52 weeks and 365 days per year. */
const WEEKS_PER_MONTH = 52 / 12;
const DAYS_PER_MONTH = 365 / 12;

/** Statuses whose subscriptions are billed and therefore count towards MRR. */
const MRR_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["active", "past_due"]);

/** Statuses of subscriptions that never became a real subscription. */
const NEVER_STARTED: ReadonlySet<SubscriptionStatus> = new Set(["incomplete", "incomplete_expired"]);

/** Multiplier that converts one invoice's amount into a monthly amount. */
export function monthlyFactor(interval: BillingInterval, intervalCount: number): number {
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    throw new RangeError(`intervalCount must be a positive integer, got ${intervalCount}`);
  }
  switch (interval) {
    case "month":
      return 1 / intervalCount;
    case "year":
      return 1 / (12 * intervalCount);
    case "week":
      return WEEKS_PER_MONTH / intervalCount;
    case "day":
      return DAYS_PER_MONTH / intervalCount;
  }
}

/** Monthly amount (unrounded, minor units) of one item; `null` when the price has no fixed amount. */
export function itemMonthlyAmount(item: SubscriptionItem): number | null {
  if (item.unitAmount === null) return null;
  return item.unitAmount * item.quantity * monthlyFactor(item.interval, item.intervalCount);
}

/**
 * Whether a discount reduces the recurring amount at `at`.
 * `once` discounts only touch a single invoice and never recur, so they are ignored.
 */
export function isDiscountActive(discount: Discount, at: number): boolean {
  if (discount.duration === "once") return false;
  if (discount.start > at) return false;
  return discount.end === null || at < discount.end;
}

export interface MonthlyAmount {
  /** Unrounded monthly amount in minor units, after active discounts, never below zero. */
  amount: number;
  /** Items skipped because they have no fixed unit amount (tiered or metered prices). */
  skippedItems: number;
}

/**
 * Monthly recurring amount of a single subscription at `at`, regardless of its
 * status. Percent discounts scale the running total; fixed `amountOff` discounts
 * come off each invoice, so they are converted to a monthly figure using the
 * subscription's billing interval. Discounts apply in list order.
 */
export function subscriptionMonthlyAmount(sub: Subscription, at: number): MonthlyAmount {
  let amount = 0;
  let skippedItems = 0;
  let invoiceFactor: number | null = null;

  for (const item of sub.items) {
    const monthly = itemMonthlyAmount(item);
    if (monthly === null) {
      skippedItems += 1;
      continue;
    }
    amount += monthly;
    invoiceFactor ??= monthlyFactor(item.interval, item.intervalCount);
  }

  for (const discount of sub.discounts) {
    if (!isDiscountActive(discount, at)) continue;
    if (discount.percentOff !== null) {
      const pct = Math.min(100, Math.max(0, discount.percentOff));
      amount *= 1 - pct / 100;
    }
    if (
      discount.amountOff !== null &&
      invoiceFactor !== null &&
      (discount.currency === null || discount.currency.toLowerCase() === sub.currency.toLowerCase())
    ) {
      amount -= Math.max(0, discount.amountOff) * invoiceFactor;
    }
    amount = Math.max(0, amount);
  }

  return { amount, skippedItems };
}

export interface MrrCurrencySummary {
  currency: string;
  /** Monthly recurring revenue in minor units. */
  mrr: number;
  /** Annualised: 12 x MRR, computed before rounding. */
  arr: number;
  subscriptions: number;
  customers: number;
}

export interface MrrResult {
  byCurrency: MrrCurrencySummary[];
  /** Items left out of the totals because their price has no fixed amount. */
  skippedItems: number;
}

export function computeMrr(subscriptions: readonly Subscription[], at: number): MrrResult {
  const groups = new Map<string, { sum: number; subs: number; customers: Set<string> }>();
  let skippedItems = 0;

  for (const sub of subscriptions) {
    if (!MRR_STATUSES.has(sub.status)) continue;
    const monthly = subscriptionMonthlyAmount(sub, at);
    skippedItems += monthly.skippedItems;
    const currency = sub.currency.toLowerCase();
    const group = groups.get(currency) ?? { sum: 0, subs: 0, customers: new Set<string>() };
    group.sum += monthly.amount;
    group.subs += 1;
    group.customers.add(sub.customerId);
    groups.set(currency, group);
  }

  const byCurrency = [...groups.entries()]
    .map(([currency, g]) => ({
      currency,
      mrr: Math.round(g.sum),
      arr: Math.round(g.sum * 12),
      subscriptions: g.subs,
      customers: g.customers.size,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return { byCurrency, skippedItems };
}

/** `numerator / denominator` rounded to 4 decimals, or `null` when there is nothing to divide by. */
export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export interface ChurnResult {
  period: TimeRange;
  subscriptions: {
    activeAtStart: number;
    canceled: number;
    /** `null` when there were no subscriptions at the start of the period. */
    churnRate: number | null;
    newInPeriod: number;
  };
  customers: {
    activeAtStart: number;
    churned: number;
    churnRate: number | null;
  };
  /** Revenue churn in minor units of each currency, valued at the start of the period. */
  revenueByCurrency: Array<{
    currency: string;
    mrrAtStart: number;
    mrrChurned: number;
    churnRate: number | null;
  }>;
}

/** Existed before `t` and had not ended before `t`. */
const liveAt = (s: Subscription, t: number) => s.created < t && (s.endedAt === null || s.endedAt >= t);

/**
 * Churn over `[range.from, range.to)`.
 *
 * The cohort is every subscription that existed when the period began (never-started
 * `incomplete*` subscriptions excluded). A cohort subscription is churned if it ended
 * before the period closed. A customer churns when they had a subscription at the start
 * and have none left at the end, so switching plans is not churn.
 */
export function computeChurn(subscriptions: readonly Subscription[], range: TimeRange): ChurnResult {
  const subs = subscriptions.filter((s) => !NEVER_STARTED.has(s.status));
  const cohort = subs.filter((s) => liveAt(s, range.from));
  const canceled = cohort.filter((s) => s.endedAt !== null && s.endedAt < range.to);
  const newInPeriod = subs.filter((s) => s.created >= range.from && s.created < range.to);

  const startCustomers = new Set(cohort.map((s) => s.customerId));
  const endCustomers = new Set(subs.filter((s) => liveAt(s, range.to)).map((s) => s.customerId));
  let churnedCustomers = 0;
  for (const id of startCustomers) if (!endCustomers.has(id)) churnedCustomers += 1;

  const revenue = new Map<string, { start: number; churned: number }>();
  const bucket = (currency: string) => {
    const key = currency.toLowerCase();
    const entry = revenue.get(key) ?? { start: 0, churned: 0 };
    revenue.set(key, entry);
    return entry;
  };
  for (const s of cohort) bucket(s.currency).start += subscriptionMonthlyAmount(s, range.from).amount;
  for (const s of canceled) bucket(s.currency).churned += subscriptionMonthlyAmount(s, range.from).amount;

  return {
    period: range,
    subscriptions: {
      activeAtStart: cohort.length,
      canceled: canceled.length,
      churnRate: safeRate(canceled.length, cohort.length),
      newInPeriod: newInPeriod.length,
    },
    customers: {
      activeAtStart: startCustomers.size,
      churned: churnedCustomers,
      churnRate: safeRate(churnedCustomers, startCustomers.size),
    },
    revenueByCurrency: [...revenue.entries()]
      .map(([currency, v]) => ({
        currency,
        mrrAtStart: Math.round(v.start),
        mrrChurned: Math.round(v.churned),
        churnRate: safeRate(v.churned, v.start),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export interface FailedPaymentsResult {
  totalCount: number;
  customers: number;
  byCurrency: Array<{ currency: string; count: number; amountDue: number }>;
  /** Newest first, truncated to `limit`. */
  invoices: FailedInvoice[];
}

/** Unpaid invoices that were attempted at least once and were created within `range`. */
export function computeFailedPayments(
  invoices: readonly FailedInvoice[],
  range: TimeRange,
  limit: number,
): FailedPaymentsResult {
  const failed = invoices
    .filter((i) => i.attemptCount >= 1 && i.created >= range.from && i.created < range.to)
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));

  const groups = new Map<string, { count: number; amountDue: number }>();
  const customers = new Set<string>();
  for (const inv of failed) {
    const currency = inv.currency.toLowerCase();
    const g = groups.get(currency) ?? { count: 0, amountDue: 0 };
    g.count += 1;
    g.amountDue += inv.amountDue;
    groups.set(currency, g);
    if (inv.customerId) customers.add(inv.customerId);
  }

  return {
    totalCount: failed.length,
    customers: customers.size,
    byCurrency: [...groups.entries()]
      .map(([currency, g]) => ({ currency, ...g }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    invoices: failed.slice(0, Math.max(0, limit)),
  };
}

export interface CollectedRevenueResult {
  byCurrency: Array<{ currency: string; collected: number; invoices: number; customers: number }>;
}

/** Cash collected from invoices paid within `range`. */
export function computeCollectedRevenue(
  invoices: readonly PaidInvoice[],
  range: TimeRange,
): CollectedRevenueResult {
  const groups = new Map<string, { collected: number; invoices: number; customers: Set<string> }>();
  for (const inv of invoices) {
    if (inv.paidAt < range.from || inv.paidAt >= range.to) continue;
    const currency = inv.currency.toLowerCase();
    const g = groups.get(currency) ?? { collected: 0, invoices: 0, customers: new Set<string>() };
    g.collected += inv.amountPaid;
    g.invoices += 1;
    if (inv.customerId) g.customers.add(inv.customerId);
    groups.set(currency, g);
  }
  return {
    byCurrency: [...groups.entries()]
      .map(([currency, g]) => ({
        currency,
        collected: g.collected,
        invoices: g.invoices,
        customers: g.customers.size,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export interface RevenueSummaryInput {
  subscriptions: readonly Subscription[];
  failedInvoices: readonly FailedInvoice[];
  paidInvoices: readonly PaidInvoice[];
  range: TimeRange;
}

export interface RevenueSummaryResult {
  period: TimeRange;
  mrr: MrrResult;
  collected: CollectedRevenueResult;
  failedPayments: Pick<FailedPaymentsResult, "totalCount" | "customers" | "byCurrency">;
  churn: Pick<ChurnResult, "subscriptions" | "customers">;
}

/** One-shot overview: MRR as of the end of the period plus what happened during it. */
export function computeRevenueSummary(input: RevenueSummaryInput): RevenueSummaryResult {
  const { range } = input;
  const failed = computeFailedPayments(input.failedInvoices, range, 0);
  const churn = computeChurn(input.subscriptions, range);
  return {
    period: range,
    mrr: computeMrr(input.subscriptions, range.to),
    collected: computeCollectedRevenue(input.paidInvoices, range),
    failedPayments: { totalCount: failed.totalCount, customers: failed.customers, byCurrency: failed.byCurrency },
    churn: { subscriptions: churn.subscriptions, customers: churn.customers },
  };
}
