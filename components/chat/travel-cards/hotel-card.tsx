"use client";

import { useState } from "react";
import { parseRooms, splitList } from "@/lib/fide/hotel-detail";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

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

function ListBlock({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground/90">
        {items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

export function HotelCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
  const { openTravelContext } = useContextNav();
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const raw = item.raw;

  const priceTier = readString(raw, ["price_tier", "price"]);
  const region = readString(raw, ["region_name", "area"]);
  const regionOpenId = readPlaceOpenId(raw, "region");
  const internalRating = readString(raw, ["internal_rating"]);
  const publicRating = readString(raw, ["public_rating", "rating"]);
  const walkability = readString(raw, ["walkability"]);
  const roomTip = readString(raw, ["room_tip"]);
  const bookingTip = readString(raw, ["booking_tip"]);
  const address = readString(raw, ["address"]);
  const telephone = readString(raw, ["telephone", "phone"]);
  const affiliate = readString(raw, ["affiliate_links"]);
  const overview = readString(raw, ["overview"]);
  const experience = readString(raw, ["experience"]);
  const highlights = splitList(readString(raw, ["highlights"]), "\n");
  const amenities = splitList(readString(raw, ["amenities"]), "\n");
  const numberOfRooms = readString(raw, ["number_of_rooms"]);
  const images = splitList(readString(raw, ["images"]), " | ");
  const website = readString(raw, ["url"]);
  const brand = readString(raw, ["hotel_brand"]);
  const area = readString(raw, ["area_label"]);
  const starRating = readString(raw, ["star_rating"]);
  const safariTags = splitList(readString(raw, ["safari_tags"]), " | ");
  const rooms = parseRooms(readString(raw, ["rooms"]));
  const reviews = readString(raw, ["guest_reviews"])
    .split("\n")
    .map((review) => review.trim())
    .filter(Boolean);

  const fields = [
    { label: "Price Tier", value: priceTier },
    {
      label: "Region / Area",
      value: area || region,
      onOpen: regionOpenId
        ? () => openTravelContext("destination", regionOpenId)
        : undefined,
    },
    { label: "Internal Rating", value: internalRating ? `${internalRating} ★` : "" },
    { label: "Public Rating", value: publicRating ? `${publicRating} ★` : "" },
    { label: "Star Rating", value: starRating },
    { label: "Rooms", value: numberOfRooms },
    { label: "Brand / Group", value: brand },
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

      {overview || item.description ? (
        <p className="text-sm leading-relaxed text-foreground/90">
          {overview || item.description}
        </p>
      ) : null}

      {experience ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Experience &amp; activities
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            {experience}
          </p>
        </div>
      ) : null}

      {highlights.length > 0 ? (
        <ListBlock items={highlights} title="Highlights" />
      ) : null}

      {amenities.length > 0 ? (
        <ListBlock items={amenities} title="Amenities" />
      ) : null}

      {safariTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {safariTags.map((tag) => (
            <span
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {fields.length > 0 && <FieldGrid fields={fields} />}

      {affiliate || website ? (
        <div className="flex flex-wrap gap-3">
          {website ? (
            <a
              className="inline-flex text-xs font-medium text-foreground underline-offset-2 hover:underline"
              href={website}
              rel="noreferrer"
              target="_blank"
            >
              Hotel website
            </a>
          ) : null}
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
        </div>
      ) : null}

      {rooms.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Rooms ({rooms.length})
          </div>
          <ul className="space-y-2">
            {rooms.map((room) => (
              <li className="space-y-0.5" key={room.name}>
                <div className="text-sm font-medium text-foreground">{room.name}</div>
                {room.description ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {room.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {images.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Photos ({images.length})
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {images.slice(0, 9).map((src, index) => (
              <button
                className="overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={src}
                onClick={() => setPhotoIndex(index)}
                type="button"
              >
                {/* biome-ignore lint/performance/noImgElement: external CDN thumbnails */}
                <img
                  alt={item.name}
                  className="aspect-[4/3] w-full object-cover transition-opacity hover:opacity-90"
                  loading="lazy"
                  src={src}
                />
              </button>
            ))}
          </div>
          <Dialog
            onOpenChange={(open) => {
              if (!open) setPhotoIndex(null);
            }}
            open={photoIndex !== null}
          >
            <DialogContent className="gap-3 p-4 sm:max-w-4xl">
              <DialogTitle className="text-sm font-medium">
                {item.name}
                {photoIndex !== null ? ` · ${photoIndex + 1} of ${images.length}` : ""}
              </DialogTitle>
              {photoIndex !== null ? (
                <>
                  {/* biome-ignore lint/performance/noImgElement: external CDN photo */}
                  <img
                    alt={item.name}
                    className="max-h-[70vh] w-full rounded-md object-contain"
                    src={images[photoIndex]}
                  />
                  <div className="flex items-center justify-between">
                    <button
                      className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-40"
                      disabled={photoIndex === 0}
                      onClick={() => setPhotoIndex((i) => (i === null ? null : Math.max(0, i - 1)))}
                      type="button"
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-md border border-border px-3 py-1 text-xs disabled:opacity-40"
                      disabled={photoIndex === images.length - 1}
                      onClick={() =>
                        setPhotoIndex((i) => (i === null ? null : Math.min(images.length - 1, i + 1)))
                      }
                      type="button"
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : null}
            </DialogContent>
          </Dialog>
        </div>
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
