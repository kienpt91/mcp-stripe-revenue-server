import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_NOW } from "../src/demo-data.js";
import { MemorySource } from "../src/memory-source.js";
import type { RevenueSource } from "../src/types.js";
import { call, connect, type Connected } from "./mcp-helpers.js";

describe("MCP server over a linked in-memory transport", () => {
  let session: Connected;

  beforeEach(async () => {
    session = await connect();
  });

  afterEach(async () => {
    await session.close();
  });

  it("announces itself and lists exactly the four read-only tools", async () => {
    expect(session.client.getServerVersion()?.name).toBe("mcp-stripe-revenue-server");

    const { tools } = await session.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_churn",
      "get_mrr",
      "list_failed_payments",
      "revenue_summary",
    ]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }

    const failed = tools.find((t) => t.name === "list_failed_payments");
    expect(Object.keys(failed?.inputSchema.properties ?? {}).sort()).toEqual(["days", "limit"]);
  });

  it("get_mrr returns per-currency MRR with discounts and intervals applied", async () => {
    const out = await call(session.client, "get_mrr");
    expect(out.isError).toBe(false);
    expect(out.structured).toEqual(out.json);
    expect(out.json.asOf).toBe("2025-06-15T12:00:00.000Z");

    const byCurrency = Object.fromEntries(out.json.byCurrency.map((c: any) => [c.currency, c]));
    expect(Object.keys(byCurrency)).toEqual(["eur", "gbp", "jpy", "usd"]);
    expect(byCurrency.usd).toMatchObject({ mrr: 67_133, mrrFormatted: "671.33 USD", subscriptions: 11, customers: 10 });
    expect(byCurrency.eur).toMatchObject({ mrr: 7800, subscriptions: 2 });
    expect(byCurrency.gbp).toMatchObject({ mrr: 5000, arr: 60_000 }); // quarterly 150.00
    expect(byCurrency.jpy).toMatchObject({ mrr: 30_000, mrrFormatted: "30000 JPY" }); // zero-decimal
    expect(out.json.skippedItems).toBe(1);
  });

  it("get_churn defaults to 30 days and counts cancellations against the start cohort", async () => {
    const out = await call(session.client, "get_churn");
    expect(out.json.period).toEqual({ from: "2025-05-16T12:00:00.000Z", to: "2025-06-15T12:00:00.000Z" });
    expect(out.json.subscriptions).toEqual({ activeAtStart: 16, canceled: 3, churnRate: 0.1875, newInPeriod: 3 });
    // customer 17 switched plans inside the window, so only 2 of the 3 cancellations are churned customers
    expect(out.json.customers).toEqual({ activeAtStart: 15, churned: 2, churnRate: 0.1333 });
    const usd = out.json.revenueByCurrency.find((r: any) => r.currency === "usd");
    expect(usd).toMatchObject({ mrrAtStart: 62_133, mrrChurned: 6800 });
  });

  it("get_churn honours the days argument", async () => {
    const out = await call(session.client, "get_churn", { days: 7 });
    expect(out.json.subscriptions).toEqual({ activeAtStart: 15, canceled: 0, churnRate: 0, newInPeriod: 1 });
  });

  it("list_failed_payments lists newest first and keeps totals independent of the limit", async () => {
    const out = await call(session.client, "list_failed_payments", { limit: 2 });
    expect(out.json.totalCount).toBe(4);
    expect(out.json.invoices.map((i: any) => i.id)).toEqual(["in_demo_failed_2", "in_demo_failed_1"]);
    expect(out.json.invoices[1]).toMatchObject({
      customerId: "cus_demo_10",
      customerEmail: "billing@northwind.example",
      amountDue: 4900,
      currency: "usd",
      attemptCount: 2,
      status: "open",
      nextPaymentAttempt: "2025-06-17T09:00:00.000Z",
    });
    expect(out.json.byCurrency).toEqual([
      { currency: "eur", count: 1, amountDue: 3900, amountDueFormatted: "39.00 EUR" },
      { currency: "usd", count: 3, amountDue: 10_800, amountDueFormatted: "108.00 USD" },
    ]);
  });

  it("list_failed_payments widens with days", async () => {
    const out = await call(session.client, "list_failed_payments", { days: 90 });
    expect(out.json.totalCount).toBe(5);
    expect(out.json.invoices.at(-1)).toMatchObject({ id: "in_demo_failed_5", status: "uncollectible" });
  });

  it("revenue_summary combines the other reports without mixing currencies", async () => {
    const summary = await call(session.client, "revenue_summary");
    const mrr = await call(session.client, "get_mrr");
    const churn = await call(session.client, "get_churn");
    const failed = await call(session.client, "list_failed_payments");

    expect(summary.json.mrr).toEqual(mrr.json);
    expect(summary.json.churn.subscriptions).toEqual(churn.json.subscriptions);
    expect(summary.json.failedPayments.byCurrency).toEqual(failed.json.byCurrency);

    const collected = Object.fromEntries(summary.json.collected.map((c: any) => [c.currency, c.collected]));
    expect(collected).toEqual({ eur: 3900, gbp: 15_000, jpy: 30_000, usd: 45_000 });
  });

  it("rejects arguments outside the declared schema", async () => {
    for (const args of [{ days: 0 }, { days: 400 }, { days: 1.5 }, { days: "30" }]) {
      const out = await call(session.client, "get_churn", args);
      expect(out.isError).toBe(true);
      expect(out.text).toMatch(/Invalid arguments for tool get_churn.*days/);
    }
    const limit = await call(session.client, "list_failed_payments", { limit: 101 });
    expect(limit.isError).toBe(true);
  });

  it("returns an empty but valid result for an account with no data", async () => {
    const empty = await connect(new MemorySource({ subscriptions: [], failedInvoices: [], paidInvoices: [] }));
    try {
      const mrr = await call(empty.client, "get_mrr");
      expect(mrr.json.byCurrency).toEqual([]);
      const churn = await call(empty.client, "get_churn");
      expect(churn.json.subscriptions.churnRate).toBeNull();
      expect(churn.json.customers.churnRate).toBeNull();
    } finally {
      await empty.close();
    }
  });
});

