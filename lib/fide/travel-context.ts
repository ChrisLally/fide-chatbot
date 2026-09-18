import type { ContextCategory, TravelContextKind } from "./context-nav";

export type TravelContextItem = {
  kind: TravelContextKind;
  id: string;
  name: string;
  filter: string;
  subtitle: string;
  description: string;
  tags: string[];
  raw: Record<string, unknown>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function extractRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  const candidates = [
    value.rows,
    value.data,
    value.items,
    value.records,
    isRecord(value.result) ? value.result.rows : undefined,
    isRecord(value.result) ? value.result.data : undefined,
    value.result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
}

export function readString(
  row: Record<string, unknown>,
  keys: string[],
  fallback = ""
) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

export function readTags(row: Record<string, unknown>, keys: string[]) {
  const tags = new Set<string>();

  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          tags.add(item.trim());
        }
      }
    } else if (typeof value === "string" && value.trim()) {
      for (const item of value.split(",")) {
        if (item.trim()) {
          tags.add(item.trim());
        }
      }
    }
  }

  return Array.from(tags).slice(0, 6);
}

const PLACE_IRI_PREFIX = "https://www.catalinaquest.ai/#place=";

/** Build a place IRI from a region slug when only the slug is present. */
export function placeIriFromSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("#place=") || trimmed.startsWith("http")) {
    return trimmed;
  }
  return `${PLACE_IRI_PREFIX}${trimmed}`;
}

/**
 * Resolve a destination deep-link id for context navigation.
 * Prefer explicit IRIs; fall back to slug→IRI. Never use display names.
 */
export function readPlaceOpenId(
  row: Record<string, unknown>,
  role: "region" | "from" | "to" | "place" = "region"
): string {
  if (role === "from") {
    const iri = readString(row, [
      "from_region_iri",
      "from_place_iri",
      "from_location_iri",
    ]);
    if (iri) {
      return iri;
    }
    return placeIriFromSlug(readString(row, ["from_region"]));
  }

  if (role === "to") {
    const iri = readString(row, [
      "to_region_iri",
      "to_place_iri",
      "to_location_iri",
    ]);
    if (iri) {
      return iri;
    }
    return placeIriFromSlug(readString(row, ["to_region"]));
  }

  if (role === "place") {
    return readString(row, ["place_iri", "id", "key"]);
  }

  const iri = readString(row, [
    "region_iri",
    "place_iri",
    "located_in",
    "location_iri",
  ]);
  if (iri) {
    return iri;
  }
  return placeIriFromSlug(readString(row, ["region"]));
}

export function normalizeHotelRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const name = readString(
    row,
    ["hotel", "name", "hotel_name", "display_name", "title"],
    `Hotel ${index + 1}`
  );
  const id = readString(
    row,
    ["hotel_iri", "id", "hotel_id", "fide_id", "slug", "key"],
    `hotel-${index}`
  );
  const filter = readString(
    row,
    [
      "region_name",
      "region",
      "area",
      "neighborhood",
      "location",
      "price_tier",
      "category",
    ],
    "Hotels"
  );
  const priceTier = readString(row, ["price_tier", "price", "budget"]);
  const area = readString(row, [
    "region_name",
    "region",
    "area",
    "neighborhood",
    "location",
  ]);
  const rating = readString(row, [
    "internal_rating",
    "public_rating",
    "rating",
    "stars",
  ]);
  const hasAffiliate = Boolean(readString(row, ["affiliate_links"]));
  const subtitle = [
    priceTier,
    area,
    rating && `${rating} rating`,
    hasAffiliate ? "Bookable" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const description = readString(
    row,
    ["advisor_note", "description", "summary", "overview", "notes"],
    "No description available yet."
  );
  const tags = readTags(row, [
    "good_for",
    "bad_for",
    "tags",
    "amenities",
    "features",
    "vibe",
    "region_name",
    "walkability",
    "area",
    "neighborhood",
    "location",
    "price_tier",
  ]);

  return {
    kind: "hotel",
    id,
    name,
    filter,
    subtitle: subtitle || "Hotel in Catalina inventory",
    description,
    tags: tags.length > 0 ? tags : [filter],
    raw: row,
  };
}

