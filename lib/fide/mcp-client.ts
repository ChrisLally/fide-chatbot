import "server-only";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { loadFideMcpConnection } from "./mcp-config";

const allowedFideMcpToolNames = [
  "list_world_models",
  "list_views",
  "get_view",
  "run_view",
] as const;

const MCP_TOOLS_LOAD_ATTEMPTS = 6;
const MCP_TOOLS_RETRY_DELAY_MS = 750;

function retryDelayMs(error: unknown, attempt: number): number {
  const text = error instanceof Error ? error.message : String(error);
  const waking = /runner_waking/.test(text);
  const match = text.match(/retryAfterSeconds["\s:]+(\d+)/i);
  if (waking || match) {
    const seconds = match ? Number(match[1]) : 5;
    const waitMs = Number.isFinite(seconds)
      ? Math.min(Math.max(seconds, 1), 30) * 1000
      : 5000;
    return waitMs + 250;
  }
  return MCP_TOOLS_RETRY_DELAY_MS * attempt;
}

function filterFideMcpTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    allowedFideMcpToolNames.flatMap((name) =>
      tools[name] ? [[name, tools[name]]] : []
    )
  ) as ToolSet;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createFideMcpClient(): Promise<MCPClient | null> {
  const connection = loadFideMcpConnection();
  if (!connection) {
    return null;
  }

  return createMCPClient({
    transport: {
      type: "http",
      url: connection.url,
      headers: connection.headers,
    },
  });
}

export async function loadFideMcpTools(): Promise<{
  client: MCPClient;
  tools: ToolSet;
} | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MCP_TOOLS_LOAD_ATTEMPTS; attempt++) {
    const client = await createFideMcpClient();
    if (!client) {
      return null;
    }

    try {
      const tools = filterFideMcpTools(
        (await client.tools()) as ToolSet
      );
      return { client, tools };
    } catch (error) {
      lastError = error;
      await client.close().catch(() => undefined);

      if (attempt < MCP_TOOLS_LOAD_ATTEMPTS) {
        await sleep(retryDelayMs(error, attempt));
      }
    }
  }

  throw lastError;
}
