import { describe, expect, it } from "vitest";
import type { ClientItinerary } from "./schema.ts";
import { stopStartDayNumbers, transferSlots } from "./transfers.ts";

const sample: ClientItinerary = {
  title: "T",
  summary: "",
  durationDays: 5,
  stops: [
    {
      placeId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
      placeName: "Sydney",
      nights: 2,
    },
    {
      placeId: "did:fide:0x402037d07239aa7a99e60ae0d9c31f02dc8d26a6",
      placeName: "Brisbane",
      nights: 2,
    },
  ],
  days: [],
  transfers: [
    {
      fromStopIndex: 0,
      toStopIndex: 1,
      mode: "flight",
      durationHours: 1.5,
      label: "SYD-BNE",
    },
  ],
};

describe("transferSlots", () => {
  it("always yields arrival, between, departure", () => {
    const slots = transferSlots(sample);
    expect(slots.map((s) => s.kind)).toEqual([
      "arrival",
      "between",
      "departure",
    ]);
    expect(slots[1]?.transfer?.label).toBe("SYD-BNE");
    expect(slots[0]?.transfer).toBeUndefined();
  });

  it("attaches place endpoints; route peek only when transfer.routeId is bound", () => {
    const slots = transferSlots(sample);
    const between = slots[1];
    expect(between?.fromPlaceId).toBe(sample.stops[0].placeId);
    expect(between?.toPlaceId).toBe(sample.stops[1].placeId);
    expect(between?.routeId).toBeUndefined();

    const withRoute = transferSlots({
      ...sample,
      transfers: [
        {
          ...sample.transfers[0],
          routeId: "https://www.catalinaquest.ai/#route=sydney--brisbane",
        },
      ],
    });
    expect(withRoute[1]?.routeId).toBe(
      "https://www.catalinaquest.ai/#route=sydney--brisbane"
    );
    expect(slots[0]?.toPlaceId).toBe(sample.stops[0].placeId);
    expect(slots[0]?.fromPlaceId).toBeUndefined();
    expect(slots[0]?.routeId).toBeUndefined();
    expect(slots[2]?.fromPlaceId).toBe(sample.stops[1].placeId);
  });

  it("does not invent airport arrival routes or peek Arrival as a place", () => {
    const slots = transferSlots({
      ...sample,
      transfers: [
        {
          fromStopIndex: -1,
          toStopIndex: 0,
          fromPlaceName: "Sydney Airport",
          toPlaceName: "Sydney",
          label: "Arrival",
          mode: "taxi",
        },
      ],
    });
    const arrival = slots[0];
    expect(arrival?.fromLabel).toBe("Sydney Airport");
    expect(arrival?.fromPlaceId).toBeUndefined();
    expect(arrival?.routeId).toBeUndefined();
    expect(arrival?.toPlaceId).toBe(sample.stops[0].placeId);
  });
});

describe("stopStartDayNumbers", () => {
  it("advances by nights (3 nights → next marker Day 4)", () => {
    expect(
      stopStartDayNumbers([{ nights: 3 }, { nights: 4 }, { nights: 2 }])
    ).toEqual([1, 4, 8, 10]);
  });
});
