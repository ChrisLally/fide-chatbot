import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  itineraryExportFilename,
  itineraryToPrintHtml,
} from "./print-html.ts";
import type { ClientItinerary } from "./schema.ts";

const sample: ClientItinerary = {
  title: "Sydney & Lady Elliot",
  summary: "A first-timer spine.",
  durationDays: 8,
  stops: [
    {
      placeId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
      placeName: "Sydney",
      nights: 4,
      hotelName: "Park Hyatt Sydney",
      hotelId: "did:fide:0x112099ee71c0bbe3b30b275b32bbf65c900ef17a",
    },
    {
      placeId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
      placeName: "Lady Elliot Island",
      nights: 3,
    },
  ],
  days: [],
  transfers: [
    {
      fromStopIndex: 0,
      toStopIndex: 1,
      fromPlaceName: "Sydney",
      toPlaceName: "Lady Elliot Island",
      mode: "flight",
      durationHours: 2,
    },
  ],
  workflow: { stage: "route", approved: {} },
};

describe("itinerary print html", () => {
  it("slugs the filename", () => {
    assert.equal(
      itineraryExportFilename("Sydney & Lady Elliot", "html"),
      "sydney-lady-elliot.html"
    );
  });

  it("renders title, stays, and transfers without JSON", () => {
    const html = itineraryToPrintHtml(sample);
    assert.ok(String(html).includes("Sydney &amp; Lady Elliot"));
    assert.ok(String(html).includes("Park Hyatt Sydney"));
    assert.ok(String(html).includes("Lady Elliot Island"));
    assert.ok(String(html).includes("flight"));
    assert.ok(!String(html).includes("did:fide"));
    assert.ok(!String(html).includes("\"stops\""));
  });
});
