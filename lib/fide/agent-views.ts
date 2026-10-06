/**
 * Agent-facing inventory views — allowlist only.
 * Context UI may still call other views via context/query; chat list_views / run_view
 * only expose keys in AGENT_VIEW_KEYS.
 */

/** Views the itinerary agent may list and run. */
export const AGENT_VIEW_KEYS = new Set([
  "inventory/places-search",
  "inventory/place",
  "inventory/hotels-by-city",
  "inventory/hotel",
  "inventory/restaurants-by-city",
  "inventory/restaurant",
  "inventory/activities-by-city",
  "inventory/activity",
  "inventory/attractions-by-city",
  "inventory/attraction",
  "inventory/transport-corridor",
  "inventory/transport-option",
  "inventory/events-featured",
  "inventory/event",
  "inventory/collections-all",
  "inventory/collection",
  "inventory/cluster-members",
]);

/** @deprecated Prefer isAgentAllowedView — kept for call sites that phrase "blocked". */
export const AGENT_BLOCKED_VIEW_KEYS = new Set([
  "inventory/hotels-all",
  "inventory/restaurants-all",
  "inventory/activities-all",
  "inventory/attractions-all",
  "inventory/transport-all",
  "inventory/itineraries-all",
  "inventory/itineraries-search",
  "inventory/advisor-links-all",
  "inventory/same-as-links",
  "inventory/places",
]);

export function normalizeViewKey(viewKey: string): string {
  return viewKey.trim().replace(/^\/+/, "");
}

export function isAgentAllowedView(viewKey: string): boolean {
  return AGENT_VIEW_KEYS.has(normalizeViewKey(viewKey));
}

/** True when the agent must not run this view (not on the allowlist). */
export function isAgentBlockedView(viewKey: string): boolean {
  const key = normalizeViewKey(viewKey);
  if (!key) return false;
  return !isAgentAllowedView(key);
}

/** Views whose rows must not seed the itinerary entity allowlist. */
export function isNonBindableInventoryView(viewKey: string): boolean {
  const key = normalizeViewKey(viewKey).toLowerCase();
  return key.includes("itinerar") || key.includes("same-as");
}

export function blockedViewError(viewKey: string): string {
  const key = normalizeViewKey(viewKey);
  return `View "${key}" is not available to the agent. Call list_views for the agent catalog (places-search, place, hotels-by-city, transport-corridor, …). Context UI views and inventory dumps are not on this surface.`;
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
 * Keep only allowlisted views from a list_views tool result.
 */
export function filterListViewsResult(result: unknown): unknown {
  if (typeof result === "string") {
    return filterListViewsText(result);
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
          return !!key && isAgentAllowedView(key);
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
    if (Array.isArray(parsed)) {
      const next = parsed.filter((entry) => {
        const key = viewKeyFromEntry(entry);
        return !!key && isAgentAllowedView(key);
      });
      return JSON.stringify(next, null, 2);
    }
    if (parsed && typeof parsed === "object") {
      return JSON.stringify(filterListViewsResult(parsed), null, 2);
    }
  } catch {
    // Fall through to line filter for markdown / YAML-ish dumps.
  }

  return text
    .split("\n")
    .filter((line) => {
      const match = line.match(/inventory\/[a-z0-9-]+/i);
      if (!match) return true;
      return isAgentAllowedView(match[0]!);
    })
    .join("\n");
}
