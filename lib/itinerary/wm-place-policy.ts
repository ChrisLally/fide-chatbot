import "server-only";

import { createFideMcpClient } from "@/lib/fide/mcp-client";
import {
  placePolicyFromViewRow,
  type PlacePolicyMap,
} from "./place-policy";
import { fideIdHex, normalizeDid } from "./schema";

export type { PlacePolicy, PlacePolicyMap } from "./place-policy";
export { placePolicyFromViewRow, policyForStop } from "./place-policy";

const WORLD_MODEL =
  process.env.FIDE_WORLD_MODEL_KEY?.trim() || "catalina-world-model";

function rowsFromRunView(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const nested = record.result;
  if (nested && typeof nested === "object") {
    const inner = nested as Record<string, unknown>;
    const deep = inner.result;
    if (deep && typeof deep === "object") {
      const rows = (deep as { rows?: unknown }).rows;
      if (Array.isArray(rows)) {
        return rows.filter(
          (row): row is Record<string, unknown> =>
            !!row && typeof row === "object"
        );
      }
    }
    const rows = (inner as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === "object"
      );
    }
  }
  if (Array.isArray(record.rows)) {
    return record.rows.filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === "object"
    );
  }
  return [];
}

function extractMcpJson(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return result;
  }
  const text = content
    .map((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: string }).type === "text" &&
      typeof (part as { text?: string }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .join("")
    .trim();
  if (!text) {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return result;
  }
}

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
    return out;
  }

  try {
    const tools = await client.tools();
    const runView = tools.run_view as unknown as
      | {
          execute?: (
            input: unknown,
            options?: unknown
          ) => Promise<unknown>;
        }
      | undefined;
    if (!runView?.execute) {
      return out;
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
          const parsed = extractMcpJson(raw);
          const rows = rowsFromRunView(parsed);
          const policy = rows[0] ? placePolicyFromViewRow(rows[0]) : null;
          if (policy) {
            out.set(normalizeDid(policy.fideId), policy);
            out.set(fideId, policy);
          }
        } catch {
          // fail-open per place
        }
      })
    );
  } finally {
    await client.close().catch(() => undefined);
  }

  return out;
}
