/**
 * Exact-duplicate strip between description and advisor_note on place rows.
 * Zero information loss — only omits advisor_note when byte-identical to description.
 * Does not blind-truncate unique advisory facts.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function dedupeRow(row: Record<string, unknown>): Record<string, unknown> {
  const description =
    typeof row.description === "string" ? row.description : null;
  const advisor =
    typeof row.advisor_note === "string" ? row.advisor_note : null;
  if (description != null && advisor != null && description === advisor) {
    const next = { ...row };
    delete next.advisor_note;
    return next;
  }
  return row;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(walk);
  }
  if (!isRecord(value)) {
    return value;
  }

  if (
    ("description" in value || "advisor_note" in value) &&
    (typeof value.description === "string" ||
      typeof value.advisor_note === "string")
  ) {
    const deduped = dedupeRow(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(deduped)) {
      out[key] = walk(child);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = walk(child);
  }
  return out;
}

/**
 * Strip exact description/advisor_note duplicates in structured or text JSON payloads.
 */
export function dedupePlaceDescriptionAdvisorNote(payload: unknown): unknown {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return payload;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const next = walk(parsed);
      return JSON.stringify(next, null, 2);
    } catch {
      return payload;
    }
  }
  return walk(payload);
}
