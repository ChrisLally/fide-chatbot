"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  readPlaceOpenId,
  readString,
} from "@/lib/fide/travel-context";
import {
  CardShell,
  FieldGrid,
  StatusBadge,
  TagRow,
  toneForPriceTier,
  toneForRating,
} from "./shared";

export function HotelCard({ item }: { item: TravelContextItem }) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const priceTier = readString(raw, ["price_tier", "price"]);
  const region = readString(raw, ["region_name", "region", "area"]);
  const regionOpenId = readPlaceOpenId(raw, "region");
  const internalRating = readString(raw, ["internal_rating"]);
  const publicRating = readString(raw, ["public_rating", "rating"]);
  const walkability = readString(raw, ["walkability"]);
  const roomTip = readString(raw, ["room_tip"]);
  const bookingTip = readString(raw, ["booking_tip"]);

  const fields = [
    { label: "Price Tier", value: priceTier },
    {
      label: "Region / Area",
      value: region,
      onOpen: regionOpenId
        ? () => openTravelContext("destination", regionOpenId)
        : undefined,
    },
    { label: "Internal Rating", value: internalRating ? `${internalRating} ★` : "" },
    { label: "Public Rating", value: publicRating ? `${publicRating} ★` : "" },
    { label: "Walkability", value: walkability },
    { label: "Room Tip", value: roomTip },
    { label: "Booking Tip", value: bookingTip },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="gold"
      eyebrow="Hotel Recommendation"
      onOpen={() => openTravelContext("hotel", item.id)}
      subtitle={item.subtitle}
      title={item.name}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {priceTier && (
          <StatusBadge
            label={priceTier}
            tone={toneForPriceTier(priceTier)}
          />
        )}
        {internalRating && (
          <StatusBadge
            label={`${internalRating} Advisor Score`}
            tone={toneForRating(internalRating)}
          />
        )}
        {publicRating && (
          <StatusBadge
            label={`${publicRating} Public`}
            tone={toneForRating(publicRating)}
          />
        )}
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
