import { CachedSource, DEFAULT_CACHE_TTL_SECONDS } from "./cached-source.js";
import { DEMO_NOW, createDemoSource } from "./demo-data.js";
import { DEFAULT_MAX_ITEMS, createStripeSource, describeKeyRisk } from "./stripe-source.js";
import type { RevenueSource } from "./types.js";
import { packageVersion } from "./version.js";

export const USAGE = `mcp-stripe-revenue-server ${packageVersion}

Read-only Stripe revenue analytics over the Model Context Protocol (stdio).

Usage:
  mcp-stripe-revenue-server            use live data; requires STRIPE_API_KEY
  mcp-stripe-revenue-server --demo     use built-in sample data, no key needed
  mcp-stripe-revenue-server --help

Environment:
  STRIPE_API_KEY             restricted key (rk_...) with read access to
                             Subscriptions, Invoices and Coupons
  STRIPE_CACHE_TTL_SECONDS   how long Stripe lists are cached (default ${DEFAULT_CACHE_TTL_SECONDS}, 0 disables)
  STRIPE_MAX_ITEMS           stop after reading this many objects per list
                             (default ${DEFAULT_MAX_ITEMS})
  REDACT_EMAILS              "true" masks customer emails in tool output
                             (default false)
`;

export interface CliEnv {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

export type CliPlan =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      source: RevenueSource;
      now?: () => number;
      warning: string | null;
      redactEmails: boolean;
    };

function parseNumber(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
): number | { error: string } {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    return { error: `${name} must be an integer >= ${min}, got "${raw}"` };
  }
  return value;
}

function parseBoolean(raw: string | undefined, name: string): boolean | { error: string } {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return { error: `${name} must be "true" or "false", got "${raw}"` };
}

/** Decide what to run from the arguments and environment, without starting anything. */
export function planCli({ argv, env }: CliEnv): CliPlan {
  const flags = new Set(argv);
  if (flags.has("--help") || flags.has("-h")) return { kind: "help" };

  const unknown = argv.filter((a) => a !== "--demo");
  if (unknown.length > 0) {
    return { kind: "error", message: `Unknown argument: ${unknown[0]}\n\n${USAGE}` };
  }

  const redactEmails = parseBoolean(env.REDACT_EMAILS, "REDACT_EMAILS");
  if (typeof redactEmails === "object") return { kind: "error", message: redactEmails.error };

  if (flags.has("--demo")) {
    return { kind: "run", source: createDemoSource(), now: () => DEMO_NOW, warning: null, redactEmails };
  }

  const apiKey = env.STRIPE_API_KEY?.trim();
  if (!apiKey) {
    return {
      kind: "error",
      message: "STRIPE_API_KEY is not set. Provide a restricted read-only key, or pass --demo to use sample data.",
    };
  }

  const ttl = parseNumber(env.STRIPE_CACHE_TTL_SECONDS, "STRIPE_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS, 0);
  if (typeof ttl === "object") return { kind: "error", message: ttl.error };
  const maxItems = parseNumber(env.STRIPE_MAX_ITEMS, "STRIPE_MAX_ITEMS", DEFAULT_MAX_ITEMS, 1);
  if (typeof maxItems === "object") return { kind: "error", message: maxItems.error };

  return {
    kind: "run",
    source: new CachedSource(createStripeSource(apiKey, packageVersion, maxItems), ttl),
    warning: describeKeyRisk(apiKey),
    redactEmails,
  };
}
