"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  canonicalEntityFideId,
  readPlaceOpenId,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

export function AttractionCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const rank = readString(raw, ["guide_rank", "position", "rank"]);
  const region = readString(raw, ["region_name", "region"]);
  const source = readString(raw, ["source_guide"]);
  const regionOpenId = readPlaceOpenId(raw, "region");

  const fields = [
    { label: "Guide rank", value: rank ? `#${rank}` : "" },
    {
      label: "Place",
      value: region,
      onOpen: regionOpenId
        ? () => openTravelContext("destination", regionOpenId)
        : undefined,
    },
    { label: "Source guide", value: source },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Top-10 Guide"
      onOpen={
        showOpenAction
          ? () => openTravelContext("attraction", item.id)
          : undefined
      }
      subtitle={item.subtitle}
      title={item.name}
      entityId={canonicalEntityFideId(item)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {rank && <StatusBadge label={`#${rank}`} tone="info" />}
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
