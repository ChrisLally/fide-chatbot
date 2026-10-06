import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTurnEntityBinder } from "./entity-binder.ts";
import {
  applyItineraryPatch,
  applyItineraryPatches,
  fitStopsToTripLength,
  materializeStops,
} from "./patch.ts";
import type { ClientItinerary } from "./schema.ts";
import type { PlacePolicyMap } from "./place-policy.ts";
import { ensureArtifactIds } from "./ids.ts";

const sydney = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
const lei = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";
const adina = "did:fide:0x112099ee71c0bbe3b30b275b32bbf65c900ef17a";
const blue = "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb";

const stayPolicies: PlacePolicyMap = new Map([
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
  [
    sydney,
    {
      fideId: sydney,
      placeName: "Sydney",
      stayMinNights: 2,
      stayRecommendedNights: 3,
      stayMaxNights: 5,
      incompatibleOvernightFideIds: [],
      incompatibleOvernightIris: [],
      overnightRequiresBrief: false,
    },
  ],
]);

const sample: ClientItinerary = ensureArtifactIds({
  title: "Test",
  summary: "",
  durationDays: 7,
  version: 1,
  schemaVersion: 2,
  stops: [
    { placeId: sydney, placeName: "Sydney", nights: 3 },
    { placeId: lei, placeName: "Lady Elliot Island", nights: 4 },
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
      title: "Stay in Lady Elliot Island",
      description: "",
      blocks: [],
    },
  ],
  transfers: [],
  workflow: {
    stage: "stays",
    approved: { stops: { at: "x", by: "human" } },
  },
});

function binderWith(...entities: Array<{ fideId: string; name: string; kind: "destination" | "hotel" | "activity" | "attraction" }>) {
  const binder = createTurnEntityBinder();
  binder.addMany(entities);
  return binder;
}

