"use client";

import type { TravelContextItem } from "@/lib/fide/travel-context";
import { ActivityCard } from "./activity-card";
import { AttractionCard } from "./attraction-card";
import { CollectionCard } from "./collection-card";
import { DestinationCard } from "./destination-card";
import { HotelCard } from "./hotel-card";
import { ItineraryCard } from "./itinerary-card";
import { TransportCard } from "./transport-card";

export type EntityDetailProps = {
  item: TravelContextItem;
  /**
   * Show the chevron that opens/focuses this entity in the Context tab.
   * Off for peeks and the Context detail pane (already viewing it).
   */
  showOpenAction?: boolean;
};

/** Single shared entity renderer for chat cards, Context tab, and itinerary peek. */
export function EntityDetail({
  item,
  showOpenAction = false,
}: EntityDetailProps) {
  if (item.kind === "hotel") {
    return <HotelCard item={item} showOpenAction={showOpenAction} />;
  }
  if (item.kind === "activity") {
    return <ActivityCard item={item} showOpenAction={showOpenAction} />;
  }
  if (item.kind === "attraction") {
    return <AttractionCard item={item} showOpenAction={showOpenAction} />;
  }
  if (item.kind === "itinerary") {
    return <ItineraryCard item={item} showOpenAction={showOpenAction} />;
  }
  if (item.kind === "collection") {
    return <CollectionCard item={item} showOpenAction={showOpenAction} />;
  }
  if (item.kind === "destination") {
    return <DestinationCard item={item} showOpenAction={showOpenAction} />;
  }
  return <TransportCard item={item} showOpenAction={showOpenAction} />;
}
