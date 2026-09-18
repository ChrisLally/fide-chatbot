"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import type { TravelContextItem } from "@/lib/fide/travel-context";
import { getViewTitle } from "@/lib/fide/view-query-map";
import { cn } from "@/lib/utils";
import { StatusBadge, toneForPriceTier, toneForRating } from "./shared";

function listBadgeTone(item: TravelContextItem) {
  if (item.kind === "hotel") {
    const price = String(item.raw.price_tier ?? item.raw.price ?? "");
    if (price) return toneForPriceTier(price);
    const rating = String(item.raw.internal_rating ?? item.raw.public_rating ?? "");
    if (rating) return toneForRating(rating);
  }
  if (item.kind === "activity") {
    return "info" as const;
  }
  if (item.kind === "attraction") {
    return "info" as const;
  }
  if (item.kind === "itinerary") {
    return "info" as const;
  }
  if (item.kind === "collection") {
    return "info" as const;
  }
  return "neutral" as const;
}

function listBadgeLabel(item: TravelContextItem) {
  if (item.kind === "hotel") {
    if (item.raw.price_tier) return String(item.raw.price_tier);
    if (item.raw.internal_rating) return `${item.raw.internal_rating} ★`;
    return String(item.tags[0] ?? "Hotel");
  }
  if (item.kind === "activity") {
    return String(item.raw.duration ?? item.raw.format ?? item.tags[0] ?? "Activity");
  }
  if (item.kind === "attraction") {
    const rank = item.raw.guide_rank ?? item.raw.position;
    return rank ? `#${rank}` : String(item.tags[0] ?? "Attraction");
  }
  if (item.kind === "itinerary") {
    return String(item.raw.duration ?? item.tags[0] ?? "Itinerary");
  }
  if (item.kind === "collection") {
    return String(item.raw.collection_kind ?? item.tags[0] ?? "Collection");
  }
  if (item.kind === "destination") {
    return String(item.raw.region_name ?? item.tags[0] ?? "Destination");
  }
  return String(item.raw.option ?? item.raw.mode ?? item.tags[0] ?? "Transport");
}

export function ContextListCard({
  viewKey,
  items,
}: {
  viewKey: string;
  items: TravelContextItem[];
}) {
  const { openTravelContext } = useContextNav();

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 shadow-[var(--shadow-card)]">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {getViewTitle(viewKey)}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {items.length} suggestion{items.length === 1 ? "" : "s"} found
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {items.slice(0, 5).map((item) => (
          <button
            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
            key={item.id}
            onClick={() => openTravelContext(item.kind, item.id)}
            type="button"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium hover:text-sky-600 dark:hover:text-sky-400">
                {item.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.subtitle}
              </div>
            </div>
            <StatusBadge
              label={listBadgeLabel(item)}
              tone={listBadgeTone(item)}
            />
          </button>
        ))}
      </div>
      {items.length > 5 ? (
        <div className={cn("border-t border-border/60 px-4 py-2 text-xs text-muted-foreground")}>
          +{items.length - 5} more in travel knowledge base
        </div>
      ) : null}
    </div>
  );
}
