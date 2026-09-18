"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  readPlaceOpenId,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

export function ActivityCard({ item }: { item: TravelContextItem }) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const duration = readString(raw, ["duration"]);
  const format = readString(raw, ["format"]);
  const region = readString(raw, ["region_name", "region"]);
  const regionOpenId = readPlaceOpenId(raw, "region");

  const fields = [
    { label: "Duration", value: duration },
    { label: "Format", value: format },
    {
      label: "Region",
      value: region,
      onOpen: regionOpenId
        ? () => openTravelContext("destination", regionOpenId)
        : undefined,
    },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Curated Activity"
      onOpen={() => openTravelContext("activity", item.id)}
      subtitle={item.subtitle}
      title={item.name}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {duration && <StatusBadge label={duration} tone="info" />}
        {format && <StatusBadge label={format} tone="neutral" />}
        {region && <StatusBadge label={region} tone="neutral" />}
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
