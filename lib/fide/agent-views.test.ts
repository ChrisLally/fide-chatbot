import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockedViewError,
  filterListViewsResult,
  isAgentAllowedView,
  isAgentBlockedView,
  isNonBindableInventoryView,
} from "./agent-views.ts";

describe("agent-views", () => {
  it("allowlists only agent-intended inventory views", () => {
    assert.equal(isAgentAllowedView("inventory/places-search"), true);
    assert.equal(isAgentAllowedView("inventory/hotels-by-city"), true);
    assert.equal(isAgentAllowedView("inventory/transport-corridor"), true);
    assert.equal(isAgentAllowedView("inventory/hotels-all"), false);
    assert.equal(isAgentAllowedView("inventory/places"), false);
    assert.equal(isAgentAllowedView("inventory/itineraries-all"), false);
    assert.equal(isAgentBlockedView("inventory/hotels-all"), true);
    assert.equal(isAgentBlockedView("inventory/places-search"), false);
  });

  it("filters list_views to allowlist only", () => {
    const filtered = filterListViewsResult({
      views: [
        { viewKey: "inventory/hotels-all" },
        { viewKey: "inventory/hotels-by-city" },
        { key: "inventory/places" },
        { key: "inventory/places-search" },
        { key: "inventory/itinerary" },
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

  it("explains refused run_view", () => {
    assert.ok(blockedViewError("inventory/activities-all").includes("list_views"));
    assert.ok(blockedViewError("inventory/itineraries-all").includes("agent catalog"));
  });
});
