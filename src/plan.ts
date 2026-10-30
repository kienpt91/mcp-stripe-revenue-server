import { DEMO_NOW, createDemoSource } from "./demo-data.js";
import { createStripeSource, describeKeyRisk } from "./stripe-source.js";
import type { RevenueSource } from "./types.js";
import { packageVersion } from "./version.js";

export const USAGE = `mcp-stripe-revenue-server ${packageVersion}

Read-only Stripe revenue analytics over the Model Context Protocol (stdio).

Usage:
  mcp-stripe-revenue-server            use live data; requires STRIPE_API_KEY
  mcp-stripe-revenue-server --demo     use built-in sample data, no key needed
  mcp-stripe-revenue-server --help

Environment:
  STRIPE_API_KEY   restricted key (rk_...) with read access to Subscriptions,
                   Invoices and Coupons
`;

export interface CliEnv {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

export type CliPlan =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; source: RevenueSource; now?: () => number; warning: string | null };

/** Decide what to run from the arguments and environment, without starting anything. */
export function planCli({ argv, env }: CliEnv): CliPlan {
  const flags = new Set(argv);
  if (flags.has("--help") || flags.has("-h")) return { kind: "help" };

  const unknown = argv.filter((a) => a !== "--demo");
  if (unknown.length > 0) {
    return { kind: "error", message: `Unknown argument: ${unknown[0]}\n\n${USAGE}` };
  }

  if (flags.has("--demo")) {
    return { kind: "run", source: createDemoSource(), now: () => DEMO_NOW, warning: null };
  }

  const apiKey = env.STRIPE_API_KEY?.trim();
  if (!apiKey) {
    return {
      kind: "error",
      message: "STRIPE_API_KEY is not set. Provide a restricted read-only key, or pass --demo to use sample data.",
    };
  }
  return { kind: "run", source: createStripeSource(apiKey, packageVersion), warning: describeKeyRisk(apiKey) };
}
