"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  readPlaceOpenId,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

export function TransportCard({ item }: { item: TravelContextItem }) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const route = readString(raw, ["route"]);
  const mode = readString(raw, ["option", "mode", "transport_mode"]);
  const from = readString(raw, ["from_region_name", "from_region"]);
  const to = readString(raw, ["to_region_name", "to_region"]);
  const fromOpenId = readPlaceOpenId(raw, "from");
  const toOpenId = readPlaceOpenId(raw, "to");
  const duration = readString(raw, ["duration"]);

  const fields = [
    { label: "Route", value: route },
    { label: "Mode", value: mode },
    {
      label: "Departure",
      value: from,
      onOpen: fromOpenId
        ? () => openTravelContext("destination", fromOpenId)
        : undefined,
    },
    {
      label: "Arrival",
      value: to,
      onOpen: toOpenId
        ? () => openTravelContext("destination", toOpenId)
        : undefined,
    },
    { label: "Duration", value: duration },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="slate"
      eyebrow="Transport Option"
      onOpen={() => openTravelContext("transportation", item.id)}
      subtitle={item.subtitle}
      title={item.name}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {mode && <StatusBadge label={mode} tone="info" />}
        {duration && <StatusBadge label={duration} tone="neutral" />}
      </div>

      {item.description && (
        <p className="text-sm leading-relaxed text-foreground/90">
          {item.description}
        </p>
      )}

      {fields.length > 0 && <FieldGrid fields={fields} />}

      <TagRow tags={item.tags} />
    </CardShell>
  );
}