describe("REDACT_EMAILS", () => {
  it("masks customer emails in list_failed_payments when enabled and shows them otherwise", async () => {
    const plain = await connect();
    const masked = await connect(undefined, undefined, { redactEmails: true });
    try {
      const open = await call(plain.client, "list_failed_payments", { days: 90 });
      const hidden = await call(masked.client, "list_failed_payments", { days: 90 });
      expect(open.json.invoices.map((i: any) => i.customerEmail)).toContain("billing@northwind.example");
      expect(hidden.json.invoices.map((i: any) => i.customerEmail)).toEqual(
        open.json.invoices.map((i: any) => i.customerEmail.replace(/^(.)[^@]*/, "$1***")),
      );
      expect(hidden.text).not.toContain("billing@");
      expect(hidden.text).toContain("b***@northwind.example");
      expect(hidden.json.invoices.map((i: any) => i.id)).toEqual(open.json.invoices.map((i: any) => i.id));
    } finally {
      await plain.close();
      await masked.close();
    }
  });
});

describe("error handling", () => {
  it("reports source failures as tool errors and never leaks API keys", async () => {
    const key = ["sk", "live", "51HabcdefghijklmnopQRSTUV"].join("_");
    const broken: RevenueSource = {
      listSubscriptions: async () => {
        throw new Error(`Invalid API Key provided: ${key}`);
      },
      listFailedInvoices: async () => [],
      listPaidInvoices: async () => [],
    };
    const session = await connect(broken, () => DEMO_NOW);
    try {
      for (const tool of ["get_mrr", "get_churn", "revenue_summary"]) {
        const out = await call(session.client, tool);
        expect(out.isError).toBe(true);
        expect(out.text).toContain("Invalid API Key provided");
        expect(out.text).not.toContain(key);
      }
      // a failure in one tool does not take the server down
      const failed = await call(session.client, "list_failed_payments");
      expect(failed.isError).toBe(false);
    } finally {
      await session.close();
    }
  });
});
