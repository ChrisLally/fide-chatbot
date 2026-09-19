import { describe, expect, it } from "vitest";
import {
  blockedViewError,
  filterListViewsResult,
  isAgentBlockedView,
  isNonBindableInventoryView,
} from "./agent-views.ts";

describe("agent-views", () => {
  it("blocks unbounded inventory dumps", () => {
    expect(isAgentBlockedView("inventory/hotels-all")).toBe(true);
    expect(isAgentBlockedView("inventory/places")).toBe(true);
    expect(isAgentBlockedView("inventory/hotels-by-city")).toBe(false);
    expect(isAgentBlockedView("inventory/places-search")).toBe(false);
  });

  it("filters list_views JSON arrays", () => {
    const filtered = filterListViewsResult({
      views: [
        { viewKey: "inventory/hotels-all" },
        { viewKey: "inventory/hotels-by-city" },
        { key: "inventory/places" },
        { key: "inventory/places-search" },
      ],
    }) as { views: Array<{ viewKey?: string; key?: string }> };

    expect(filtered.views.map((v) => v.viewKey ?? v.key)).toEqual([
      "inventory/hotels-by-city",
      "inventory/places-search",
    ]);
  });

  it("marks itinerary views non-bindable", () => {
    expect(isNonBindableInventoryView("inventory/itineraries-all")).toBe(true);
    expect(isNonBindableInventoryView("inventory/hotels-by-city")).toBe(false);
  });

  it("explains blocked run_view", () => {
    expect(blockedViewError("inventory/activities-all")).toContain(
      "activities-by-city"
    );
  });
});
