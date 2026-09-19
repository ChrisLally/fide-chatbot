import type { ClientItinerary, ItineraryTransfer } from "./schema";

export type TransferSlotKind = "arrival" | "between" | "departure";

export type TransferSlot = {
  key: string;
  kind: TransferSlotKind;
  fromStopIndex: number;
  toStopIndex: number;
  fromLabel: string;
  toLabel: string;
  fromPlaceId?: string;
  toPlaceId?: string;
  /** Graph `#route=…` IRI when known or guessed from place slugs. */
  routeId?: string;
  transfer?: ItineraryTransfer;
};

function findTransfer(
  transfers: ItineraryTransfer[],
  fromStopIndex: number,
  toStopIndex: number
): ItineraryTransfer | undefined {
  return transfers.find(
    (t) => t.fromStopIndex === fromStopIndex && t.toStopIndex === toStopIndex
  );
}

function placeSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Best-effort Catalina route IRI from two place labels (display/debug only). */
export function guessRouteIri(fromLabel: string, toLabel: string): string | undefined {
  const from = placeSlug(fromLabel);
  const to = placeSlug(toLabel);
  if (!from || !to) {
    return undefined;
  }
  // Skip non-place bookends and airport shuttles — those are rarely `#route=` entities
  if (
    from === "arrival" ||
    to === "arrival" ||
    from === "departure" ||
    to === "departure" ||
    from.includes("airport") ||
    to.includes("airport") ||
    from.includes("international") ||
    to.includes("international")
  ) {
    return undefined;
  }
  return `https://www.catalinaquest.ai/#route=${from}--${to}`;
}

function isBookendLabel(label: string): boolean {
  const slug = placeSlug(label);
  return slug === "arrival" || slug === "departure";
}

/** Arrival + between-stop + departure slots for the itinerary canvas. */
export function transferSlots(itinerary: ClientItinerary): TransferSlot[] {
  const stops = itinerary.stops;
  const transfers = itinerary.transfers ?? [];
  if (stops.length === 0) {
    return [];
  }

  const build = (
    kind: TransferSlotKind,
    fromStopIndex: number,
    toStopIndex: number,
    fromLabel: string,
    toLabel: string
  ): TransferSlot => {
    const transfer = findTransfer(transfers, fromStopIndex, toStopIndex);
    const resolvedFrom = transfer?.fromPlaceName?.trim() || fromLabel;
    const resolvedTo = transfer?.toPlaceName?.trim() || toLabel;

    // Endpoints: only real place ids. Never treat Arrival/Departure placeholders as places.
    const fromPlaceId =
      transfer?.fromPlaceId ||
      (fromStopIndex >= 0 && !isBookendLabel(resolvedFrom)
        ? stops[fromStopIndex]?.placeId
        : undefined);
    const toPlaceId =
      transfer?.toPlaceId ||
      (toStopIndex < stops.length && !isBookendLabel(resolvedTo)
        ? stops[toStopIndex]?.placeId
        : undefined);

    // Route combo peek only when the agent bound a real WM option/route id —
    // never invent clickable `#route=` guesses (airport→city etc. are not inventory).
    const routeId = transfer?.routeId?.trim() || undefined;

    return {
      key: `${kind}-${fromStopIndex}-${toStopIndex}`,
      kind,
      fromStopIndex,
      toStopIndex,
      fromLabel: resolvedFrom,
      toLabel: resolvedTo,
      fromPlaceId: fromPlaceId && !isBookendLabel(resolvedFrom) ? fromPlaceId : undefined,
      toPlaceId: toPlaceId && !isBookendLabel(resolvedTo) ? toPlaceId : undefined,
      routeId,
      transfer,
    };
  };

  const slots: TransferSlot[] = [
    build(
      "arrival",
      -1,
      0,
      findTransfer(transfers, -1, 0)?.fromPlaceName?.trim() || "Arrival",
      stops[0].placeName
    ),
  ];

  for (let index = 0; index < stops.length - 1; index++) {
    slots.push(
      build(
        "between",
        index,
        index + 1,
        stops[index].placeName,
        stops[index + 1].placeName
      )
    );
  }

  const last = stops.length - 1;
  slots.push(
    build(
      "departure",
      last,
      stops.length,
      stops[last].placeName,
      findTransfer(transfers, last, stops.length)?.toPlaceName?.trim() ||
        "Departure"
    )
  );

  return slots;
}

export function transferKindLabel(kind: TransferSlotKind): string {
  if (kind === "arrival") return "Arrival";
  if (kind === "departure") return "Departure";
  return "Transfer";
}

/**
 * Calendar day number when each overnight stop begins (Day 1, then +nights…).
 * Index `stops.length` is the departure morning after the last stay.
 */
export function stopStartDayNumbers(
  stops: Array<{ nights: number }>
): number[] {
  const starts: number[] = [];
  let day = 1;
  for (const stop of stops) {
    starts.push(day);
    day += Math.max(1, stop.nights);
  }
  starts.push(day); // departure morning
  return starts;
}
