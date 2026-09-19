import { describe, expect, it } from "vitest";
import {
  approveCurrentStage,
  ensureWorkflow,
  projectToStage,
  reopenStage,
} from "./stages.ts";
import { verifyItineraryStage } from "./stage-verifier.ts";
import type { ClientItinerary } from "./schema.ts";

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
      placeId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
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
    expect(route.stops[0].hotelId).toBeUndefined();
    expect(route.days.every((d) => (d.blocks?.length ?? 0) === 0)).toBe(true);
    expect(ensureWorkflow(route).stage).toBe("route");
  });

  it("approves route → stays", () => {
    const next = approveCurrentStage(sample);
    expect(ensureWorkflow(next).stage).toBe("stays");
    expect(ensureWorkflow(next).approved.route).toBeTruthy();
  });

  it("reopens route and clears later approvals", () => {
    let cur = approveCurrentStage(sample);
    cur = approveCurrentStage(cur);
    expect(ensureWorkflow(cur).stage).toBe("days");
    cur = reopenStage(cur, "route");
    expect(ensureWorkflow(cur).stage).toBe("route");
    expect(ensureWorkflow(cur).approved.stays).toBeUndefined();
  });

  it("verifies cairns+pd hard rule", () => {
    const bad: ClientItinerary = {
      ...sample,
      stops: [
        {
          placeId: "did:fide:0x4020000000000000000000000000000000000001",
          placeName: "Cairns",
          nights: 4,
        },
        {
          placeId: "did:fide:0x4020000000000000000000000000000000000002",
          placeName: "Port Douglas",
          nights: 4,
        },
      ],
    };
    const result = verifyItineraryStage(bad, "route");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Cairns and Port Douglas/i.test(e))).toBe(
      true
    );
  });

  it("verifies LEI min nights", () => {
    const short: ClientItinerary = {
      ...sample,
      stops: [{ ...sample.stops[1], nights: 2 }],
    };
    const result = verifyItineraryStage(short, "route");
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Lady Elliot/i.test(e))).toBe(true);
  });

  it("treats missing hotels as pending during stays, hard only on approve", () => {
    const stays: ClientItinerary = {
      ...sample,
      transfers: [],
      workflow: { stage: "stays", approved: { route: "x" } },
    };
    const display = verifyItineraryStage(stays, "stays");
    expect(display.ok).toBe(true);
    expect(display.errors).toEqual([]);
    expect(display.warnings.some((w) => /Hotels still needed/i.test(w))).toBe(
      true
    );

    const gate = verifyItineraryStage(stays, "stays", { forApprove: true });
    expect(gate.ok).toBe(false);
    expect(gate.errors.some((e) => /Hotels still needed/i.test(e))).toBe(true);
  });
});
