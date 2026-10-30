/**
 * Turns calculation results into the JSON returned by the MCP tools: ISO
 * timestamps instead of Unix seconds, and a readable decimal string next to
 * every minor-unit amount.
 */
import type {
  ChurnResult,
  FailedPaymentsResult,
  MrrResult,
  RevenueSummaryResult,
} from "./calc.js";
import { formatMoney } from "./money.js";
import type { TimeRange } from "./types.js";

export const iso = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString();

const isoOrNull = (unixSeconds: number | null): string | null =>
  unixSeconds === null ? null : iso(unixSeconds);

export function presentPeriod(range: TimeRange) {
  return { from: iso(range.from), to: iso(range.to) };
}

export function presentMrr(result: MrrResult, asOf: number) {
  return {
    asOf: iso(asOf),
    byCurrency: result.byCurrency.map((c) => ({
      currency: c.currency,
      mrr: c.mrr,
      mrrFormatted: formatMoney(c.mrr, c.currency),
      arr: c.arr,
      arrFormatted: formatMoney(c.arr, c.currency),
      subscriptions: c.subscriptions,
      customers: c.customers,
    })),
    skippedItems: result.skippedItems,
  };
}

export function presentChurn(result: ChurnResult) {
  return {
    period: presentPeriod(result.period),
    subscriptions: result.subscriptions,
    customers: result.customers,
    revenueByCurrency: result.revenueByCurrency.map((r) => ({
      currency: r.currency,
      mrrAtStart: r.mrrAtStart,
      mrrAtStartFormatted: formatMoney(r.mrrAtStart, r.currency),
      mrrChurned: r.mrrChurned,
      mrrChurnedFormatted: formatMoney(r.mrrChurned, r.currency),
      churnRate: r.churnRate,
    })),
  };
}

function presentFailedTotals(byCurrency: FailedPaymentsResult["byCurrency"]) {
  return byCurrency.map((c) => ({
    currency: c.currency,
    count: c.count,
    amountDue: c.amountDue,
    amountDueFormatted: formatMoney(c.amountDue, c.currency),
  }));
}

export function presentFailedPayments(result: FailedPaymentsResult, period: TimeRange) {
  return {
    period: presentPeriod(period),
    totalCount: result.totalCount,
    customers: result.customers,
    byCurrency: presentFailedTotals(result.byCurrency),
    invoices: result.invoices.map((i) => ({
      id: i.id,
      customerId: i.customerId,
      customerEmail: i.customerEmail,
      amountDue: i.amountDue,
      amountDueFormatted: formatMoney(i.amountDue, i.currency),
      currency: i.currency,
      attemptCount: i.attemptCount,
      status: i.status,
      created: iso(i.created),
      nextPaymentAttempt: isoOrNull(i.nextPaymentAttempt),
    })),
  };
}

export function presentSummary(result: RevenueSummaryResult) {
  return {
    period: presentPeriod(result.period),
    mrr: presentMrr(result.mrr, result.period.to),
    collected: result.collected.byCurrency.map((c) => ({
      currency: c.currency,
      collected: c.collected,
      collectedFormatted: formatMoney(c.collected, c.currency),
      invoices: c.invoices,
      customers: c.customers,
    })),
    failedPayments: {
      totalCount: result.failedPayments.totalCount,
      customers: result.failedPayments.customers,
      byCurrency: presentFailedTotals(result.failedPayments.byCurrency),
    },
    churn: result.churn,
  };
}
