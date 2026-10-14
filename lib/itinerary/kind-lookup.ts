import "server-only";

import { createFideMcpClient } from "@/lib/fide/mcp-client";
import { fideIdsIn, rememberFideKind, uncachedFideIds } from "./kind-cache";

export { fideIdsIn };

import { rowsFromToolResult } from "@/lib/fide/tool-rows";
import type { PeekEntityKind } from "./schema";

const WORLD_MODEL =
  process.env.FIDE_WORLD_MODEL_KEY?.trim() || "catalina-world-model";
const KIND_VIEW = "inventory/kind-of";
const KINDS = new Set<string>([
  "hotel",
  "activity",
  "attraction",
  "destination",
]);

type RunViewTool = {
  execute?: (input: unknown, options?: unknown) => Promise<unknown>;
};

/**
 * Load routing kinds for Fide ids from the graph's kind Statements into the
 * kind cache. Ids the graph does not know stay uncached and are rejected by
 * the validators (fail closed).
 */
export async function ensureFideKinds(ids: readonly string[]): Promise<void> {
  const missing = uncachedFideIds(ids);
  if (missing.length === 0) {
    return;
  }

  const client = await createFideMcpClient();
  if (!client) {
    throw new Error(
      "Fide MCP is not configured, so entity kinds cannot be checked. Set the FIDE_* values in chatbot/.env."
    );
  }

  try {
    const tools = await client.tools();
    const runView = tools.run_view as unknown as RunViewTool | undefined;
    if (!runView?.execute) {
      throw new Error("Fide MCP has no run_view tool, so entity kinds cannot be checked.");
    }

    const raw = await runView.execute(
      {
        worldModelKey: WORLD_MODEL,
        viewKey: KIND_VIEW,
        params: { fideIds: missing.join(",") },
      },
      { toolCallId: "kind-of", messages: [] }
    );

    const rows = rowsFromToolResult(raw);
    if (!rows) {
      throw new Error(`kind-of returned no rows for ${missing.join(",")}`);
    }
    for (const row of rows) {
      const fideId = typeof row.fide_id === "string" ? row.fide_id : null;
      const kind = typeof row.kind === "string" ? row.kind : null;
      if (fideId && kind && KINDS.has(kind)) {
        rememberFideKind(fideId, kind as PeekEntityKind);
      }
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}
