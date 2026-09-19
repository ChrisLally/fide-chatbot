/**
 * Agent-facing inventory views: block unbounded dumps; Context UI may still
 * call the same *-all queries via context/query.
 */

/** Unfiltered list views — hidden from list_views and refused by run_view. */
export const AGENT_BLOCKED_VIEW_KEYS = new Set([
  "inventory/hotels-all",
  "inventory/activities-all",
  "inventory/attractions-all",
  "inventory/transport-all",
  "inventory/itineraries-all",
  "inventory/advisor-links-all",
  "inventory/same-as-links",
  "inventory/places",
]);

/** Prefer these filtered list views instead. */
export const AGENT_FILTERED_LIST_HINTS: Record<string, string> = {
  "inventory/hotels-all": "inventory/hotels-by-city (required: city)",
  "inventory/activities-all": "inventory/activities-by-city (required: city)",
  "inventory/attractions-all": "inventory/attractions-by-city (required: city)",
  "inventory/transport-all":
    "inventory/transport-corridor (required: from and/or to)",
  "inventory/places": "inventory/places-search (required: q)",
  "inventory/itineraries-all":
    "Do not copy brochure templates into itineraries; look up places/hotels/activities by city instead",
  "inventory/advisor-links-all": "inventory/place (required: fideId)",
  "inventory/same-as-links": "inventory/cluster-members (required: fideId)",
};

export function normalizeViewKey(viewKey: string): string {
  return viewKey.trim().replace(/^\/+/, "");
}

export function isAgentBlockedView(viewKey: string): boolean {
  return AGENT_BLOCKED_VIEW_KEYS.has(normalizeViewKey(viewKey));
}

/** Views whose rows must not seed the itinerary entity allowlist. */
export function isNonBindableInventoryView(viewKey: string): boolean {
  const key = normalizeViewKey(viewKey).toLowerCase();
  return key.includes("itinerar") || key.includes("same-as");
}

export function blockedViewError(viewKey: string): string {
  const key = normalizeViewKey(viewKey);
  const hint = AGENT_FILTERED_LIST_HINTS[key] ?? "a filtered inventory view";
  return `View "${key}" is not available to the agent (unbounded dump). Use ${hint}. Call list_views for the allowed catalog.`;
}

function viewKeyFromEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Record<string, unknown>;
  for (const field of ["viewKey", "view_key", "key", "name", "id"] as const) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return normalizeViewKey(value);
    }
  }
  return null;
}

/**
 * Drop blocked views from a list_views tool result (JSON text or structured).
 */
export function filterListViewsResult(result: unknown): unknown {
  if (typeof result === "string") {
    const filtered = filterListViewsText(result);
    return filtered;
  }
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    return {
      ...record,
      content: record.content.map((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string"
        ) {
          return {
            ...part,
            text: filterListViewsText((part as { text: string }).text),
          };
        }
        return part;
      }),
    };
  }

  for (const field of ["views", "items", "data", "rows"] as const) {
    const value = record[field];
    if (Array.isArray(value)) {
      return {
        ...record,
        [field]: value.filter((entry) => {
          const key = viewKeyFromEntry(entry);
          return !key || !isAgentBlockedView(key);
        }),
      };
    }
  }

  return result;
}

function filterListViewsText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const filtered = filterListViewsResult(parsed);
    if (filtered !== parsed) {
      return JSON.stringify(filtered, null, 2);
    }
    if (Array.isArray(parsed)) {
      const next = parsed.filter((entry) => {
        const key = viewKeyFromEntry(entry);
        return !key || !isAgentBlockedView(key);
      });
      return JSON.stringify(next, null, 2);
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const field of ["views", "items", "data", "rows"] as const) {
        if (Array.isArray(record[field])) {
          return JSON.stringify(filterListViewsResult(parsed), null, 2);
        }
      }
    }
  } catch {
    // Fall through to line filter for markdown / YAML-ish dumps.
  }

  const blocked = [...AGENT_BLOCKED_VIEW_KEYS];
  return text
    .split("\n")
    .filter((line) => !blocked.some((key) => line.includes(key)))
    .join("\n");
}
