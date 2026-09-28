import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveCurrentStage,
  calendarDayCount,
  ensureWorkflow,
  projectToStage,
  reopenStage,
  syncDaysToNights,
} from "./stages.ts";
import { verifyItineraryStage } from "./stage-verifier.ts";
import type { ClientItinerary } from "./schema.ts";
import { upgradeToFideId } from "./schema.ts";
import type { PlacePolicyMap } from "./place-policy.ts";

const leiId = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";
const cairnsId = upgradeToFideId(
  "https://www.catalinaquest.ai/#place=cairns",
  "destination"
);
const pdId = upgradeToFideId(
  "https://www.catalinaquest.ai/#place=port-douglas",
  "destination"
);

/** Injected WM policies — mirrors graph, not hardcoded verifier lists. */
const testPolicies: PlacePolicyMap = new Map([
  [
    leiId,
    {
      fideId: leiId,
      placeName: "Lady Elliot Island",
      placeIri: "https://www.catalinaquest.ai/#place=lady-elliot-island",
      stayMinNights: 3,
      incompatibleOvernightFideIds: [],
      incompatibleOvernightIris: [],
      overnightRequiresBrief: false,
    },
  ],
  [
    cairnsId,
    {
      fideId: cairnsId,
      placeName: "Cairns",
      placeIri: "https://www.catalinaquest.ai/#place=cairns",
      incompatibleOvernightFideIds: [pdId],
      incompatibleOvernightIris: [
        "https://www.catalinaquest.ai/#place=port-douglas",
      ],
      overnightRequiresBrief: false,
    },
  ],
  [
    pdId,
    {
      fideId: pdId,
      placeName: "Port Douglas",
      placeIri: "https://www.catalinaquest.ai/#place=port-douglas",
      incompatibleOvernightFideIds: [cairnsId],
      incompatibleOvernightIris: [
        "https://www.catalinaquest.ai/#place=cairns",
      ],
      overnightRequiresBrief: false,
    },
  ],
]);

const sample: ClientItinerary = {
  title: "Test",
  summary: "",
  durationDays: 10,
  stops: [
    {
      placeId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
      placeName: "Sydney",
      nights: 3,
    },
    {
      placeId: leiId,
      placeName: "Lady Elliot Island",
      nights: 4,
    },
  ],
  days: [],
  workflow: { stage: "route", approved: {} },
};

describe("itinerary stages", () => {
  it("projects route without hotels/blocks", () => {
    const withHotel: ClientItinerary = {
      ...sample,
      stops: [
        {
          ...sample.stops[0],
          hotelId: "did:fide:0x112099ee71c0bbe3b30b275b32bbf65c900ef17a",
          hotelName: "Adina",
        },
        sample.stops[1],
      ],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Day",
          description: "",
          blocks: [
            {
              when: "morning",
              entityId: "did:fide:0x3120b1adca8b4d76b4a1616779887e8943b1c32e",
              entityName: "Sydney Opera House",
              entityKind: "attraction",
            },
          ],
        },
      ],
    };
    const route = projectToStage(withHotel, "route");
    assert.equal(route.stops[0].hotelId, undefined);
    assert.equal(route.days.every((d) => (d.blocks?.length ?? 0) === 0), true);
    assert.equal(ensureWorkflow(route).stage, "route");
  });

  it("approves route → stays", () => {
    const next = approveCurrentStage(sample);
    assert.equal(ensureWorkflow(next).stage, "stays");
    assert.ok(ensureWorkflow(next).approved.route);
    assert.equal(ensureWorkflow(next).approved.stays, undefined);
    assert.equal(ensureWorkflow(next).approved.days, undefined);
  });

  it("does not treat hotels+blocks as already complete when workflow is missing", () => {
    const filled: ClientItinerary = {
      ...sample,
      workflow: undefined,
      stops: [
        {
          ...sample.stops[0],
          hotelId: "did:fide:0x112099ee71c0bbe3b30b275b32bbf65c900ef17a",
          hotelName: "Adina",
        },
        sample.stops[1],
      ],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Day",
          description: "",
          blocks: [
            {
              when: "morning",
              entityId: "did:fide:0x3120b1adca8b4d76b4a1616779887e8943b1c32e",
              entityName: "Sydney Opera House",
              entityKind: "attraction",
            },
          ],
        },
      ],
    };
    assert.equal(ensureWorkflow(filled).stage, "route");
    const next = approveCurrentStage(filled);
    assert.equal(ensureWorkflow(next).stage, "stays");
  });

  it("reopens route and clears later approvals", () => {
    let cur = approveCurrentStage(sample);
    cur = approveCurrentStage(cur);
    assert.equal(ensureWorkflow(cur).stage, "days");
    cur = reopenStage(cur, "route");
    assert.equal(ensureWorkflow(cur).stage, "route");
    assert.equal(ensureWorkflow(cur).approved.stays, undefined);
  });

  it("verifies cairns+pd hard rule from world-model policy", () => {
    const bad: ClientItinerary = {
      ...sample,
      stops: [
        {
          placeId: cairnsId,
          placeName: "Cairns",
          nights: 4,
        },
        {
          placeId: pdId,
          placeName: "Port Douglas",
          nights: 4,
        },
      ],
    };
    const result = verifyItineraryStage(bad, "route", {
      placePolicies: testPolicies,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((e) => /incompatible-overnight|overnight bases/i.test(e)), true);
  });

  it("does not treat a Lady Elliot label as LEI without the place id", () => {
    const fake: ClientItinerary = {
      ...sample,
      stops: [
        {
          placeId: upgradeToFideId(
            "https://www.catalinaquest.ai/#place=sydney",
            "destination"
          ),
          placeName: "Lady Elliot Island",
          nights: 2,
        },
      ],
    };
    const result = verifyItineraryStage(fake, "route", {
      placePolicies: testPolicies,
    });
    assert.equal(result.errors.some((e) => /stay-min/i.test(e)), false);
  });

  it("verifies LEI min nights from world-model stay-min policy", () => {
    const short: ClientItinerary = {
      ...sample,
      stops: [{ ...sample.stops[1], nights: 2 }],
    };
    const result = verifyItineraryStage(short, "route", {
      placePolicies: testPolicies,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((e) => /stay-min/i.test(e)), true);
  });

  it("treats missing hotels as pending during stays, hard only on approve", () => {
    const stays: ClientItinerary = {
      ...sample,
      transfers: [],
      workflow: { stage: "stays", approved: { route: "x" } },
    };
    const display = verifyItineraryStage(stays, "stays", {
      placePolicies: testPolicies,
    });
    assert.equal(display.ok, true);
    assert.deepEqual(display.errors, []);
    assert.equal(display.warnings.some((w) => /Hotels still needed/i.test(w)), true);

    const gate = verifyItineraryStage(stays, "stays", {
      forApprove: true,
      placePolicies: testPolicies,
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.errors.some((e) => /Hotels still needed/i.test(e)), true);
  });

  it("adds a departure morning after the last night", () => {
    const stops = [
      { ...sample.stops[0], nights: 2, placeName: "Sydney" },
      { ...sample.stops[1], nights: 2, placeName: "Melbourne" },
    ];
    const days = syncDaysToNights(stops, []);
    assert.equal(calendarDayCount(stops), 5);
    assert.equal(days.length, 5);
    assert.deepEqual(days.map((d) => d.stopIndex), [0, 0, 1, 1, 1]);
    assert.equal(days[4]?.title, "Depart Melbourne");
    assert.equal(days[4]?.dayNumber, 5);
  });
});