export function normalizeItineraryRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const name = readString(
    row,
    ["itinerary", "name", "title"],
    `Itinerary ${index + 1}`
  );
  const id = readString(
    row,
    ["itinerary_iri", "id", "key"],
    `itinerary-${index}`
  );
  const duration = readString(row, ["duration"]);
  const bestFor = readString(row, ["best_for"]);
  const route = readString(row, ["route_summary"]);
  const when = readString(row, ["when_to_go"]);

  return {
    kind: "itinerary",
    id,
    name,
    filter: duration || "Itineraries",
    subtitle:
      [duration, bestFor, when].filter(Boolean).join(" · ") ||
      route ||
      "Itinerary template",
    description: readString(
      row,
      ["advisor_note", "description", "route_summary"],
      "No description available yet."
    ),
    tags: [duration, bestFor].filter(Boolean).slice(0, 4),
    raw: row,
  };
}

export function normalizeAttractionRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const name = readString(
    row,
    ["attraction", "name", "title"],
    `Attraction ${index + 1}`
  );
  const id = readString(
    row,
    ["attraction_iri", "id", "key"],
    `attraction-${index}`
  );
  const region = readString(row, ["region_name", "region"], "Attractions");
  const rank = readString(row, ["guide_rank", "position", "rank"]);
  const source = readString(row, ["source_guide"]);

  return {
    kind: "attraction",
    id,
    name,
    filter: region,
    subtitle:
      [rank && `#${rank}`, region, source && "Guide"]
        .filter(Boolean)
        .join(" · ") || "Top-10 guide highlight",
    description: readString(
      row,
      ["advisor_note", "description"],
      "No description available yet."
    ),
    tags: rank ? [`#${rank}`, region] : [region],
    raw: row,
  };
}

export function normalizeActivityRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const name = readString(
    row,
    ["activity", "name", "title"],
    `Activity ${index + 1}`
  );
  const id = readString(
    row,
    ["activity_iri", "id", "key"],
    `activity-${index}`
  );
  const region = readString(row, ["region_name", "region"], "Activities");
  const duration = readString(row, ["duration"]);
  const format = readString(row, ["format"]);
  const hasAffiliate = Boolean(readString(row, ["affiliate_links"]));
  const tags = readTags(row, [
    "good_for",
    "bad_for",
    "format",
    "region_name",
    "duration",
  ]);

  return {
    kind: "activity",
    id,
    name,
    filter: region,
    subtitle:
      [duration, format, region, hasAffiliate ? "Bookable" : ""]
        .filter(Boolean)
        .join(" · ") || "Tour / activity",
    description: readString(
      row,
      ["advisor_note", "description"],
      "No description available yet."
    ),
    tags: tags.length > 0 ? tags : [region],
    raw: row,
  };
}

export function normalizeDestinationRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const name = readString(
    row,
    ["place", "name", "title"],
    `Destination ${index + 1}`
  );
  const id = readString(
    row,
    ["place_iri", "id", "key"],
    `destination-${index}`
  );
  const priority = readString(row, ["city_priority", "priority"]);
  const stay = readString(row, ["stay_recommended_nights"]);
  const landscapes = readString(row, ["landscapes"]);
  const primaryLandscape = landscapes
    ? landscapes.split(",")[0]?.trim()
    : "";
  const iata = readString(row, ["iata_code"]);
  // Browse by landscape (or Airport when IATA-only) — never raw priority ints.
  const filter = primaryLandscape || (iata ? "Airport" : "Destination");

  return {
    kind: "destination",
    id,
    name,
    filter,
    subtitle:
      [
        stay && `${stay} nights recommended`,
        iata && `IATA ${iata}`,
        landscapes,
        priority && `Priority ${priority}`,
      ]
        .filter(Boolean)
        .join(" · ") || "AU / NZ destination",
    description: readString(
      row,
      ["advisor_note", "description"],
      "No description available yet."
    ),
    tags: tagsFromRecord(row, ["landscapes", "iata_code", "vibe", "highlights"]),
    raw: row,
  };
}

