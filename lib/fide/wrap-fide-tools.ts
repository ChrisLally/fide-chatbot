import type { ToolSet } from "ai";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
import {
  blockedViewError,
  filterListViewsResult,
  isAgentBlockedView,
  isNonBindableInventoryView,
  normalizeViewKey,
} from "@/lib/fide/agent-views";
import { enrichPayloadWithEntityComments } from "@/lib/fide/entity-comments-enrich";
import { dedupePlaceDescriptionAdvisorNote } from "@/lib/fide/place-payload-dedupe";

function extractToolText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: string }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("\n");
  }
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

function viewKeyFromInput(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }
  const record = input as Record<string, unknown>;
  for (const field of ["viewKey", "view_key", "key"] as const) {
    if (typeof record[field] === "string") {
      return normalizeViewKey(record[field]);
    }
  }
  return "";
}

function textToolResult(message: string): unknown {
  return {
    content: [{ type: "text", text: message }],
  };
}

function applyPlaceDedupe(result: unknown): unknown {
  if (typeof result === "string") {
    return dedupePlaceDescriptionAdvisorNote(result);
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
            text: dedupePlaceDescriptionAdvisorNote(
              (part as { text: string }).text
            ) as string,
          };
        }
        return part;
      }),
    };
  }
  return dedupePlaceDescriptionAdvisorNote(result);
}

/**
 * Wrap Fide MCP tools for the itinerary agent:
 * - allowlist-only list_views / run_view (UI dumps stay on Context)
 * - exact description/advisor_note dedupe on place payloads
 * - harvest run_view rows into the turn entity allowlist
 * - append local EntityComment notes for any fide ids in the result
 */
export function wrapFideToolsWithBinder(
  tools: ToolSet,
  binder: TurnEntityBinder
): ToolSet {
  const next: ToolSet = { ...tools };

  const listViews = tools.list_views as ExecutableTool | undefined;
  if (listViews?.execute) {
    const originalList = listViews.execute.bind(listViews);
    next.list_views = {
      ...listViews,
      execute: async (input: unknown, options: unknown) => {
        const result = await originalList(input, options);
        return filterListViewsResult(result);
      },
    } as ToolSet[string];
  }

  const runView = tools.run_view as ExecutableTool | undefined;
  if (runView?.execute) {
    const originalRun = runView.execute.bind(runView);
    next.run_view = {
      ...runView,
      execute: async (input: unknown, options: unknown) => {
        const viewKey = viewKeyFromInput(input);
        if (viewKey && isAgentBlockedView(viewKey)) {
          return textToolResult(blockedViewError(viewKey));
        }

        let result = await originalRun(input, options);

        if (
          viewKey === "inventory/places-search" ||
          viewKey === "inventory/place" ||
          viewKey === "inventory/hotel" ||
          viewKey === "inventory/hotels-by-city"
        ) {
          result = applyPlaceDedupe(result);
        }

        if (viewKey && !isNonBindableInventoryView(viewKey)) {
          binder.harvestRunView(viewKey, extractToolText(result));
        }
        return enrichPayloadWithEntityComments(result);
      },
    } as ToolSet[string];
  }

  return next;
}
