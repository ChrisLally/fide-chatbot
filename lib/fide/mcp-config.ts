import { z } from "zod";

const mcpServerConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

const mcpConfigSchema = z.object({
  mcpServers: z.record(mcpServerConfigSchema),
});

export type FideMcpConnection = {
  url: string;
  headers: Record<string, string>;
};

function connectionFromParts(
  url: string,
  headers: Record<string, string>
): FideMcpConnection | null {
  const apiKey = headers["x-api-key"] ?? headers["X-Api-Key"];
  const runnerId = headers["x-fide-runner-public-id"];
  const workspaceId = headers["x-fide-workspace-public-id"];

  if (!apiKey || !runnerId || !workspaceId) {
    return null;
  }

  return {
    url,
    headers: {
      "x-api-key": apiKey,
      "x-fide-runner-public-id": runnerId,
      "x-fide-workspace-public-id": workspaceId,
    },
  };
}

export function loadFideMcpConnection(
  serverName = process.env.FIDE_MCP_SERVER ?? "fide"
): FideMcpConnection | null {
  const raw = process.env.MCP_CONFIG?.trim();
  if (raw) {
    try {
      const parsed = mcpConfigSchema.parse(JSON.parse(raw));
      const server =
        parsed.mcpServers[serverName] ??
        Object.values(parsed.mcpServers).at(0);
      if (!server) {
        return null;
      }
      return connectionFromParts(server.url, server.headers ?? {});
    } catch (error) {
      console.error("Invalid MCP_CONFIG:", error);
      return null;
    }
  }

  const apiKey = process.env.FIDE_API_KEY;
  const runnerId = process.env.FIDE_RUNNER_PUBLIC_ID;
  const workspaceId = process.env.FIDE_WORKSPACE_PUBLIC_ID;
  const gatewayUrl =
    process.env.FIDE_GATEWAY_URL ?? "https://test.fide.work";

  if (!apiKey || !runnerId || !workspaceId) {
    return null;
  }

  return connectionFromParts(`${gatewayUrl.replace(/\/$/, "")}/mcp`, {
    "x-api-key": apiKey,
    "x-fide-runner-public-id": runnerId,
    "x-fide-workspace-public-id": workspaceId,
  });
}

export function isFideMcpConfigured(): boolean {
  return loadFideMcpConnection() !== null;
}
