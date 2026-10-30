import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, connect, type Connected } from "./mcp-helpers.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** Tool name -> arguments the README example was produced with. */
const EXAMPLES: Record<string, Record<string, unknown>> = {
  get_mrr: {},
  get_churn: {},
  list_failed_payments: { limit: 2 },
  revenue_summary: {},
};

function exampleFor(tool: string): unknown {
  const match = new RegExp(`<!-- example:${tool} -->\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(readme);
  if (!match) throw new Error(`README has no example for ${tool}`);
  return JSON.parse(match[1]!);
}

describe("README examples", () => {
  let session: Connected;

  beforeAll(async () => {
    session = await connect();
  });

  afterAll(async () => {
    await session.close();
  });

  for (const [tool, args] of Object.entries(EXAMPLES)) {
    it(`${tool} example matches the real demo output`, async () => {
      const out = await call(session.client, tool, args);
      expect(out.isError).toBe(false);
      expect(exampleFor(tool)).toEqual(out.json);
    });
  }

  it("documents every registered tool", async () => {
    const { tools } = await session.client.listTools();
    for (const tool of tools) expect(readme).toContain(`\`${tool.name}\``);
  });
});
