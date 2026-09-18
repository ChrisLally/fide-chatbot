export type ContextCategory =
  | "Hotels"
  | "Activities"
  | "Attractions"
  | "Itineraries"
  | "Collections"
  | "Destinations"
  | "Transportation";

export type TravelContextKind =
  | "hotel"
  | "activity"
  | "attraction"
  | "itinerary"
  | "collection"
  | "destination"
  | "transportation";

const slugToCategoryMap = {
  hotels: "Hotels",
  activities: "Activities",
  attractions: "Attractions",
  itineraries: "Itineraries",
  collections: "Collections",
  destinations: "Destinations",
  transportation: "Transportation",
} as const satisfies Record<string, ContextCategory>;

const categoryToSlugMap: Record<ContextCategory, keyof typeof slugToCategoryMap> =
  {
    Hotels: "hotels",
    Activities: "activities",
    Attractions: "attractions",
    Itineraries: "itineraries",
    Collections: "collections",
    Destinations: "destinations",
    Transportation: "transportation",
  };

const travelKindToCategoryMap: Record<TravelContextKind, ContextCategory> = {
  hotel: "Hotels",
  activity: "Activities",
  attraction: "Attractions",
  itinerary: "Itineraries",
  collection: "Collections",
  destination: "Destinations",
  transportation: "Transportation",
};

export function isContextCategory(value: string): value is ContextCategory {
  return value in categoryToSlugMap;
}

export function categoryToSlug(category: ContextCategory): string {
  return categoryToSlugMap[category];
}

export function slugToCategory(slug: string | null | undefined): ContextCategory | null {
  if (!slug) {
    return null;
  }
  return slugToCategoryMap[slug as keyof typeof slugToCategoryMap] ?? null;
}

export function travelKindToCategory(kind: TravelContextKind): ContextCategory {
  return travelKindToCategoryMap[kind];
}

export type ContextNavState = {
  category: ContextCategory | null;
  id: string | null;
};

export function parseContextSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null }
): ContextNavState {
  return {
    category: slugToCategory(params.get("context")),
    id: params.get("id"),
  };
}

export function applyContextSearchParams(
  current: URLSearchParams,
  next: { category?: ContextCategory | null; id?: string | null }
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if ("category" in next) {
    if (next.category) {
      params.set("context", categoryToSlug(next.category));
    } else {
      params.delete("context");
      params.delete("id");
    }
  }

  if ("id" in next) {
    if (next.id) {
      params.set("id", next.id);
    } else {
      params.delete("id");
    }
  }

  if (!params.get("context")) {
    params.delete("id");
  }

  return params;
}
