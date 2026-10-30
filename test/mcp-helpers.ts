import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DEMO_NOW, createDemoSource } from "../src/demo-data.js";
import { createRevenueServer } from "../src/server.js";
import type { RevenueSource } from "../src/types.js";

export interface Connected {
  client: Client;
  close: () => Promise<void>;
}

/** Connect an SDK client to a server over a linked in-memory transport pair. */
export async function connect(
  source: RevenueSource = createDemoSource(),
  now: () => number = () => DEMO_NOW,
): Promise<Connected> {
  const server = createRevenueServer({ source, now });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface ToolOutput {
  isError: boolean;
  text: string;
  json: any;
  structured: unknown;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolOutput> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.map((c) => c.text ?? "").join("\n");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // error results carry plain text
  }
  return { isError: result.isError === true, text, json, structured: result.structuredContent };
}
