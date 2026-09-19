import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindItineraryToAllowlist,
  createTurnEntityBinder,
  harvestEntitiesFromRunView,
  normalizeEntityName,
} from "./entity-binder.ts";
import {
  parseClientItinerary,
  type ClientItinerary,
} from "./schema.ts";

const ADELAIDE =
  "did:fide:0x4020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MELBOURNE =
  "did:fide:0x4020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HOTEL =
  "did:fide:0x1120cccccccccccccccccccccccccccccccccccc";
const ACTIVITY =
  "did:fide:0x3120dddddddddddddddddddddddddddddddddddd";

describe("normalizeEntityName", () => {
  it("collapses punctuation and case", () => {
    assert.equal(normalizeEntityName("  Adelaide! "), "adelaide");
    assert.equal(normalizeEntityName("Blue-Mountains"), "blue mountains");
  });
});

describe("harvestEntitiesFromRunView", () => {
  it("harvests markdown place sections with Fide ID", () => {
    const text = `### Adelaide
**Fide ID:** ${ADELAIDE}
**Region:** SA

### Melbourne
**Fide ID:** ${MELBOURNE}
`;
    const entities = harvestEntitiesFromRunView("inventory/places", text);
    assert.equal(entities.length, 2);
    assert.equal(entities[0].name, "Adelaide");
    assert.equal(entities[0].fideId, ADELAIDE);
    assert.equal(entities[0].kind, "destination");
    assert.equal(entities[1].name, "Melbourne");
  });

  it("harvests hotel sections", () => {
    const text = `### ${HOTEL}
**Hotel:** Mayfair Hotel Adelaide
**City:** Adelaide
`;
    const entities = harvestEntitiesFromRunView("inventory/hotels-by-city", text);
    assert.ok(entities.some((e) => e.name === "Mayfair Hotel Adelaide"));
    assert.equal(
      entities.find((e) => e.name === "Mayfair Hotel Adelaide")?.kind,
      "hotel"
    );
  });
});

describe("bindItineraryToAllowlist", () => {
  it("binds names to allowlisted fide ids and drops unknowns", () => {
    const draft: ClientItinerary = {
      title: "SA short",
      summary: "",
      durationDays: 2,
      stops: [
        {
          placeId: "pending:place:Adelaide",
          placeName: "Adelaide",
          nights: 2,
          hotelId: "pending:hotel:Mayfair Hotel Adelaide",
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
              entityId: "pending:activity:Central Market Tour",
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

  it("prefers name match over a wrong model-supplied id", () => {
    const draft: ClientItinerary = {
      title: "Wrong id",
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

    assert.equal(itinerary.stops[0].placeId, ADELAIDE);
    assert.equal(itinerary.stops[0].placeName, "Adelaide");
  });
});

describe("createTurnEntityBinder + parse allowUnbound", () => {
  it("parses name-only draft then binds", () => {
    const binder = createTurnEntityBinder();
    binder.harvestRunView(
      "inventory/places",
      `### Adelaide\n**Fide ID:** ${ADELAIDE}\n`
    );
    binder.harvestRunView(
      "inventory/activities-all",
      `### Central Market Tour\n**Fide ID:** ${ACTIVITY}\n`
    );

    const raw = JSON.stringify({
      title: "Name only",
      summary: "",
      durationDays: 1,
      stops: [{ placeName: "Adelaide", nights: 1 }],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Market",
          description: "",
          blocks: [
            {
              when: "morning",
              entityName: "Central Market Tour",
              entityKind: "activity",
            },
          ],
        },
      ],
    });

    const parsed = parseClientItinerary(raw, { allowUnbound: true });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.match(parsed.data.stops[0].placeId, /^pending:/);
    const { itinerary, omitted } = binder.bind(parsed.data);
    assert.equal(omitted.length, 0);
    assert.equal(itinerary.stops[0].placeId, ADELAIDE);
    assert.equal(itinerary.days[0].blocks?.[0].entityId, ACTIVITY);
  });
});
