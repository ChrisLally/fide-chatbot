import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.deepEqual(slots.map((s) => s.kind), [
      "arrival",
      "between",
      "departure",
    ]);
    assert.equal(slots[1]?.transfer?.label, "SYD-BNE");
    assert.equal(slots[0]?.transfer, undefined);
  });

  it("attaches place endpoints; route peek only when transfer.routeId is bound", () => {
    const slots = transferSlots(sample);
    const between = slots[1];
    assert.equal(between?.fromPlaceId, sample.stops[0].placeId);
    assert.equal(between?.toPlaceId, sample.stops[1].placeId);
    assert.equal(between?.routeId, undefined);

    const withRoute = transferSlots({
      ...sample,
      transfers: [
        {
          ...sample.transfers[0],
          routeId: "https://www.catalinaquest.ai/#route=sydney--brisbane",
        },
      ],
    });
    assert.equal(
      withRoute[1]?.routeId,
      "https://www.catalinaquest.ai/#route=sydney--brisbane"
    );
    assert.equal(slots[0]?.toPlaceId, sample.stops[0].placeId);
    assert.equal(slots[0]?.fromPlaceId, undefined);
    assert.equal(slots[0]?.routeId, undefined);
    assert.equal(slots[2]?.fromPlaceId, sample.stops[1].placeId);
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
    assert.equal(arrival?.fromLabel, "Sydney Airport");
    assert.equal(arrival?.fromPlaceId, undefined);
    assert.equal(arrival?.routeId, undefined);
    assert.equal(arrival?.toPlaceId, sample.stops[0].placeId);
  });
});

describe("stopStartDayNumbers", () => {
  it("advances by nights (3 nights → next marker Day 4)", () => {
    assert.deepEqual(
      stopStartDayNumbers([{ nights: 3 }, { nights: 4 }, { nights: 2 }]),
      [1, 4, 8, 10]
    );
  });
});
