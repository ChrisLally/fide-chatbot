const contextQueries = {
  hotels: "inventory/hotels-all",
  hotelDetail: "inventory/hotel",
  activities: "inventory/activities-all",
  activityDetail: "inventory/activity",
  attractions: "inventory/attractions-all",
  attractionDetail: "inventory/attraction",
  itineraries: "inventory/itineraries-all",
  itineraryDetail: "inventory/itinerary",
  destinations: "inventory/places",
  destinationDetail: "inventory/place",
  transportation: "inventory/transport-all",
  transportationDetail: "inventory/transport-option",
  collections: "inventory/collections-all",
  collectionDetail: "inventory/collection",
  sameAsLinks: "inventory/same-as-links",
  clusterMembers: "inventory/cluster-members",
  advisorLinks: "inventory/advisor-links-all",
} as const;

export type ContextQueryKey = keyof typeof contextQueries;

const viewToQuery: Record<string, ContextQueryKey> = {
  "inventory/hotels-all": "hotels",
  "inventory/hotel": "hotelDetail",
  "inventory/activities-all": "activities",
  "inventory/activity": "activityDetail",
  "inventory/attractions-all": "attractions",
  "inventory/attraction": "attractionDetail",
  "inventory/itineraries-all": "itineraries",
  "inventory/itinerary": "itineraryDetail",
  "inventory/places": "destinations",
  "inventory/place": "destinationDetail",
  "inventory/transport-all": "transportation",
  "inventory/transport-option": "transportationDetail",
  "inventory/collections-all": "collections",
  "inventory/collection": "collectionDetail",
  "inventory/same-as-links": "sameAsLinks",
  "inventory/cluster-members": "clusterMembers",
  "inventory/advisor-links-all": "advisorLinks",
};

export function resolveContextQuery(viewKey: string): ContextQueryKey | null {
  return viewToQuery[viewKey] ?? null;
}

export function isDetailView(viewKey: string): boolean {
  return (
    viewKey === "inventory/hotel" ||
    viewKey === "inventory/activity" ||
    viewKey === "inventory/attraction" ||
    viewKey === "inventory/itinerary" ||
    viewKey === "inventory/place" ||
    viewKey === "inventory/transport-option" ||
    viewKey === "inventory/collection"
  );
}

export function getViewTitle(viewKey: string): string {
  const titles: Record<string, string> = {
    "inventory/hotels-all": "Hotels",
    "inventory/hotel": "Hotel",
    "inventory/activities-all": "Activities",
    "inventory/activity": "Activity",
    "inventory/attractions-all": "Attractions",
    "inventory/attraction": "Attraction",
    "inventory/itineraries-all": "Itineraries",
    "inventory/itinerary": "Itinerary",
    "inventory/places": "Destinations",
    "inventory/place": "Destination",
    "inventory/transport-all": "Transportation options",
    "inventory/transport-option": "Transportation option",
    "inventory/collections-all": "Collections",
    "inventory/collection": "Collection",
    "inventory/same-as-links": "Same-as links",
    "inventory/cluster-members": "Cluster members",
    "inventory/advisor-links-all": "Advisor links",
  };
  return titles[viewKey] ?? "Travel context";
}
