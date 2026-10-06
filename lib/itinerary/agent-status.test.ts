import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildItineraryToolStatus } from "./agent-status.ts";
import type { PlacePolicyMap } from "./place-policy.ts";
import type { ClientItinerary } from "./schema.ts";

const sydney = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
const lei = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";

const policies: PlacePolicyMap = new Map([
  [
    lei,
    {
      fideId: lei,
      placeName: "Lady Elliot Island",
      stayMinNights: 3,
      stayRecommendedNights: 3,
      stayMaxNights: 5,
      incompatibleOvernightFideIds: [],
      incompatibleOvernightIris: [],
      overnightRequiresBrief: false,
    },
  ],
]);

const base: ClientItinerary = {
  title: "Test",
  summary: "",
  durationDays: 8,
  stops: [
    { placeId: sydney, placeName: "Sydney", nights: 3 },
    { placeId: lei, placeName: "Lady Elliot Island", nights: 4 },
  ],
  days: [],
  workflow: { stage: "stops", approved: {} },
};

describe("buildItineraryToolStatus", () => {
  it("marks Approve clickable on a valid stops", () => {
    const status = buildItineraryToolStatus(base, policies);
    assert.equal(status.stage, "stops");
    assert.equal(status.approveButtonClickable, true);
    assert.equal(status.stops.length, 2);
    assert.match(status.nextAction, /IS clickable/i);
  });

  it("marks Approve not clickable when stay-min fails", () => {
    const short: ClientItinerary = {
      ...base,
      stops: [
        base.stops[0],
        { ...base.stops[1], nights: 2 },
      ],
    };
    const status = buildItineraryToolStatus(short, policies);
    assert.equal(status.approveButtonClickable, false);
    assert.equal(status.errors.some((e) => /stay-min/i.test(e)), true);
    assert.match(status.nextAction, /NOT clickable/i);
  });

  it("marks Approve Stays not clickable until hotels exist", () => {
    const stays: ClientItinerary = {
      ...base,
      workflow: { stage: "stays", approved: { stops: { at: "x", by: "human" } } },
    };
    const status = buildItineraryToolStatus(stays, policies);
    assert.equal(status.stage, "stays");
    assert.equal(status.approveButtonClickable, false);
    assert.match(status.nextAction, /hotels/i);
  });
});
