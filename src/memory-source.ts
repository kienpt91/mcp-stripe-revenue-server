import type {
  FailedInvoice,
  PaidInvoice,
  RevenueSource,
  Subscription,
  TimeRange,
} from "./types.js";

export interface MemoryData {
  subscriptions: Subscription[];
  failedInvoices: FailedInvoice[];
  paidInvoices: PaidInvoice[];
}

/** In-memory `RevenueSource`. Applies the same filtering contract as the Stripe-backed source. */
export class MemorySource implements RevenueSource {
  constructor(private readonly data: MemoryData) {}

  async listSubscriptions(): Promise<Subscription[]> {
    return [...this.data.subscriptions];
  }

  async listFailedInvoices(range: TimeRange): Promise<FailedInvoice[]> {
    return this.data.failedInvoices.filter((i) => i.created >= range.from && i.created < range.to);
  }

  async listPaidInvoices(range: TimeRange): Promise<PaidInvoice[]> {
    return this.data.paidInvoices.filter((i) => i.paidAt >= range.from && i.paidAt < range.to);
  }
}
