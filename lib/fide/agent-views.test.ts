import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockedViewError,
  filterListViewsResult,
  isAgentBlockedView,
  isNonBindableInventoryView,
} from "./agent-views.ts";

describe("agent-views", () => {
  it("blocks unbounded inventory dumps", () => {
    assert.equal(isAgentBlockedView("inventory/hotels-all"), true);
    assert.equal(isAgentBlockedView("inventory/restaurants-all"), true);
    assert.equal(isAgentBlockedView("inventory/places"), true);
    assert.equal(isAgentBlockedView("inventory/hotels-by-city"), false);
    assert.equal(isAgentBlockedView("inventory/restaurants-by-city"), false);
    assert.equal(isAgentBlockedView("inventory/places-search"), false);
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

    assert.deepEqual(
      filtered.views.map((v) => v.viewKey ?? v.key),
      ["inventory/hotels-by-city", "inventory/places-search"]
    );
  });

  it("marks itinerary views non-bindable", () => {
    assert.equal(isNonBindableInventoryView("inventory/itineraries-all"), true);
    assert.equal(isNonBindableInventoryView("inventory/hotels-by-city"), false);
  });

  it("explains blocked run_view", () => {
    assert.ok(
      blockedViewError("inventory/activities-all").includes("activities-by-city")
    );
  });
});
