import type { FailedInvoice, PaidInvoice, RevenueSource, Subscription, TimeRange } from "./types.js";

export const DEFAULT_CACHE_TTL_SECONDS = 60;

interface Entry<T> {
  expiresAt: number;
  value: Promise<T>;
}

/**
 * Wraps a `RevenueSource` with a short time-based cache so a burst of tool calls
 * (or one `revenue_summary`) does not trigger a full Stripe scan each time.
 *
 * - Concurrent identical requests share one underlying call.
 * - Failures are never cached.
 * - Invoice lists are keyed by window length, not by absolute range: the window
 *   slides with the clock, so a cached list is re-filtered to the requested range.
 *   Results can therefore be up to `ttlSeconds` stale, which is the point.
 */
export class CachedSource implements RevenueSource {
  private readonly entries = new Map<string, Entry<unknown>>();

  constructor(
    private readonly inner: RevenueSource,
    private readonly ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
    /** Milliseconds clock, injectable for tests. */
    private readonly clock: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      throw new RangeError(`ttlSeconds must be a non-negative number, got ${ttlSeconds}`);
    }
  }

  listSubscriptions(): Promise<Subscription[]> {
    return this.cached("subscriptions", () => this.inner.listSubscriptions());
  }

  async listFailedInvoices(range: TimeRange): Promise<FailedInvoice[]> {
    const all = await this.cached(`failed:${range.to - range.from}`, () => this.inner.listFailedInvoices(range));
    return all.filter((i) => i.created >= range.from && i.created < range.to);
  }

  async listPaidInvoices(range: TimeRange): Promise<PaidInvoice[]> {
    const all = await this.cached(`paid:${range.to - range.from}`, () => this.inner.listPaidInvoices(range));
    return all.filter((i) => i.paidAt >= range.from && i.paidAt < range.to);
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlSeconds === 0) return load();

    const now = this.clock();
    const hit = this.entries.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > now) return hit.value;

    const value = load();
    const entry: Entry<T> = { expiresAt: now + this.ttlSeconds * 1000, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }
}