describe("applyItineraryPatch", () => {
  it("sets a hotel without rewriting the stops", () => {
    const result = applyItineraryPatch(
      sample,
      { op: "setStopHotel", stopId: sample.stops[0].stopId!, hotelId: adina, hotelName: "Adina" },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: adina, name: "Adina Sydney", kind: "hotel" }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops[0]?.hotelId, adina);
    assert.equal(result.itinerary.stops[1]?.placeId, lei);
    assert.equal(result.itinerary.stops[1]?.hotelId, undefined);
    // LEI is hotel-exempt for Approve, so soft auto-advance may bump past +1.
    assert.ok((result.itinerary.version ?? 0) > (sample.version ?? 1));
  });

  it("sets a hotel from a typed 0x11 id even with an empty allowlist", () => {
    const parkHyatt =
      "did:fide:0x1120f8d7d887bf79cfbce86593bd0e76764fcaff";
    const result = applyItineraryPatch(sample, {
      op: "setStopHotel",
      stopId: sample.stops[0].stopId!,
      hotelId: parkHyatt,
      hotelName: "Park Hyatt Sydney",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops[0]?.hotelId, parkHyatt);
    assert.equal(result.itinerary.stops[0]?.hotelName, "Park Hyatt Sydney");
    assert.equal(result.itinerary.stops[1]?.placeId, lei);
  });

  it("refuses hotels before stops are approved", () => {
    const result = applyItineraryPatch(
      { ...sample, workflow: { stage: "stops", approved: {} } },
      {
        op: "setStopHotel",
        stopId: sample.stops[0].stopId!,
        hotelId: adina,
        hotelName: "Adina",
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Approve Stops/i);
    assert.equal(result.diagnostics[0]?.code, "STAGE_BLOCKED");
  });

  it("rejects a non-hotel fide id for stays", () => {
    const result = applyItineraryPatch(
      sample,
      { op: "setStopHotel", stopId: sample.stops[0].stopId!, hotelId: sydney },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" }
      )
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "KIND_MISMATCH");
  });

  it("changes nights in code and updates durationDays", () => {
    const result = applyItineraryPatch(sample, {
      op: "setStopNights",
      stopId: sample.stops[1].stopId!,
      nights: 5,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops[1]?.nights, 5);
    assert.equal(result.itinerary.durationDays, 9);
    assert.equal(result.itinerary.days.length, 9);
    assert.equal(result.itinerary.stops[0]?.placeId, sydney);
  });

  it("rejects setStopNights above graph stay-max", () => {
    const result = applyItineraryPatch(
      sample,
      { op: "setStopNights", stopId: sample.stops[1].stopId!, nights: 6 },
      undefined,
      { placePolicies: stayPolicies }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /stay-max/i);
  });

  it("applies a hotel batch in one call so no stop is lost", () => {
    const hotelA = adina;
    const hotelB = "did:fide:0x1120aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = applyItineraryPatches(sample, [
      { op: "setStopHotel", stopId: sample.stops[0].stopId!, hotelId: hotelA, hotelName: "Adina" },
      { op: "setStopHotel", stopId: sample.stops[1].stopId!, hotelId: hotelB, hotelName: "Island Resort" },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops[0]?.hotelId, hotelA);
    assert.equal(result.itinerary.stops[0]?.hotelName, "Adina");
    assert.equal(result.itinerary.stops[1]?.hotelId, hotelB);
    assert.equal(result.itinerary.stops[1]?.hotelName, "Island Resort");
    // Soft auto-advance: stays complete → days
    assert.equal(result.itinerary.workflow?.stage, "days");
    assert.equal(result.itinerary.workflow?.approved.stays?.by, "auto");
  });

  it("inserts a stop via temp key and later setStopHotel in same batch", () => {
    const result = applyItineraryPatches(
      sample,
      [
        {
          op: "addStop",
          afterStopId: sample.stops[0].stopId!,
          key: "new1",
          placeId: blue,
          placeName: "Blue Mountains",
          nights: 2,
        },
        {
          op: "setStopHotel",
          stopId: "new1",
          hotelId: adina,
          hotelName: "Echoes",
        },
      ],
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Blue Mountains", kind: "destination" },
        { fideId: adina, name: "Echoes", kind: "hotel" }
      )
    );
    // addStop clears stays; hotels blocked until stops re-approved — hotel op fails atomically
    // Actually stage is still stays after addStop (approvals cleared but stage stays).
    // Hotel ops are allowed on stays stage. But addStop is a stops-structure change on stays stage — allowed.
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.itinerary.stops.map((s) => s.placeName), [
      "Sydney",
      "Blue Mountains",
      "Lady Elliot Island",
    ]);
    assert.equal(result.itinerary.stops[1]?.hotelId, adina);
    assert.ok(result.itinerary.stops[1]?.stopId?.startsWith("s"));
  });

  it("rejects duplicate temp keys", () => {
    const result = applyItineraryPatches(sample, [
      { op: "addStop", afterIndex: -1, key: "x", placeId: blue, nights: 1 },
      { op: "addStop", afterIndex: 0, key: "x", placeId: blue, nights: 1 },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "DUPLICATE_TEMP_KEY");
  });

  it("rejects undefined temp key references", () => {
    const result = applyItineraryPatch(sample, {
      op: "setStopHotel",
      stopId: "missing-key",
      hotelId: adina,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "TEMP_KEY_UNDEFINED");
  });

  it("inserts a stop and remaps later day stopIndex", () => {
    const result = applyItineraryPatch(
      sample,
      { op: "addStop", afterIndex: 0, placeId: blue, placeName: "Blue Mountains", nights: 2 },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Blue Mountains", kind: "destination" }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.itinerary.stops.map((s) => s.placeName), [
      "Sydney",
      "Blue Mountains",
      "Lady Elliot Island",
    ]);
    assert.equal(result.itinerary.days.length, 10);
    assert.equal(result.itinerary.days.filter((d) => d.stopIndex === 0).length, 3);
    assert.equal(result.itinerary.days.find((d) => d.title.includes("Lady Elliot"))?.stopIndex, 2);
  });

  it("retitles day cards when a stop place is replaced and marks days stale", () => {
    const result = applyItineraryPatch(
      sample,
      {
        op: "replaceStopPlace",
        stopId: sample.stops[1].stopId!,
        placeId: blue,
        placeName: "Hunter Valley",
      },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Hunter Valley", kind: "destination" }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops[1]?.placeName, "Hunter Valley");
    assert.equal(result.itinerary.stops[1]?.hotelId, undefined);
    const stopDays = result.itinerary.days.filter(
      (d) => d.stopId === result.itinerary.stops[1]?.stopId
    );
    assert.equal(stopDays.some((d) => /blue mountains/i.test(d.title)), false);
    assert.match(String(stopDays[0]?.title), /Hunter Valley/i);
    assert.equal(stopDays.every((d) => d.stale === true), true);
  });

  it("removes a stop and remaps days", () => {
    const result = applyItineraryPatch(sample, {
      op: "removeStop",
      stopId: sample.stops[0].stopId!,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.stops.length, 1);
    assert.equal(result.itinerary.days.every((d) => d.stopIndex === 0), true);
  });

  it("requires confirmShrink when nights shrink would drop blocks", () => {
    const withBlocks = syncDaysWithBlocks(sample);
    const result = applyItineraryPatch(withBlocks, {
      op: "setStopNights",
      stopId: withBlocks.stops[0].stopId!,
      nights: 1,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "NIGHTS_SHRINK_NEEDS_CONFIRM");

    const confirmed = applyItineraryPatch(withBlocks, {
      op: "setStopNights",
      stopId: withBlocks.stops[0].stopId!,
      nights: 1,
      confirmShrink: true,
    });
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.itinerary.stops[0]?.nights, 1);
  });

  it("rejects the whole batch atomically on mid-batch failure", () => {
    const result = applyItineraryPatches(sample, [
      { op: "setStopHotel", stopId: sample.stops[0].stopId!, hotelId: adina },
      { op: "setStopHotel", stopId: sample.stops[1].stopId!, hotelId: sydney },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.opIndex, 1);
    assert.equal(result.diagnostics[0]?.code, "KIND_MISMATCH");
  });
});

function syncDaysWithBlocks(base: ClientItinerary): ClientItinerary {
  const activity = "did:fide:0x3120b1adca8b4d76b4a1616779887e8943b1c32e";
  return {
    ...base,
    days: [
      {
        dayNumber: 1,
        dayId: "d1",
        stopIndex: 0,
        stopId: base.stops[0].stopId,
        title: "Stay in Sydney",
        description: "",
        blocks: [
          {
            when: "morning",
            entityId: activity,
            entityName: "Opera House",
            entityKind: "attraction",
          },
        ],
      },
      {
        dayNumber: 2,
        dayId: "d2",
        stopIndex: 0,
        stopId: base.stops[0].stopId,
        title: "Sydney · day 2",
        description: "",
        blocks: [
          {
            when: "afternoon",
            entityId: activity,
            entityName: "Opera House",
            entityKind: "attraction",
          },
        ],
      },
      {
        dayNumber: 3,
        dayId: "d3",
        stopIndex: 0,
        stopId: base.stops[0].stopId,
        title: "Sydney · day 3",
        description: "",
        blocks: [
          {
            when: "evening",
            entityId: activity,
            entityName: "Opera House",
            entityKind: "attraction",
          },
        ],
      },
    ],
  };
}

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
    assert.equal(result.itinerary.days.filter((d) => d.stopIndex === 0).length, 3);
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
    assert.equal(result.itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0), 17);
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
    assert.equal(result.itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0), 17);
    assert.deepEqual(result.itinerary.stops.map((stop) => stop.nights), [2, 3, 4, 4, 4]);
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
    assert.equal(result.stops.reduce((s, x) => s + x.nights, 0), 7);
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
