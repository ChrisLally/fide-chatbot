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

function filterFideMcpTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    allowedFideMcpToolNames.flatMap((name) =>
      tools[name] ? [[name, tools[name]]] : []
    )
  ) as ToolSet;
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
  const client = await createFideMcpClient();
  if (!client) {
    return null;
  }

  try {
    const tools = filterFideMcpTools(await client.tools());
    return { client, tools };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
