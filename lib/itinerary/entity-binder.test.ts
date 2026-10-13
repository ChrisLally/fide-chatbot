import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindItineraryToAllowlist,
  createTurnEntityBinder,
  harvestEntitiesFromRunView,
  normalizeEntityName,
} from "./entity-binder.ts";
import { registerAllFixtureKinds } from "./kind-fixtures.ts";
import { type ClientItinerary, parseClientItinerary } from "./schema.ts";

registerAllFixtureKinds();

const ADELAIDE = "did:fide:0x4020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MELBOURNE = "did:fide:0x4020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HOTEL = "did:fide:0x3120cccccccccccccccccccccccccccccccccccc";
const ACTIVITY = "did:fide:0x3120dddddddddddddddddddddddddddddddddddd";

describe("normalizeEntityName", () => {
  it("collapses punctuation and case", () => {
    assert.equal(normalizeEntityName("  Adelaide! "), "adelaide");
    assert.equal(normalizeEntityName("Blue-Mountains"), "blue mountains");
  });
});

/** A run_view tool result as the Fide MCP server returns it: markdown text plus structured rows. */
function viewResult(rows: Record<string, unknown>[]) {
  return {
    content: [{ type: "text", text: "rendered markdown" }],
    structuredContent: { result: { rows, rowCount: rows.length } },
  };
}

describe("harvestEntitiesFromRunView", () => {
  it("harvests place rows by place name and Fide id", () => {
    const entities = harvestEntitiesFromRunView(
      "inventory/places",
      viewResult([
        { fide_id: ADELAIDE, place_name: "Adelaide" },
        { fide_id: MELBOURNE, place_name: "Melbourne" },
      ])
    );
    assert.equal(entities.length, 2);
    assert.equal(entities[0].name, "Adelaide");
    assert.equal(entities[0].fideId, ADELAIDE);
    assert.equal(entities[0].kind, "destination");
    assert.equal(entities[1].name, "Melbourne");
  });

  it("harvests hotel rows", () => {
    const entities = harvestEntitiesFromRunView(
      "inventory/hotels-by-city",
      viewResult([{ fide_id: HOTEL, hotel_name: "Mayfair Hotel Adelaide" }])
    );
    assert.equal(entities.length, 1);
    assert.equal(entities[0].name, "Mayfair Hotel Adelaide");
    assert.equal(entities[0].kind, "hotel");
  });

  it("harvests nothing from rendered text without structured rows", () => {
    const text = `### Adelaide
**Fide ID:** ${ADELAIDE}
`;
    assert.deepEqual(harvestEntitiesFromRunView("inventory/places", text), []);
  });

  it("does not treat restaurants as hotels (kind comes from the kind registry)", () => {
    const entities = harvestEntitiesFromRunView(
      "inventory/restaurants-by-city",
      viewResult([
        {
          fide_id: "did:fide:0x3120ffffffffffffffffffffffffffffffffffffff",
          restaurant: "Some Restaurant",
        },
      ])
    );
    assert.deepEqual(entities, []);
  });
});

describe("bindItineraryToAllowlist", () => {
  it("binds allowlisted fide ids and drops unknowns", () => {
    const draft: ClientItinerary = {
      title: "SA short",
      summary: "",
      durationDays: 2,
      stops: [
        {
          placeId: ADELAIDE,
          placeName: "Adelaide",
          nights: 2,
          hotelId: HOTEL,
          hotelName: "Mayfair Hotel Adelaide",
        },
        {
          placeId: "pending:place:Atlantis",
          placeName: "Atlantis",
          nights: 1,
        },
      ],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Arrive",
          description: "",
          blocks: [
            {
              when: "afternoon",
              entityId: ACTIVITY,
              entityName: "Central Market Tour",
              entityKind: "activity",
            },
            {
              when: "evening",
              entityId: "pending:activity:Fake Dive",
              entityName: "Fake Dive",
              entityKind: "activity",
            },
          ],
        },
        {
          dayNumber: 2,
          stopIndex: 1,
          title: "Lost city",
          description: "",
          blocks: [],
        },
      ],
    };

    const { itinerary, omitted } = bindItineraryToAllowlist(draft, [
      { fideId: ADELAIDE, name: "Adelaide", kind: "destination" },
      { fideId: HOTEL, name: "Mayfair Hotel Adelaide", kind: "hotel" },
      { fideId: ACTIVITY, name: "Central Market Tour", kind: "activity" },
    ]);

    assert.equal(itinerary.stops.length, 1);
    assert.equal(itinerary.stops[0].placeId, ADELAIDE);
    assert.equal(itinerary.stops[0].hotelId, HOTEL);
    assert.equal(itinerary.days.length, 1);
    assert.equal(itinerary.days[0].blocks?.length, 1);
    assert.equal(itinerary.days[0].blocks?.[0].entityId, ACTIVITY);
    assert.ok(omitted.some((o) => o.includes("Atlantis")));
    assert.ok(omitted.some((o) => o.includes("Fake Dive")));
  });

  it("keeps model-supplied fide id even when the name is wrong", () => {
    const draft: ClientItinerary = {
      title: "Wrong name",
      summary: "",
      durationDays: 1,
      stops: [
        {
          placeId: MELBOURNE,
          placeName: "Adelaide",
          nights: 1,
        },
      ],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Day",
          description: "",
          blocks: [],
        },
      ],
    };

    const { itinerary } = bindItineraryToAllowlist(draft, [
      { fideId: ADELAIDE, name: "Adelaide", kind: "destination" },
      { fideId: MELBOURNE, name: "Melbourne", kind: "destination" },
    ]);

    assert.equal(itinerary.stops[0].placeId, MELBOURNE);
    assert.equal(itinerary.stops[0].placeName, "Melbourne");
  });

  it("does not bind by name alone", () => {
    const draft: ClientItinerary = {
      title: "Name only",
      summary: "",
      durationDays: 1,
      stops: [
        { placeId: "pending:place:Adelaide", placeName: "Adelaide", nights: 1 },
      ],
      days: [],
    };

    const { itinerary, omitted } = bindItineraryToAllowlist(draft, [
      { fideId: ADELAIDE, name: "Adelaide", kind: "destination" },
    ]);

    assert.equal(itinerary.stops.length, 0);
    assert.ok(omitted.some((o) => o.includes("Adelaide")));
  });
});

describe("createTurnEntityBinder + parse allowUnbound", () => {
  it("parses draft with fide ids then binds", () => {
    const binder = createTurnEntityBinder();
    binder.harvestRunView(
      "inventory/places",
      viewResult([{ fide_id: ADELAIDE, place_name: "Adelaide" }])
    );
    binder.harvestRunView(
      "inventory/activities-all",
      viewResult([{ fide_id: ACTIVITY, activity: "Central Market Tour" }])
    );

    const raw = JSON.stringify({
      title: "Ids only",
      summary: "",
      durationDays: 1,
      stops: [{ placeId: ADELAIDE, placeName: "Adelaide", nights: 1 }],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Day 1",
          description: "",
          blocks: [
            {
              when: "morning",
              entityId: ACTIVITY,
              entityName: "Central Market Tour",
              entityKind: "activity",
            },
          ],
        },
      ],
    });

    const parsed = parseClientItinerary(raw, { allowUnbound: true });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const { itinerary, omitted } = binder.bind(parsed.data);
    assert.equal(itinerary.stops[0].placeId, ADELAIDE);
    assert.equal(itinerary.days[0].blocks?.[0].entityId, ACTIVITY);
    assert.equal(omitted.length, 0);
  });
});
