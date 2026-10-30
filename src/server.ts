import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  SECONDS_PER_DAY,
  computeChurn,
  computeFailedPayments,
  computeMrr,
  computeRevenueSummary,
} from "./calc.js";
import {
  presentChurn,
  presentFailedPayments,
  presentMrr,
  presentSummary,
} from "./present.js";
import { redactSecrets } from "./redact.js";
import type { RevenueSource, TimeRange } from "./types.js";
import { packageVersion } from "./version.js";

export interface RevenueServerOptions {
  source: RevenueSource;
  /** Current time in Unix seconds. Injectable so tests and demo mode are deterministic. */
  now?: () => number;
  /** Mask customer emails in tool output (j***@example.com). Default false. */
  redactEmails?: boolean;
}

const days = z
  .number()
  .int()
  .min(1)
  .max(365)
  .default(30)
  .describe("Length of the look-back window in days, ending now (1-365, default 30).");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function ok(payload: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

function fail(tool: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: redactSecrets(`${tool} failed: ${message}`) }] };
}

export function createRevenueServer(options: RevenueServerOptions): McpServer {
  const { source } = options;
  const redactEmails = options.redactEmails ?? false;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const server = new McpServer({ name: "mcp-stripe-revenue-server", version: packageVersion });

  const window = (windowDays: number): TimeRange => {
    const to = now();
    return { from: to - windowDays * SECONDS_PER_DAY, to };
  };

  server.registerTool(
    "get_mrr",
    {
      title: "Monthly recurring revenue",
      description:
        "Current MRR and ARR per currency. Counts active and past_due subscriptions, normalizes " +
        "yearly/weekly/daily/multi-month prices and quantities to a monthly amount, and applies " +
        "percent_off / amount_off discounts that are active right now. Amounts are in minor " +
        "units (cents); currencies are never combined.",
      annotations: { title: "Monthly recurring revenue", ...READ_ONLY },
    },
    async () => {
      try {
        const at = now();
        const subscriptions = await source.listSubscriptions();
        return ok(presentMrr(computeMrr(subscriptions, at), at));
      } catch (error) {
        return fail("get_mrr", error);
      }
    },
  );

  server.registerTool(
    "get_churn",
    {
      title: "Subscription and customer churn",
      description:
        "Churn over the last N days: subscriptions and customers that existed at the start of the " +
        "window and had ended by its close, as a rate (null when nothing existed at the start), " +
        "plus churned MRR per currency.",
      inputSchema: { days },
      annotations: { title: "Subscription and customer churn", ...READ_ONLY },
    },
    async ({ days: windowDays }) => {
      try {
        const subscriptions = await source.listSubscriptions();
        return ok(presentChurn(computeChurn(subscriptions, window(windowDays))));
      } catch (error) {
        return fail("get_churn", error);
      }
    },
  );

  server.registerTool(
    "list_failed_payments",
    {
      title: "Failed payments",
      description:
        "Invoices from the last N days that Stripe tried to collect at least once and that are " +
        "still unpaid (open or uncollectible), newest first, with amount, customer and attempt " +
        "count. Totals cover every match; `limit` only truncates the invoice list.",
      inputSchema: {
        days,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum number of invoices to list (1-100, default 25)."),
      },
      annotations: { title: "Failed payments", ...READ_ONLY },
    },
    async ({ days: windowDays, limit }) => {
      try {
        const range = window(windowDays);
        const invoices = await source.listFailedInvoices(range);
        return ok(presentFailedPayments(computeFailedPayments(invoices, range, limit), range, { redactEmails }));
      } catch (error) {
        return fail("list_failed_payments", error);
      }
    },
  );

  server.registerTool(
    "revenue_summary",
    {
      title: "Revenue summary",
      description:
        "One-call overview for the last N days: current MRR, cash collected from paid invoices, " +
        "failed payment totals and churn. Every money figure is grouped per currency.",
      inputSchema: { days },
      annotations: { title: "Revenue summary", ...READ_ONLY },
    },
    async ({ days: windowDays }) => {
      try {
        const range = window(windowDays);
        const [subscriptions, failedInvoices, paidInvoices] = await Promise.all([
          source.listSubscriptions(),
          source.listFailedInvoices(range),
          source.listPaidInvoices(range),
        ]);
        return ok(presentSummary(computeRevenueSummary({ subscriptions, failedInvoices, paidInvoices, range })));
      } catch (error) {
        return fail("revenue_summary", error);
      }
    },
  );

  return server;
}
