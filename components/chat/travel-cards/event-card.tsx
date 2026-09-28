"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  canonicalEntityFideId,
  readPlaceOpenId,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

export function EventCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const region = readString(raw, ["region_name", "region"]);
  const dates = readString(raw, ["dates", "duration"]);
  const url = readString(raw, ["url"]);
  const regionOpenId = readPlaceOpenId(raw, "region");

  const fields = [
    { label: "Dates", value: dates },
    {
      label: "City",
      value: region,
      onOpen: regionOpenId
        ? () => openTravelContext("destination", regionOpenId)
        : undefined,
    },
    { label: "Website", value: url },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Featured Event"
      onOpen={
        showOpenAction
          ? () => openTravelContext("event", item.id)
          : undefined
      }
      subtitle={item.subtitle}
      title={item.name}
      entityId={canonicalEntityFideId(item)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {dates && <StatusBadge label={dates} tone="info" />}
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