function tagsFromRecord(row: Record<string, unknown>, keys: string[]) {
  const tags = readTags(row, keys);
  return tags.length > 0 ? tags : ["Destination"];
}

export function normalizeTransportationRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const route = readString(row, ["route"], `Route ${index + 1}`);
  const mode = readString(row, ["mode"]);
  const option = readString(row, ["option"]);
  const id = readString(
    row,
    ["option_iri", "route_iri", "id", "key"],
    `transport-${index}`
  );
  const from = readString(row, ["from_region_name", "from_region"]);
  const to = readString(row, ["to_region_name", "to_region"]);
  const duration = readString(row, ["duration"]);
  const distanceKm = readString(row, ["distance_km"]);
  const modeTags = readTags(row, ["mode"]);
  const corridor = from && to ? `${from} → ${to}` : "";
  const displayName =
    corridor ||
    (option && option !== route ? `${route}: ${option}` : route);

  return {
    kind: "transportation",
    id,
    name: displayName,
    // Browse by origin city; UI uses From/To selectors instead of mode chips.
    filter: from || "Transportation",
    subtitle:
      [
        mode,
        duration && `${duration} h`,
        distanceKm && `${distanceKm} km`,
      ]
        .filter(Boolean)
        .join(" · ") || "Routing leg",
    description: readString(
      row,
      ["advisor_note", "description"],
      corridor
        ? `Travel corridor between ${from} and ${to}.`
        : "No description available yet."
    ),
    tags: modeTags.length > 0 ? modeTags : ["Transportation"],
    raw: row,
  };
}


export function normalizeCollectionRow(
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  const name = readString(
    row,
    ["collection", "name", "title"],
    `Collection ${index + 1}`
  );
  const id = readString(
    row,
    ["collection_iri", "id", "key"],
    `collection-${index}`
  );
  const kind = readString(row, ["collection_kind", "kind"], "Collections");
  const memberCount = readString(row, ["member_count"]);
  const members = readString(row, ["member_names"]);

  return {
    kind: "collection",
    id,
    name,
    filter: kind,
    subtitle:
      [kind, memberCount && `${memberCount} members`].filter(Boolean).join(" · ") ||
      "Signature Experience collection",
    description: readString(
      row,
      ["advisor_note", "description", "member_names"],
      members || "No description available yet."
    ),
    tags: [kind, memberCount && `${memberCount} members`].filter(Boolean).slice(0, 4),
    raw: row,
  };
}

export function normalizeContextRow(
  category: ContextCategory,
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  if (category === "Hotels") {
    return normalizeHotelRow(row, index);
  }
  if (category === "Activities") {
    return normalizeActivityRow(row, index);
  }
  if (category === "Attractions") {
    return normalizeAttractionRow(row, index);
  }
  if (category === "Itineraries") {
    return normalizeItineraryRow(row, index);
  }
  if (category === "Collections") {
    return normalizeCollectionRow(row, index);
  }
  if (category === "Destinations") {
    return normalizeDestinationRow(row, index);
  }
  return normalizeTransportationRow(row, index);
}

export function normalizeTravelRow(
  viewKey: string,
  row: Record<string, unknown>,
  index: number
): TravelContextItem {
  if (viewKey.startsWith("inventory/hotel")) {
    return normalizeHotelRow(row, index);
  }
  if (viewKey.startsWith("inventory/activit")) {
    return normalizeActivityRow(row, index);
  }
  if (viewKey.startsWith("inventory/attraction")) {
    return normalizeAttractionRow(row, index);
  }
  if (viewKey.startsWith("inventory/itinerar")) {
    return normalizeItineraryRow(row, index);
  }
  if (viewKey.startsWith("inventory/collection")) {
    return normalizeCollectionRow(row, index);
  }
  if (viewKey.startsWith("inventory/place")) {
    return normalizeDestinationRow(row, index);
  }
  return normalizeTransportationRow(row, index);
}

export function normalizeTravelRows(
  viewKey: string,
  rows: Record<string, unknown>[]
): TravelContextItem[] {
  return rows.map((row, index) => normalizeTravelRow(viewKey, row, index));
}
