"use client";

import { ArrowLeftIcon, XIcon } from "lucide-react";
import useSWR from "swr";
import { FideIdChip } from "@/components/chat/fide-id-chip";
import { EntityDetail } from "@/components/chat/travel-cards/entity-detail";
import { StatusBadge } from "@/components/chat/travel-cards/shared";
import type { ContextCategory } from "@/lib/fide/context-nav";
import {
  extractRows,
  normalizeContextRow,
  type TravelContextItem,
} from "@/lib/fide/travel-context";
import {
  fideIdHex,
  type ItineraryPeekKind,
  subjectFingerprintFromFideId,
} from "@/lib/itinerary/schema";

const peekDetailQueries: Record<
  ItineraryPeekKind,
  { category: ContextCategory; query: string; paramName: string }
> = {
  hotel: {
    category: "Hotels",
    query: "hotelDetail",
    paramName: "fideId",
  },
  activity: {
    category: "Activities",
    query: "activityDetail",
    paramName: "fideId",
  },
  attraction: {
    category: "Attractions",
    query: "attractionDetail",
    paramName: "fideId",
  },
  destination: {
    category: "Destinations",
    query: "destinationDetail",
    paramName: "fideId",
  },
  transportation: {
    category: "Transportation",
    query: "transportationDetail",
    paramName: "option_iri",
  },
};

export type PeekTarget = {
  kind: ItineraryPeekKind;
  id: string;
  label?: string;
};

function coerceRouteOptionIri(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("did:fide:")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("#")) {
    return `https://www.catalinaquest.ai/${trimmed}`;
  }
  if (trimmed.includes("route=")) {
    return `https://www.catalinaquest.ai/#${trimmed.replace(/^#/, "")}`;
  }
  return `https://www.catalinaquest.ai/#route=${trimmed}`;
}

async function fetchPeekDetailOnce(
  kind: ItineraryPeekKind,
  id: string
): Promise<TravelContextItem | null> {
  const config = peekDetailQueries[kind];

  let params: Record<string, string>;
  if (kind === "transportation") {
    params = { option_iri: coerceRouteOptionIri(id) };
  } else {
    const hex = fideIdHex(id);
    if (!hex) {
      throw new Error(`Not a full Fide id: ${id}`);
    }
    params = {
      fideId: id.startsWith("did:fide:") ? id : `did:fide:${hex}`,
      subjectFingerprint: subjectFingerprintFromFideId(id) ?? "",
    };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
    {
      body: JSON.stringify({
        params,
        query: config.query,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as { result?: unknown };
  const row = extractRows(json.result)[0];
  if (!row) {
    return null;
  }
  return normalizeContextRow(config.category, row, 0);
}

/** One lookup, using the kind the itinerary already holds for this full Fide id. */
async function fetchPeekDetail(
  kind: ItineraryPeekKind,
  id: string
): Promise<{
  item: TravelContextItem | null;
  resolvedKind: ItineraryPeekKind;
}> {
  const item = await fetchPeekDetailOnce(kind, id);
  return { item, resolvedKind: kind };
}

export function ItineraryEntityPeek({
  peek,
  onClose,
}: {
  peek: PeekTarget;
  onClose: () => void;
}) {
  const { data, error, isLoading } = useSWR(
    ["itinerary-entity-peek", peek.kind, peek.id],
    () => fetchPeekDetail(peek.kind, peek.id)
  );

  const resolvedKind = data?.resolvedKind ?? peek.kind;
  const category = peekDetailQueries[resolvedKind].category;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border/50 bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3">
        <button
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to itinerary
        </button>
        <button
          aria-label="Close entity peek"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge label={category} />
          <StatusBadge label="Peek · overlays itinerary" tone="neutral" />
          <FideIdChip id={peek.id} />
        </div>
        {isLoading ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
            Loading {peek.label || "details"}…
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Could not load this {peek.kind} from the world model.
            {peek.label ? ` (${peek.label})` : ""}
          </div>
        ) : null}
        {!isLoading && !error && !data?.item ? (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm">
            <p className="font-medium text-foreground">
              Not in the world model
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {peek.label || "This entity"}
              </span>{" "}
              has no inventory record for this peek lookup. If the chip shows a
              real Fide id from run_view, retry after refresh — otherwise pick
              another allowlisted place/hotel/activity.
            </p>
            {fideIdHex(peek.id) ? (
              <p className="break-all">
                <FideIdChip id={peek.id} />
              </p>
            ) : (
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {peek.id}
                <span className="mt-1 block text-[10px] opacity-70">
                  (not a Fide id — expected 0x…)
                </span>
              </p>
            )}
          </div>
        ) : null}
        {data?.item ? <EntityDetail item={data.item} /> : null}
      </div>
    </aside>
  );
}
