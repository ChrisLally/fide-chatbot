import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyItineraryPatch, applyItineraryPatches } from "./patch.ts";
import { adina, binderWith, lei, sample, sydney, stayPolicies, blue } from "./patch-fixtures.ts";

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
    // Version bumps once per batch.
    assert.ok((result.itinerary.version ?? 0) > (sample.version ?? 1));
  });

  it("sets a hotel from a kind-registered 0x31 id even with an empty allowlist", () => {
    const parkHyatt =
      "did:fide:0x3120f8d7d887bf79cfbce86593bd0e76764fcaff";
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

  it("applies a hotel batch in one call so no stop is lost", () => {
    const hotelA = adina;
    const hotelB = "did:fide:0x3120777777777777777777777777777777777777";
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
    // Completing stays does not approve it: the human must click Approve Stays.
    assert.equal(result.itinerary.workflow?.stage, "stays");
    assert.equal(result.itinerary.workflow?.approved.stays, undefined);
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
