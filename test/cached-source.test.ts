import { describe, expect, it, vi } from "vitest";
import { CachedSource } from "../src/cached-source.js";
import type { RevenueSource } from "../src/types.js";
import { failedInvoice, paidInvoice, sub, ts } from "./helpers.js";

function countingSource() {
  const listSubscriptions = vi.fn(async () => [sub()]);
  const listFailedInvoices = vi.fn(async () => [
    failedInvoice({ id: "in_early", created: ts("2025-06-01T00:00:00Z") }),
    failedInvoice({ id: "in_mid", created: ts("2025-06-10T00:00:00Z") }),
  ]);
  const listPaidInvoices = vi.fn(async () => [paidInvoice({ id: "in_paid", paidAt: ts("2025-06-10T00:00:00Z") })]);
  const inner: RevenueSource = { listSubscriptions, listFailedInvoices, listPaidInvoices };
  return { inner, listSubscriptions, listFailedInvoices, listPaidInvoices };
}

const DAY = 86_400;
const range = { from: ts("2025-06-01T00:00:00Z"), to: ts("2025-06-15T00:00:00Z") };

describe("CachedSource", () => {
  it("serves repeated subscription reads from the cache until the TTL expires", async () => {
    const { inner, listSubscriptions } = countingSource();
    let t = 1_000_000;
    const cached = new CachedSource(inner, 60, () => t);

    await cached.listSubscriptions();
    t += 59_999;
    await cached.listSubscriptions();
    expect(listSubscriptions).toHaveBeenCalledTimes(1);

    t += 1;
    await cached.listSubscriptions();
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("shares one underlying call between concurrent requests", async () => {
    const { inner, listSubscriptions } = countingSource();
    const cached = new CachedSource(inner, 60, () => 0);
    await Promise.all([cached.listSubscriptions(), cached.listSubscriptions(), cached.listSubscriptions()]);
    expect(listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const listSubscriptions = vi
      .fn<RevenueSource["listSubscriptions"]>()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValue([sub()]);
    const cached = new CachedSource({ ...countingSource().inner, listSubscriptions }, 60, () => 0);

    await expect(cached.listSubscriptions()).rejects.toThrow("rate limited");
    await expect(cached.listSubscriptions()).resolves.toHaveLength(1);
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("reuses invoice lists for a sliding window of the same length and re-filters to the requested range", async () => {
    const { inner, listFailedInvoices, listPaidInvoices } = countingSource();
    const cached = new CachedSource(inner, 60, () => 0);

    expect((await cached.listFailedInvoices(range)).map((i) => i.id)).toEqual(["in_early", "in_mid"]);

    // same 14-day window, shifted 2 days later: in_early falls out of range
    const shifted = { from: range.from + 2 * DAY, to: range.to + 2 * DAY };
    expect((await cached.listFailedInvoices(shifted)).map((i) => i.id)).toEqual(["in_mid"]);
    expect(listFailedInvoices).toHaveBeenCalledTimes(1);

    await cached.listPaidInvoices(range);
    expect(await cached.listPaidInvoices({ from: range.from + 20 * DAY, to: range.to + 20 * DAY })).toEqual([]);
    expect(listPaidInvoices).toHaveBeenCalledTimes(1);
  });

  it("keeps different window lengths separate", async () => {
    const { inner, listFailedInvoices } = countingSource();
    const cached = new CachedSource(inner, 60, () => 0);
    await cached.listFailedInvoices(range);
    await cached.listFailedInvoices({ from: range.from - 10 * DAY, to: range.to });
    expect(listFailedInvoices).toHaveBeenCalledTimes(2);
  });

  it("with a TTL of zero always reads through", async () => {
    const { inner, listSubscriptions } = countingSource();
    const cached = new CachedSource(inner, 0, () => 0);
    await cached.listSubscriptions();
    await cached.listSubscriptions();
    expect(listSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("rejects a negative or non-finite TTL", () => {
    expect(() => new CachedSource(countingSource().inner, -1)).toThrow(RangeError);
    expect(() => new CachedSource(countingSource().inner, Number.NaN)).toThrow(RangeError);
  });
});
