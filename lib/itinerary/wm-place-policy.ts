import "server-only";

import { createFideMcpClient } from "@/lib/fide/mcp-client";
import { rowsFromToolResult } from "@/lib/fide/tool-rows";
import { type PlacePolicyMap, placePolicyFromViewRow } from "./place-policy";
import { fideIdHex, normalizeDid } from "./schema";

export type { PlacePolicy, PlacePolicyMap } from "./place-policy";
export { placePolicyFromViewRow, policyForStop } from "./place-policy";

const WORLD_MODEL =
  process.env.FIDE_WORLD_MODEL_KEY?.trim() || "catalina-world-model";

/**
 * Live place policy from catalina-world-model `inventory/place`.
 * Fail-open: missing MCP / empty rows → empty map (no invented hard rules).
 */
export async function loadPlacePoliciesFromWorldModel(
  placeIds: string[]
): Promise<PlacePolicyMap> {
  const unique = [
    ...new Set(
      placeIds
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id && fideIdHex(id)))
        .map(normalizeDid)
    ),
  ];
  const out: PlacePolicyMap = new Map();
  if (unique.length === 0) {
    return out;
  }

  const client = await createFideMcpClient();
  if (!client) {
    throw new Error(
      "Fide MCP is not configured, so place rules (stay nights, incompatible overnights) cannot be checked. Set the FIDE_* values in chatbot/.env."
    );
  }

  try {
    const tools = await client.tools();
    const runView = tools.run_view as unknown as
      | {
          execute?: (input: unknown, options?: unknown) => Promise<unknown>;
        }
      | undefined;
    if (!runView?.execute) {
      throw new Error("Fide MCP has no run_view tool, so place rules cannot be checked.");
    }

    await Promise.all(
      unique.map(async (fideId) => {
        try {
          const raw = await runView.execute!(
            {
              worldModelKey: WORLD_MODEL,
              viewKey: "inventory/place",
              params: { fideId },
            },
            { toolCallId: `policy-${fideId}`, messages: [] }
          );
          const rows = rowsFromToolResult(raw);
          if (!rows) {
            throw new Error(`inventory/place returned no rows for ${fideId}`);
          }
          const policy = rows[0] ? placePolicyFromViewRow(rows[0]) : null;
          if (policy) {
            out.set(normalizeDid(policy.fideId), policy);
            out.set(fideId, policy);
          }
        } catch (error) {
          throw new Error(
            `Place rules for ${fideId} could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          );
        }
      })
    );
  } finally {
    await client.close().catch(() => undefined);
  }

  return out;
}
