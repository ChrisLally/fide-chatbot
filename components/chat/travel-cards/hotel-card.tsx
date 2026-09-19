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

export function HotelCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
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
  const address = readString(raw, ["address"]);
  const telephone = readString(raw, ["telephone", "phone"]);
  const affiliate = readString(raw, ["affiliate_links"]);
  const reviews = readString(raw, ["guest_reviews"])
    .split("\n")
    .map((review) => review.trim())
    .filter(Boolean);

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
    { label: "Address", value: address },
    { label: "Phone", value: telephone },
    { label: "Room Tip", value: roomTip },
    { label: "Booking Tip", value: bookingTip },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="gold"
      eyebrow="Hotel Recommendation"
      onOpen={
        showOpenAction
          ? () => openTravelContext("hotel", item.id)
          : undefined
      }
      subtitle={item.subtitle}
      title={item.name}
      entityId={item.id}
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

      {affiliate ? (
        <a
          className="inline-flex text-xs font-medium text-foreground underline-offset-2 hover:underline"
          href={affiliate.split(/\s|,/)[0]}
          rel="noreferrer"
          target="_blank"
        >
          Open booking / affiliate link
        </a>
      ) : null}

      {reviews.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Guest reviews
          </div>
          {reviews.slice(0, 4).map((review) => (
            <p
              className="border-border/60 border-l-2 pl-3 text-sm leading-6 text-muted-foreground"
              key={review.slice(0, 48)}
            >
              {review}
            </p>
          ))}
        </div>
      ) : null}

      <TagRow tags={item.tags} />
    </CardShell>
  );
}
