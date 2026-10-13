import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockedViewError,
  filterListViewsResult,
  isAgentAllowedView,
  isAgentBlockedView,
  isNonBindableInventoryView,
  validateAgentViewParams,
} from "./agent-views.ts";

const SYDNEY = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";

describe("agent-views", () => {
  it("allowlists only agent-intended inventory views", () => {
    assert.equal(isAgentAllowedView("inventory/places-search"), true);
    assert.equal(isAgentAllowedView("inventory/hotels-by-city"), true);
    assert.equal(isAgentAllowedView("inventory/hotel-rooms"), true);
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
    assert.ok(
      blockedViewError("inventory/activities-all").includes("list_views")
    );
    assert.ok(
      blockedViewError("inventory/itineraries-all").includes("agent catalog")
    );
  });

  it("accepts only full Fide ids for place params", () => {
    assert.equal(
      validateAgentViewParams({ city: SYDNEY, price_tier: "" }),
      null
    );
    assert.equal(validateAgentViewParams({ fideId: SYDNEY }), null);
    assert.equal(validateAgentViewParams({ city: "" }), null);
    assert.equal(validateAgentViewParams({ q: "Sydney" }), null);
    assert.ok(
      validateAgentViewParams({ city: "sydney" })?.includes("full Fide id")
    );
    assert.ok(
      validateAgentViewParams({
        city: "0x4020434523b50f52aa55da3e9d53c0355d620069",
      })?.includes("full Fide id")
    );
    assert.ok(
      validateAgentViewParams({
        from: "https://www.catalinaquest.ai/#place=cairns",
      })?.includes("full Fide id")
    );
  });

  it("refuses the removed IRI params with a clear message", () => {
    const error = validateAgentViewParams({
      place_iri: "https://www.catalinaquest.ai/#place=sydney",
    });
    assert.ok(error?.includes('"place_iri" is no longer accepted'));
    assert.ok(error?.includes("fideId"));
    assert.equal(validateAgentViewParams({ hotel_iri: "" }), null);
  });

  it("does not accept a Fide id missing its fingerprint", () => {
    assert.ok(
      validateAgentViewParams({ fideId: "did:fide:0x4020" })?.includes(
        "full Fide id"
      )
    );
  });
});
