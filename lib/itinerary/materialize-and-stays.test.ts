import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureArtifactIds } from "./ids.ts";
import {
  applyItineraryPatch,
  fitStopsToTripLength,
  materializeStops,
} from "./patch.ts";
import {
  binderWith,
  blue,
  lei,
  sample,
  stayPolicies,
  sydney,
} from "./patch-fixtures";

describe("materializeStops", () => {
  it("binds names and stubs days without hotels", () => {
    const result = materializeStops(
      "Trip",
      {
        stops: [
          { placeId: sydney, placeName: "Sydney", nights: 3 },
          { placeId: lei, placeName: "Lady Elliot Island", nights: 4 },
        ],
      },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.workflow?.stage, "stops");
    assert.equal(result.itinerary.stops[0]?.hotelId, undefined);
    assert.ok(result.itinerary.stops[0]?.stopId);
    assert.ok(result.itinerary.days[0]?.dayId);
    assert.equal(result.itinerary.days.length, 8);
    assert.equal(
      result.itinerary.days.filter((d) => d.stopIndex === 0).length,
      3
    );
    assert.equal(result.itinerary.days[3]?.stopIndex, 1);
    assert.match(String(result.itinerary.days.at(-1)?.title), /Depart/i);
    assert.equal(result.itinerary.durationDays, 8);
    assert.equal(result.itinerary.schemaVersion, 2);
    assert.equal(result.itinerary.version, 1);
  });

  it("adds the missing night when an 18-day route is one overnight short", () => {
    const result = materializeStops(
      "18-day luxury Australia",
      {
        stops: [
          { placeId: sydney, placeName: "Brisbane", nights: 2 },
          { placeId: lei, placeName: "Lady Elliot Island", nights: 4 },
          { placeId: blue, placeName: "Noosa", nights: 3 },
          {
            placeId: "did:fide:0x4020b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1aa00",
            placeName: "Byron Bay",
            nights: 3,
          },
          {
            placeId: "did:fide:0x4020c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1aa00",
            placeName: "Sydney",
            nights: 4,
          },
        ],
      },
      binderWith(
        { fideId: sydney, name: "Brisbane", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Noosa", kind: "destination" },
        {
          fideId: "did:fide:0x4020b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1aa00",
          name: "Byron Bay",
          kind: "destination",
        },
        {
          fideId: "did:fide:0x4020c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1aa00",
          name: "Sydney",
          kind: "destination",
        }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0),
      17
    );
    assert.equal(result.itinerary.stops.at(-1)?.nights, 5);
    assert.equal(result.itinerary.durationDays, 18);
    assert.equal(result.itinerary.days.length, 18);
    assert.match(String(result.itinerary.days.at(-1)?.title), /Depart/i);
  });

  it("spreads up to 3 missing nights onto existing stops instead of adding a filler city", () => {
    const result = materializeStops(
      "18-day Lady Elliot diving trip",
      {
        stops: [
          { placeId: sydney, placeName: "Brisbane", nights: 2 },
          { placeId: lei, placeName: "Lady Elliot Island", nights: 3 },
          { placeId: blue, placeName: "Whitsundays", nights: 3 },
          {
            placeId: "did:fide:0x4020b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1aa00",
            placeName: "Daintree",
            nights: 3,
          },
          {
            placeId: "did:fide:0x4020c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1aa00",
            placeName: "Sydney",
            nights: 3,
          },
        ],
      },
      binderWith(
        { fideId: sydney, name: "Brisbane", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Whitsundays", kind: "destination" },
        {
          fideId: "did:fide:0x4020b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1aa00",
          name: "Daintree",
          kind: "destination",
        },
        {
          fideId: "did:fide:0x4020c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1aa00",
          name: "Sydney",
          kind: "destination",
        }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops.length, 5);
    assert.equal(
      result.itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0),
      17
    );
    assert.deepEqual(
      result.itinerary.stops.map((stop) => stop.nights),
      [2, 3, 4, 4, 4]
    );
    assert.equal(result.itinerary.durationDays, 18);
  });

  it("rejects an 18-day title with leftover unallocated nights", () => {
    const result = materializeStops(
      "18-Day Australia itinerary",
      {
        stops: [
          { placeId: sydney, placeName: "Brisbane", nights: 2 },
          { placeId: lei, placeName: "Lady Elliot Island", nights: 3 },
          { placeId: blue, placeName: "Port Douglas", nights: 5 },
        ],
      },
      binderWith(
        { fideId: sydney, name: "Brisbane", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Port Douglas", kind: "destination" }
      )
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /18-day/i);
    assert.match(result.error, /10/);
  });

  it("expands stubs so setDayBlocks can address day 3 by dayNumber", () => {
    const short: ClientItinerary = ensureArtifactIds({
      ...sample,
      durationDays: 5,
      stops: [
        { placeId: sydney, placeName: "Sydney", nights: 2 },
        { placeId: blue, placeName: "Melbourne", nights: 3 },
      ],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Stay in Sydney",
          description: "",
          blocks: [],
        },
        {
          dayNumber: 2,
          stopIndex: 1,
          title: "Stay in Melbourne",
          description: "",
          blocks: [],
        },
      ],
      workflow: {
        stage: "days",
        approved: {
          stops: { at: "x", by: "human" },
          stays: { at: "y", by: "human" },
        },
      },
    });
    const result = applyItineraryPatch(short, {
      op: "setDayBlocks",
      dayNumber: 3,
      title: "Melbourne arrival",
      blocks: [],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.days.length, 6);
    assert.equal(result.itinerary.days[2]?.stopIndex, 1);
    assert.equal(result.itinerary.days[2]?.dayNumber, 3);
  });

  it("setStartDate writes the calendar field (not summary)", () => {
    const result = applyItineraryPatch(sample, {
      op: "setStartDate",
      startDate: "2027-04-29",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.startDate, "2027-04-29");
    assert.equal(result.itinerary.summary, sample.summary);

    const cleared = applyItineraryPatch(result.itinerary, {
      op: "setStartDate",
      startDate: "",
    });
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    assert.equal(cleared.itinerary.startDate, undefined);
  });
});

describe("fitStopsToTripLength stay bands", () => {
  it("pads toward recommended before other headroom under max", () => {
    const result = fitStopsToTripLength(
      [
        { placeId: sydney, placeName: "Sydney", nights: 2 },
        { placeId: lei, placeName: "Lady Elliot Island", nights: 3 },
      ],
      8,
      stayPolicies
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.stops.reduce((s, x) => s + x.nights, 0),
      7
    );
    assert.equal(result.stops[0]?.nights, 3);
    assert.ok((result.stops[1]?.nights ?? 0) >= 3);
    assert.ok((result.stops[1]?.nights ?? 0) <= 5);
  });

  it("refuses to autofit above stay-max", () => {
    const result = fitStopsToTripLength(
      [{ placeId: lei, placeName: "Lady Elliot Island", nights: 5 }],
      10,
      stayPolicies
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /stay-min\/max|stay-max/i);
  });

  it("refuses to autofit below stay-min", () => {
    const result = fitStopsToTripLength(
      [
        { placeId: sydney, placeName: "Sydney", nights: 2 },
        { placeId: lei, placeName: "Lady Elliot Island", nights: 3 },
      ],
      4,
      stayPolicies
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /stay-min/i);
  });
});
