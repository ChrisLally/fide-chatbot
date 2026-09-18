"use client";

import {
  extractRows,
  normalizeTravelRows,
  type TravelContextItem,
} from "@/lib/fide/travel-context";
import { getViewTitle, isDetailView } from "@/lib/fide/view-query-map";
import { ActivityCard } from "./activity-card";
import { AttractionCard } from "./attraction-card";
import { ContextListCard } from "./context-list-card";
import { DestinationCard } from "./destination-card";
import { HotelCard } from "./hotel-card";
import { CollectionCard } from "./collection-card";
import { ItineraryCard } from "./itinerary-card";
import { TransportCard } from "./transport-card";

type RunViewInput = {
  worldModelKey?: string;
  viewKey?: string;
  params?: Record<string, string | number | null>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseRunViewInput(input: unknown): RunViewInput | null {
  if (!isRecord(input)) {
    return null;
  }

  const viewKey = typeof input.viewKey === "string" ? input.viewKey : null;
  if (!viewKey) {
    return null;
  }

  const worldModelKey =
    typeof input.worldModelKey === "string" ? input.worldModelKey : undefined;

  const params =
    input.params && isRecord(input.params)
      ? (input.params as Record<string, string | number | null>)
      : undefined;

  return { worldModelKey, viewKey, params };
}

/**
 * MCP CallToolResult from AI SDK: { content, structuredContent }.
 * Prefer structuredContent; fall back to parsing text JSON if present.
 */
function extractStructuredFromToolOutput(output: unknown): unknown {
  if (!isRecord(output)) {
    return output;
  }

  if ("structuredContent" in output && output.structuredContent != null) {
    return output.structuredContent;
  }

  return output;
}

function rowsFromStructuredView(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return extractRows(value);
  }

  if (value.kind === "simple") {
    return extractRows(value.result);
  }

  if (value.kind === "compose" && isRecord(value.results)) {
    const rows: Record<string, unknown>[] = [];
    for (const [label, result] of Object.entries(value.results)) {
      if (label === "resolver") {
        continue;
      }
      rows.push(...extractRows(result));
    }
    return rows;
  }

  return extractRows(value);
}

/** Exported so message.tsx can decide whether a list result should become a card. */
export function rowsFromRunViewOutput(output: unknown): Record<string, unknown>[] {
  return rowsFromStructuredView(extractStructuredFromToolOutput(output));
}

function SingleTravelCard({ item }: { item: TravelContextItem }) {
  if (item.kind === "hotel") {
    return <HotelCard item={item} />;
  }
  if (item.kind === "activity") {
    return <ActivityCard item={item} />;
  }
  if (item.kind === "attraction") {
    return <AttractionCard item={item} />;
  }
  if (item.kind === "itinerary") {
    return <ItineraryCard item={item} />;
  }
  if (item.kind === "collection") {
    return <CollectionCard item={item} />;
  }
  if (item.kind === "destination") {
    return <DestinationCard item={item} />;
  }
  return <TransportCard item={item} />;
}

export function RunViewCard({
  input,
  output,
}: {
  input: unknown;
  output: unknown;
}) {
  const parsed = parseRunViewInput(input);

  if (!parsed?.viewKey) {
    return null;
  }

  const structured = extractStructuredFromToolOutput(output);
  const rows = rowsFromStructuredView(structured);
  const items = normalizeTravelRows(parsed.viewKey, rows);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        No {getViewTitle(parsed.viewKey).toLowerCase()} found.
      </div>
    );
  }

  if (isDetailView(parsed.viewKey) || items.length === 1) {
    return <SingleTravelCard item={items[0]} />;
  }

  return <ContextListCard items={items} viewKey={parsed.viewKey} />;
}
