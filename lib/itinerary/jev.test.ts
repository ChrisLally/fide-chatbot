import { describe, expect, it } from "vitest";
import {
  assembleJevScores,
  evaluationState,
  lastItineraryArtifactId,
  lastUserTextFromMessages,
  rankingTargets,
} from "./jev.ts";
import { nightFitLabel } from "./jev-types.ts";
import type { ClientItinerary } from "./schema.ts";
import { graphStayBand } from "./schema.ts";

const sydney = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
const lei = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";

const sample: ClientItinerary = {
  title: "Test",
  summary: "",
  durationDays: 8,
  stops: [
    { placeId: sydney, placeName: "Sydney", nights: 4 },
    { placeId: lei, placeName: "Lady Elliot Island", nights: 3 },
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

describe("jev night and transport ranking", () => {
  it("uses graph stay band for LEI and not for Sydney", () => {
    expect(graphStayBand(lei)).toEqual({ min: 3, rec: 3, max: 5 });
    expect(graphStayBand(sydney)).toEqual({});
  });

  it("builds ranking targets from nights JSON and transfer slots", () => {
    const targets = rankingTargets(sample);
    expect(targets.nightsSum).toBe(7);
    expect(targets.stops[0]?.graphBandKnown).toBe(false);
    expect(targets.stops[1]?.graphBandKnown).toBe(true);
    expect(targets.stops[1]?.isIsland).toBe(true);
    expect(targets.legs[0]?.involvesLei).toBe(true);
    expect(targets.legs[0]?.carDisallowed).toBe(true);
    expect(targets.legs.some((leg) => leg.toLabel.includes("Elliot") || leg.toLabel.includes("Lady"))).toBe(
      true
    );
  });

  it("strips undefined fields so Gateway accepts state", () => {
    const targets = rankingTargets(sample);
    const state = evaluationState({
      brief: "",
      title: sample.title,
      nightsSum: targets.nightsSum,
      durationDays: sample.durationDays,
      stops: targets.stops,
      legs: targets.legs,
    });
    expect(JSON.stringify(state).includes("undefined")).toBe(false);
    expect("stayMin" in (state.stops[0] as object)).toBe(false);
    expect("stayMin" in (state.stops[1] as object)).toBe(true);
  });

  it("does not invent poor-fit scores when ranking fails", () => {
    const scores = assembleJevScores({
      itinerary: sample,
      answers: null,
      typesafeConfidence: null,
      error: "must be a JSON-compatible string, object, or array",
    });
    expect(scores.nights).toEqual([]);
    expect(scores.legs).toEqual([]);
    expect(scores.error).toMatch(/JSON-compatible/);
  });

  it("assembles scores from Jev answers without changing nights", () => {
    const scores = assembleJevScores({
      itinerary: sample,
      answers: {
        nights_0: { type: "score", score: 3.1 },
        nights_1: { type: "score", score: 4 },
        leg_0: {
          type: "choice",
          choice: "flight",
          probabilities: {
            flight: 0.9,
            car: 0.05,
            bus: 0,
            train: 0,
            ferry: 0,
            uncertain: 0.05,
          },
        },
      },
      typesafeConfidence: { nights_0: 0.8 },
    });
    expect(sample.stops[0].nights).toBe(4);
    expect(scores.nights[0]?.score).toBe(3.1);
    expect(nightFitLabel(2.53)).not.toMatch(/graph rec/i);
    expect(nightFitLabel(2.53)).toMatch(/no stay-band implied/);
    expect(scores.legs[0]?.recommended).toBe("flight");
    expect(scores.verifierOk).toBe(true);
  });

  it("round-trips rankings on the itinerary JSON", async () => {
    const { itineraryWithRankings } = await import("./jev.ts");
    const { parseClientItinerary, serializeClientItinerary } = await import(
      "./schema.ts"
    );
    const scores = assembleJevScores({
      itinerary: sample,
      answers: { nights_0: { type: "score", score: 2 } },
      typesafeConfidence: null,
    });
    const raw = serializeClientItinerary(itineraryWithRankings(sample, scores));
    const parsed = parseClientItinerary(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.rankings?.nights?.[0]?.score).toBe(2);
    }
  });

  it("marks long car legs as disallowed before Jev chooses", () => {
    const longCar: ClientItinerary = {
      ...sample,
      transfers: [
        {
          fromStopIndex: 0,
          toStopIndex: 1,
          mode: "car",
          durationHours: 8,
        },
      ],
    };
    const targets = rankingTargets(longCar);
    expect(targets.legs.some((leg) => leg.carDisallowed)).toBe(true);
  });

  it("extracts last user text and itinerary artifact id", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "hello" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool-createDocument",
            output: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", kind: "itinerary" },
          },
        ],
      },
      { role: "user", parts: [{ type: "text", text: "add a night" }] },
    ];
    expect(lastUserTextFromMessages(messages)).toBe("add a night");
    expect(lastItineraryArtifactId(messages)).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    );
  });
});
