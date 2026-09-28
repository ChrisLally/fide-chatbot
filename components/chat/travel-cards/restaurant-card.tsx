"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  canonicalEntityFideId,
  readPlaceOpenId,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

export function RestaurantCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const category = readString(raw, ["product_category", "category"]);
  const region = readString(raw, ["region_name", "region"]);
  const address = readString(raw, ["address"]);
  const telephone = readString(raw, ["telephone", "phone"]);
  const url = readString(raw, ["url"]);
  const regionOpenId = readPlaceOpenId(raw, "region");

  const fields = [
    { label: "Category", value: category },
    {
      label: "City",
      value: region,
      onOpen: regionOpenId
        ? () => openTravelContext("destination", regionOpenId)
        : undefined,
    },
    { label: "Address", value: address },
    { label: "Phone", value: telephone },
    { label: "Website", value: url },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Restaurant"
      onOpen={
        showOpenAction
          ? () => openTravelContext("restaurant", item.id)
          : undefined
      }
      subtitle={item.subtitle}
      title={item.name}
      entityId={canonicalEntityFideId(item)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {category && <StatusBadge label={category} tone="info" />}
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
