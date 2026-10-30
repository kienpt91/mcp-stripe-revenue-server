#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { USAGE, planCli } from "./plan.js";
import { createRevenueServer } from "./server.js";

async function main(): Promise<void> {
  const plan = planCli({ argv: process.argv.slice(2), env: process.env });
  if (plan.kind === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (plan.kind === "error") {
    process.stderr.write(`${plan.message}\n`);
    process.exitCode = 1;
    return;
  }

  // stdout carries the protocol stream, so every diagnostic goes to stderr.
  if (plan.warning) process.stderr.write(`warning: ${plan.warning}\n`);
  const server = createRevenueServer({
    source: plan.source,
    redactEmails: plan.redactEmails,
    ...(plan.now ? { now: plan.now } : {}),
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write("mcp-stripe-revenue-server ready on stdio\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
