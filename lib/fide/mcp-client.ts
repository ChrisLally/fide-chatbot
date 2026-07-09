import "server-only";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { loadFideMcpConnection } from "./mcp-config";

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
    const tools = await client.tools();
    return { client, tools };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
