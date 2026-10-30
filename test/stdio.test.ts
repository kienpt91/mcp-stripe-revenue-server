import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = ["--import", "tsx", "src/cli.ts"];

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "STRIPE_API_KEY") env[key] = value;
  }
  return env;
}

describe("stdio process in --demo mode", () => {
  let client: Client;
  const stderr: string[] = [];

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...cli, "--demo"],
      cwd: root,
      env: cleanEnv(),
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
    client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("completes the MCP handshake and lists the tools", async () => {
    expect(client.getServerVersion()?.name).toBe("mcp-stripe-revenue-server");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_churn",
      "get_mrr",
      "list_failed_payments",
      "revenue_summary",
    ]);
  });

  it("serves deterministic demo results through real stdio framing", async () => {
    const result = await client.callTool({ name: "get_mrr", arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: "text"; text: string }>;
    const mrr = JSON.parse(content[0]!.text);
    expect(mrr.asOf).toBe("2025-06-15T12:00:00.000Z");
    expect(mrr.byCurrency.find((c: { currency: string }) => c.currency === "usd")).toMatchObject({
      mrr: 67_133,
      subscriptions: 11,
    });

    const failed = await client.callTool({ name: "list_failed_payments", arguments: { limit: 1 } });
    const failedText = (failed.content as Array<{ text: string }>)[0]!.text;
    expect(JSON.parse(failedText).invoices).toHaveLength(1);
  });

  it("keeps diagnostics on stderr", () => {
    expect(stderr.join("")).toContain("ready on stdio");
  });
});

describe("cli process", () => {
  const run = (args: string[], env: Record<string, string> = cleanEnv()) =>
    spawnSync(process.execPath, [...cli, ...args], { cwd: root, env, encoding: "utf8", timeout: 15_000 });

  it("exits with an explanation when neither a key nor --demo is given", () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("STRIPE_API_KEY is not set");
    expect(result.stdout).toBe("");
  });

  it("prints usage for --help", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--demo");
    expect(result.stdout).toContain("STRIPE_API_KEY");
  });
});
