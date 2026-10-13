import { rememberFideKind, uncachedFideIds } from "./kind-cache";
import type { PeekEntityKind } from "./schema";

const KINDS = new Set<string>(["hotel", "activity", "attraction", "destination"]);

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value as Record<string, unknown>[];
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.rows)) {
      return record.rows as Record<string, unknown>[];
    }
    if (record.result) {
      return rowsOf(record.result);
    }
  }
  return [];
}

/**
 * Browser-side kind load: asks the server (`kindOf` context query) for the
 * graph kind of each uncached Fide id and fills the shared kind cache.
 */
export async function ensureFideKindsViaApi(ids: readonly string[]): Promise<void> {
  const missing = uncachedFideIds(ids);
  if (missing.length === 0) {
    return;
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "kindOf",
        params: { fideIds: missing.join(",") },
      }),
    }
  );
  if (!response.ok) {
    return;
  }

  const payload = (await response.json()) as { result?: unknown };
  for (const row of rowsOf(payload.result)) {
    const fideId = typeof row.fide_id === "string" ? row.fide_id : null;
    const kind = typeof row.kind === "string" ? row.kind : null;
    if (fideId && kind && KINDS.has(kind)) {
      rememberFideKind(fideId, kind as PeekEntityKind);
    }
  }
}
