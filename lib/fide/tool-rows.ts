/**
 * Rows from a Fide run_view / run_query tool result.
 *
 * The rows are in `structuredContent.result.rows`. The text content is a markdown rendering
 * for people and does not carry every column (place names are missing from it), so readers
 * must use the structured rows.
 */
export function rowsFromToolResult(
  result: unknown
): Record<string, unknown>[] | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const structured = (result as { structuredContent?: unknown })
    .structuredContent;
  if (!structured || typeof structured !== "object") {
    return null;
  }
  const inner = (structured as { result?: unknown }).result;
  if (!inner || typeof inner !== "object") {
    return null;
  }
  const rows = (inner as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    return null;
  }
  return rows.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object"
  );
}
