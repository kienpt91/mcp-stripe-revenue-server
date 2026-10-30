import Stripe from "stripe";
import type {
  BillingInterval,
  Discount,
  FailedInvoice,
  PaidInvoice,
  RevenueSource,
  Subscription,
  SubscriptionItem,
  SubscriptionStatus,
  TimeRange,
} from "./types.js";

/**
 * The slice of the Stripe client this source touches. Only `list` and `retrieve`
 * calls are used, so a restricted key with read access to Subscriptions,
 * Invoices and Coupons is enough. Tests pass a fake that implements it.
 */
export interface StripeReadClient {
  subscriptions: { list(params: Stripe.SubscriptionListParams): AsyncIterable<Stripe.Subscription> };
  subscriptionItems: {
    list(params: Stripe.SubscriptionItemListParams): AsyncIterable<Stripe.SubscriptionItem>;
  };
  invoices: { list(params: Stripe.InvoiceListParams): AsyncIterable<Stripe.Invoice> };
  coupons: { retrieve(id: string): Promise<Stripe.Coupon> };
}

/**
 * Invoices are listed by creation date but reported by payment date. An invoice is
 * normally paid within its retry schedule, so look this far behind the window.
 */
export const PAID_INVOICE_LOOKBACK_SECONDS = 60 * 86_400;

const PAGE_SIZE = 100;

const STATUSES: ReadonlySet<string> = new Set<SubscriptionStatus>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
  "incomplete_expired",
  "canceled",
]);

const INTERVALS: ReadonlySet<string> = new Set<BillingInterval>(["day", "week", "month", "year"]);

const idOf = (ref: string | { id: string } | null): string | null =>
  ref === null ? null : typeof ref === "string" ? ref : ref.id;

function addMonths(unixSeconds: number, months: number): number {
  const d = new Date(unixSeconds * 1000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 1000);
}

export function mapSubscriptionItem(item: Stripe.SubscriptionItem): SubscriptionItem {
  const recurring = item.price.recurring;
  if (recurring === null) {
    throw new Error(`Subscription item ${item.id} has a price without a recurring interval`);
  }
  if (!INTERVALS.has(recurring.interval)) {
    throw new Error(`Subscription item ${item.id} has unsupported interval "${recurring.interval}"`);
  }
  const fixedPrice =
    recurring.usage_type !== "metered" &&
    item.price.billing_scheme === "per_unit" &&
    item.price.transform_quantity === null;
  return {
    unitAmount: fixedPrice ? item.price.unit_amount : null,
    quantity: item.quantity ?? 1,
    interval: recurring.interval as BillingInterval,
    intervalCount: recurring.interval_count,
  };
}

export function mapDiscount(discount: Stripe.Discount, coupon: Stripe.Coupon): Discount {
  const end =
    discount.end ??
    (coupon.duration === "repeating" && coupon.duration_in_months !== null
      ? addMonths(discount.start, coupon.duration_in_months)
      : null);
  return {
    percentOff: coupon.percent_off,
    amountOff: coupon.amount_off,
    currency: coupon.currency,
    duration: coupon.duration as Discount["duration"],
    start: discount.start,
    end,
  };
}

export function mapFailedInvoice(invoice: Stripe.Invoice): FailedInvoice {
  return {
    id: invoice.id,
    customerId: idOf(invoice.customer),
    customerEmail: invoice.customer_email,
    amountDue: invoice.amount_remaining,
    currency: invoice.currency,
    attemptCount: invoice.attempt_count,
    created: invoice.created,
    nextPaymentAttempt: invoice.next_payment_attempt,
    status: invoice.status === "uncollectible" ? "uncollectible" : "open",
  };
}

export class StripeSource implements RevenueSource {
  constructor(private readonly stripe: StripeReadClient) {}

  async listSubscriptions(): Promise<Subscription[]> {
    const couponCache = new Map<string, Promise<Stripe.Coupon>>();
    const coupon = (ref: string | Stripe.Coupon): Promise<Stripe.Coupon> => {
      if (typeof ref !== "string") return Promise.resolve(ref);
      let pending = couponCache.get(ref);
      if (!pending) {
        pending = this.stripe.coupons.retrieve(ref);
        couponCache.set(ref, pending);
      }
      return pending;
    };

    const result: Subscription[] = [];
    for await (const raw of this.stripe.subscriptions.list({
      status: "all",
      limit: PAGE_SIZE,
      expand: ["data.discounts"],
    })) {
      result.push(await this.mapSubscription(raw, coupon));
    }
    return result;
  }

  async listFailedInvoices(range: TimeRange): Promise<FailedInvoice[]> {
    const result: FailedInvoice[] = [];
    for (const status of ["open", "uncollectible"] as const) {
      for await (const invoice of this.stripe.invoices.list({
        status,
        created: { gte: range.from, lt: range.to },
        limit: PAGE_SIZE,
      })) {
        if (invoice.attempt_count >= 1) result.push(mapFailedInvoice(invoice));
      }
    }
    return result;
  }

  async listPaidInvoices(range: TimeRange): Promise<PaidInvoice[]> {
    const result: PaidInvoice[] = [];
    for await (const invoice of this.stripe.invoices.list({
      status: "paid",
      created: { gte: range.from - PAID_INVOICE_LOOKBACK_SECONDS, lt: range.to },
      limit: PAGE_SIZE,
    })) {
      const paidAt = invoice.status_transitions.paid_at ?? invoice.created;
      if (paidAt < range.from || paidAt >= range.to || invoice.amount_paid <= 0) continue;
      result.push({
        id: invoice.id,
        customerId: idOf(invoice.customer),
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
        paidAt,
      });
    }
    return result;
  }

  private async mapSubscription(
    raw: Stripe.Subscription,
    coupon: (ref: string | Stripe.Coupon) => Promise<Stripe.Coupon>,
  ): Promise<Subscription> {
    if (!STATUSES.has(raw.status)) {
      throw new Error(`Subscription ${raw.id} has unsupported status "${raw.status}"`);
    }

    const items = [...raw.items.data];
    if (raw.items.has_more) {
      // The embedded list is capped; fetch the complete set of items for this subscription.
      items.length = 0;
      for await (const item of this.stripe.subscriptionItems.list({ subscription: raw.id, limit: PAGE_SIZE })) {
        items.push(item);
      }
    }

    const discounts: Discount[] = [];
    for (const d of raw.discounts) {
      if (typeof d === "string" || d.source.coupon === null) continue;
      discounts.push(mapDiscount(d, await coupon(d.source.coupon)));
    }

    return {
      id: raw.id,
      customerId: idOf(raw.customer) ?? "",
      status: raw.status as SubscriptionStatus,
      currency: raw.currency,
      items: items.map(mapSubscriptionItem),
      discounts,
      created: raw.created,
      endedAt: raw.ended_at ?? (raw.status === "canceled" ? raw.canceled_at : null),
    };
  }
}

export function createStripeSource(apiKey: string, appVersion: string): StripeSource {
  const client = new Stripe(apiKey, {
    maxNetworkRetries: 2,
    appInfo: { name: "mcp-stripe-revenue-server", version: appVersion },
  });
  return new StripeSource(client);
}

/** Warn about keys that grant more than read access. */
export function describeKeyRisk(apiKey: string): string | null {
  if (apiKey.startsWith("sk_live_") || apiKey.startsWith("sk_test_")) {
    return (
      "STRIPE_API_KEY is an unrestricted secret key (sk_...). " +
      "Create a restricted key (rk_...) with read-only access to Subscriptions, Invoices and Coupons instead."
    );
  }
  return null;
}
