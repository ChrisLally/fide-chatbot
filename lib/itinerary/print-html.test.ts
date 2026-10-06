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
  startDate: "2027-04-29",
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
  days: [
    {
      dayNumber: 1,
      stopIndex: 0,
      title: "Arrive Sydney",
      description: "Settle in; light harbour walk only.",
      transitNote: "No rental car Day 1.",
      blocks: [
        {
          when: "afternoon",
          entityId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
          entityName: "Sydney Harbour",
          entityKind: "destination",
          note: "Harbour foreshore stroll after arrival",
        },
      ],
    },
  ],
  transfers: [
    {
      fromStopIndex: 0,
      toStopIndex: 1,
      fromPlaceName: "Sydney",
      toPlaceName: "Lady Elliot Island",
      mode: "flight",
      durationHours: 2,
      note: "Via Brisbane gateway — light aircraft to the island.",
    },
  ],
  workflow: { stage: "stops", approved: {} },
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
    assert.ok(String(html).includes("Booking"));
    assert.ok(String(html).includes("Quotation"));
    assert.ok(String(html).includes("Accommodation:"));
    assert.ok(String(html).includes("Transfer:"));
    assert.ok(String(html).includes("Check in date:"));
    assert.ok(String(html).includes("Check out date:"));
    assert.ok(String(html).includes("Description:"));
    assert.ok(String(html).includes("Settle in; light harbour walk only."));
    assert.ok(String(html).includes("Harbour foreshore stroll after arrival"));
    assert.ok(String(html).includes("Via Brisbane gateway"));
    assert.ok(String(html).includes("No rental car Day 1."));
    assert.ok(String(html).includes("date-bar"));
    assert.ok(!String(html).includes("did:fide"));
    assert.ok(!String(html).includes('"stops"'));
  });

  it("uses calendar date bars when startDate is set", () => {
    const html = itineraryToPrintHtml({
      ...sample,
      startDate: "2027-04-29",
    });
    assert.ok(String(html).includes("Thursday, 29 Apr 27"));
    // Day 1 accommodation bar + check-in
    assert.ok(String(html).includes("Check in date:"));
    assert.ok(String(html).includes("Thursday, 29 Apr 27"));
    // Sydney 4 nights → checkout Day 5 = Mon 3 May 27
    assert.ok(String(html).includes("Monday, 3 May 27"));
  });
});
