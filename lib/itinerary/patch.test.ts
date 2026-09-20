import { describe, expect, it } from "vitest";
import { createTurnEntityBinder } from "./entity-binder.ts";
import {
  applyItineraryPatch,
  materializeRoute,
} from "./patch.ts";
import type { ClientItinerary } from "./schema.ts";

const sydney = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
const lei = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";
const adina = "did:fide:0x112099ee71c0bbe3b30b275b32bbf65c900ef17a";
const blue = "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb";

const sample: ClientItinerary = {
  title: "Test",
  summary: "",
  durationDays: 7,
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
  workflow: { stage: "stays", approved: { route: "x" } },
};

function binderWith(...entities: Array<{ fideId: string; name: string; kind: "destination" | "hotel" | "activity" | "attraction" }>) {
  const binder = createTurnEntityBinder();
  binder.addMany(entities);
  return binder;
}

describe("applyItineraryPatch", () => {
  it("sets a hotel without rewriting the route", () => {
    const result = applyItineraryPatch(
      sample,
      { op: "setStopHotel", stopIndex: 0, hotelId: adina, hotelName: "Adina" },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: adina, name: "Adina Sydney", kind: "hotel" }
      )
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops[0]?.hotelId).toBe(adina);
    expect(result.itinerary.stops[1]?.placeId).toBe(lei);
    expect(result.itinerary.stops[1]?.hotelId).toBeUndefined();
  });

  it("sets a hotel from a typed 0x11 id even with an empty allowlist", () => {
    const parkHyatt =
      "did:fide:0x1120f8d7d887bf79cfbce86593bd0e76764fcaff";
    const result = applyItineraryPatch(sample, {
      op: "setStopHotel",
      stopIndex: 0,
      hotelId: parkHyatt,
      hotelName: "Park Hyatt Sydney",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops[0]?.hotelId).toBe(parkHyatt);
    expect(result.itinerary.stops[0]?.hotelName).toBe("Park Hyatt Sydney");
    expect(result.itinerary.stops[1]?.placeId).toBe(lei);
  });

  it("refuses hotels before the route is approved", () => {
    const result = applyItineraryPatch(
      { ...sample, workflow: { stage: "route", approved: {} } },
      {
        op: "setStopHotel",
        stopIndex: 0,
        hotelId: adina,
        hotelName: "Adina",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Approve Route/i);
  });

  it("rejects a non-hotel fide id for stays", () => {
    const result = applyItineraryPatch(
      sample,
      { op: "proposeStay", stopIndex: 0, hotelId: sydney },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" }
      )
    );
    expect(result.ok).toBe(false);
  });

  it("changes nights in code and updates durationDays", () => {
    const result = applyItineraryPatch(sample, {
      op: "setStopNights",
      stopIndex: 1,
      nights: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops[1]?.nights).toBe(5);
    expect(result.itinerary.durationDays).toBe(9);
    expect(result.itinerary.days).toHaveLength(9);
    expect(result.itinerary.stops[0]?.placeId).toBe(sydney);
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
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops.map((s) => s.placeName)).toEqual([
      "Sydney",
      "Blue Mountains",
      "Lady Elliot Island",
    ]);
    expect(result.itinerary.days).toHaveLength(10);
    expect(result.itinerary.days.filter((d) => d.stopIndex === 0)).toHaveLength(3);
    expect(result.itinerary.days.find((d) => d.title.includes("Lady Elliot"))?.stopIndex).toBe(2);
  });

  it("retitles day cards when a stop place is replaced", () => {
    const result = applyItineraryPatch(
      sample,
      {
        op: "replaceStopPlace",
        stopIndex: 1,
        placeId: blue,
        placeName: "Hunter Valley",
      },
      binderWith(
        { fideId: sydney, name: "Sydney", kind: "destination" },
        { fideId: lei, name: "Lady Elliot Island", kind: "destination" },
        { fideId: blue, name: "Hunter Valley", kind: "destination" }
      )
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops[1]?.placeName).toBe("Hunter Valley");
    const stopDays = result.itinerary.days.filter((d) => d.stopIndex === 1);
    expect(stopDays.some((d) => /blue mountains/i.test(d.title))).toBe(false);
    expect(stopDays[0]?.title).toMatch(/Hunter Valley/i);
  });

  it("removes a stop and remaps days", () => {
    const result = applyItineraryPatch(sample, { op: "removeStop", stopIndex: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops).toHaveLength(1);
    expect(result.itinerary.days.every((d) => d.stopIndex === 0)).toBe(true);
  });
});

describe("materializeRoute", () => {
  it("binds names and stubs days without hotels", () => {
    const result = materializeRoute(
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
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.workflow?.stage).toBe("route");
    expect(result.itinerary.stops[0]?.hotelId).toBeUndefined();
    expect(result.itinerary.days).toHaveLength(8);
    expect(result.itinerary.days.filter((d) => d.stopIndex === 0)).toHaveLength(3);
    expect(result.itinerary.days[3]?.stopIndex).toBe(1);
    expect(result.itinerary.days.at(-1)?.title).toMatch(/Depart/i);
    expect(result.itinerary.durationDays).toBe(8);
  });

  it("adds the missing night when an 18-day route is one overnight short", () => {
    const result = materializeRoute(
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
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0)).toBe(17);
    expect(result.itinerary.stops.at(-1)?.nights).toBe(5);
    expect(result.itinerary.durationDays).toBe(18);
    expect(result.itinerary.days).toHaveLength(18);
    expect(result.itinerary.days.at(-1)?.title).toMatch(/Depart/i);
  });

  it("spreads up to 3 missing nights onto existing stops instead of adding a filler city", () => {
    const result = materializeRoute(
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
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.stops).toHaveLength(5);
    expect(result.itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0)).toBe(17);
    expect(result.itinerary.stops.map((stop) => stop.nights)).toEqual([2, 3, 4, 4, 4]);
    expect(result.itinerary.durationDays).toBe(18);
  });

  it("rejects an 18-day title with leftover unallocated nights", () => {
    const result = materializeRoute(
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/18-day/i);
    expect(result.error).toMatch(/10/);
  });

  it("expands 2 stubs into one day per night so day 3 exists", () => {
    const short: ClientItinerary = {
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
    };
    const result = applyItineraryPatch(
      { ...short, workflow: { stage: "days", approved: { route: "x", stays: "y" } } },
      {
        op: "proposeDay",
        dayNumber: 3,
        title: "Melbourne arrival",
        blocks: [],
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itinerary.days).toHaveLength(6);
    expect(result.itinerary.days[2]?.stopIndex).toBe(1);
    expect(result.itinerary.days[2]?.dayNumber).toBe(3);
  });
});
