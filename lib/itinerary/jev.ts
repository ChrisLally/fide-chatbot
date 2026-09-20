import { experimental_evaluate as evaluate } from "ai";
import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";
import type { ClientItinerary } from "./schema";
import { graphStayBand, matchesCatalinaPlaceSlug } from "./schema";
import { ensureWorkflow } from "./stages";
import { verifyItineraryStage } from "./stage-verifier";
import { transferSlots } from "./transfers";
import {
  NIGHT_FIT_CRITERIA,
  TRANSPORT_MODE_CRITERIA,
  nightFitLabel,
  type JevLegRow,
  type JevNightRow,
  type JevScores,
  type JevTransportMode,
} from "./jev-types";

export type { JevScores, JevNightRow, JevLegRow } from "./jev-types";

export function isJevRankingEnabled(): boolean {
  const flag = process.env.JEV_EVALUATE?.trim().toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false") {
    return false;
  }
  return true;
}

export function lastUserTextFromParts(
  parts: Array<{ type?: string; text?: string }> | undefined
): string {
  if (!parts?.length) {
    return "";
  }
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

export function lastUserTextFromMessages(
  messages: Array<{
    role?: string;
    parts?: Array<{ type?: string; text?: string }>;
  }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      const text = lastUserTextFromParts(messages[i].parts);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Latest createDocument / patchItinerary artifact id from tool parts. */
export function lastItineraryArtifactId(
  messages: Array<{ parts?: unknown[] }>
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i]?.parts ?? []) {
      const record = asRecord(part);
      if (!record) {
        continue;
      }
      const type = String(record.type ?? "");
      const toolName = String(record.toolName ?? record.tool ?? "");
      const output = asRecord(record.output) ?? asRecord(record.result);
      if (!output) {
        continue;
      }
      const id = output.id;
      if (typeof id !== "string" || id.length < 8) {
        continue;
      }
      const kind = output.kind;
      if (
        kind === "itinerary" ||
        type.includes("createDocument") ||
        type.includes("patchItinerary") ||
        toolName === "createDocument" ||
        toolName === "patchItinerary"
      ) {
        return id;
      }
    }
  }
  return undefined;
}

function isCarTransportMode(mode: string | undefined): boolean {
  if (!mode?.trim()) {
    return false;
  }
  const value = mode.trim().toLowerCase();
  return (
    value === "car" ||
    value.endsWith("#transport-mode=car") ||
    value.endsWith("transport-mode=car")
  );
}

const ISLAND_PLACE_SLUGS = [
  "lady-elliot-island",
  "hamilton-island",
  "whitsunday-islands",
  "magnetic-island",
  "fraser-island",
  "moreton-island",
] as const;

function isIslandPlace(placeId: string | undefined): boolean {
  if (!placeId) {
    return false;
  }
  return ISLAND_PLACE_SLUGS.some((slug) =>
    matchesCatalinaPlaceSlug(placeId, slug)
  );
}

function isLeiPlace(placeId: string | undefined): boolean {
  return matchesCatalinaPlaceSlug(placeId, "lady-elliot-island");
}
const MAX_RANKED_STOPS = 10;
const CAR_MAX_HOURS = 3.5;
const JEV_TIMEOUT_MS = 8000;

export type RankedStop = {
  stopIndex: number;
  placeId: string;
  placeName: string;
  nights: number;
  stayMin?: number;
  stayRec?: number;
  stayMax?: number;
  graphBandKnown: boolean;
  isIsland: boolean;
};

export type RankedLeg = {
  key: string;
  fromLabel: string;
  toLabel: string;
  chosenMode?: string;
  durationHours?: number;
  carDisallowed: boolean;
  involvesIsland: boolean;
  involvesLei: boolean;
};

export function rankingTargets(itinerary: ClientItinerary): {
  nightsSum: number;
  stops: RankedStop[];
  legs: RankedLeg[];
} {
  const nightsSum = itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0);
  const stops: RankedStop[] = itinerary.stops
    .slice(0, MAX_RANKED_STOPS)
    .map((stop, stopIndex) => {
      const band = graphStayBand(stop.placeId);
      const graphBandKnown =
        band.min != null || band.rec != null || band.max != null;
      return {
        stopIndex,
        placeId: stop.placeId,
        placeName: stop.placeName,
        nights: stop.nights,
        stayMin: band.min,
        stayRec: band.rec,
        stayMax: band.max,
        graphBandKnown,
        isIsland: isIslandPlace(stop.placeId),
      };
    });

  const legs: RankedLeg[] = transferSlots(itinerary)
    .filter((slot) => slot.kind === "between")
    .slice(0, MAX_RANKED_STOPS)
    .map((slot) => {
      const hours = slot.transfer?.durationHours;
      const mode = slot.transfer?.mode?.trim();
      const involvesLei =
        isLeiPlace(slot.fromPlaceId) || isLeiPlace(slot.toPlaceId);
      const involvesIsland =
        involvesLei ||
        isIslandPlace(slot.fromPlaceId) ||
        isIslandPlace(slot.toPlaceId);
      const carDisallowed =
        involvesIsland ||
        (hours != null && hours > CAR_MAX_HOURS && isCarTransportMode(mode));
      return {
        key: slot.key,
        fromLabel: slot.transfer?.fromPlaceName?.trim() || slot.fromLabel,
        toLabel: slot.transfer?.toPlaceName?.trim() || slot.toLabel,
        chosenMode: mode,
        durationHours: hours,
        carDisallowed,
        involvesIsland,
        involvesLei,
      };
    });

  return { nightsSum, stops, legs };
}

function jsonCompatible<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Gateway evaluate() rejects objects that contain `undefined`. */
export function evaluationState(input: {
  brief: string;
  title: string;
  nightsSum: number;
  durationDays: number | null;
  stops: RankedStop[];
  legs: RankedLeg[];
}) {
  return jsonCompatible({
    brief: input.brief,
    title: input.title,
    nightsSum: input.nightsSum,
    durationDays: input.durationDays,
    stops: input.stops,
    legs: input.legs,
  });
}

function typesafeConfidence(metadata: unknown): unknown {
  const record = asRecord(metadata);
  const typesafe = asRecord(record?.typesafe);
  return typesafe?.confidence ?? null;
}

function scoreAnswer(answer: unknown): { score: number; probabilities?: Record<string, number> } {
  const record = asRecord(answer);
  const score = typeof record?.score === "number" ? record.score : 0;
  const probabilities =
    record?.probabilities && typeof record.probabilities === "object"
      ? (record.probabilities as Record<string, number>)
      : undefined;
  return { score, probabilities };
}

function choiceAnswer(answer: unknown): {
  choice: string;
  probabilities: Record<string, number>;
} {
  const record = asRecord(answer);
  const choice = typeof record?.choice === "string" ? record.choice : "uncertain";
  const probabilities =
    record?.probabilities && typeof record.probabilities === "object"
      ? (record.probabilities as Record<string, number>)
      : {};
  return { choice, probabilities };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("jev_timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function assembleJevScores(input: {
  itinerary: ClientItinerary;
  answers: Record<string, unknown> | null;
  typesafeConfidence: unknown;
  error?: string;
}): JevScores {
  const stage = ensureWorkflow(input.itinerary).stage;
  const verified = verifyItineraryStage(input.itinerary, stage);
  const targets = rankingTargets(input.itinerary);
  const answers = input.answers ?? {};

  if (input.error || input.answers == null) {
    return {
      evaluatedAt: new Date().toISOString(),
      nightsSum: targets.nightsSum,
      durationDays: input.itinerary.durationDays,
      verifierOk: verified.ok,
      verifierErrors: verified.errors,
      nights: [],
      legs: [],
      typesafeConfidence: input.typesafeConfidence,
      error: input.error,
    };
  }

  const nights: JevNightRow[] = targets.stops.map((stop) => {
    const parsed = scoreAnswer(answers[`nights_${stop.stopIndex}`]);
    return {
      ...stop,
      score: parsed.score,
      label: nightFitLabel(parsed.score),
      probabilities: parsed.probabilities,
    };
  });

  const legs: JevLegRow[] = targets.legs.map((leg, index) => {
    const parsed = choiceAnswer(answers[`leg_${index}`]);
    return {
      ...leg,
      recommended: parsed.choice as JevTransportMode,
      probabilities: parsed.probabilities,
    };
  });

  return {
    evaluatedAt: new Date().toISOString(),
    nightsSum: targets.nightsSum,
    durationDays: input.itinerary.durationDays,
    verifierOk: verified.ok,
    verifierErrors: verified.errors,
    nights,
    legs,
    typesafeConfidence: input.typesafeConfidence,
    error: input.error,
  };
}

/**
 * Rank night split and transport modes. Does not patch the itinerary.
 */
export async function evaluateJevRankings(input: {
  lastUserText: string;
  itinerary: ClientItinerary;
}): Promise<JevScores> {
  const targets = rankingTargets(input.itinerary);
  const brief = input.lastUserText.slice(0, 4000) || input.itinerary.summary || "";

  const questions: Record<
    string,
    | {
        type: "score";
        instructions: string;
        criteria: string[];
      }
    | {
        type: "choice";
        instructions: string;
        criteria: Record<string, string>;
      }
  > = {};

  for (const stop of targets.stops) {
    const bandLine = stop.graphBandKnown
      ? `Graph stay band is known: min=${stop.stayMin ?? "n/a"}, rec=${stop.stayRec ?? "n/a"}, max=${stop.stayMax ?? "n/a"}. Score 4 only if nights sit on that band.`
      : `No graph stay-min/rec/max for this place. Do not pretend there is a recommended night count. A 2-night gateway hop (e.g. Brisbane) can still be 2–3. Score 4 is not available without a band unless the brief locked this exact length.`;
    questions[`nights_${stop.stopIndex}`] = {
      type: "score",
      instructions: `Catalina first-timer overnight at ${stop.placeName}: ${stop.nights} night(s). Trip nights sum=${targets.nightsSum}. Island=${stop.isIsland}. Stay-min, if any, is already enforced in code — you are scoring pacing, not legality. ${bandLine}`,
      criteria: [...NIGHT_FIT_CRITERIA],
    };
  }

  for (const [index, leg] of targets.legs.entries()) {
    const constraints = [
      `JSON chosen mode: ${leg.chosenMode ?? "none"} (if none, pick the mode Catalina would write on the card).`,
      `Hours: ${leg.durationHours ?? "unknown"}.`,
      leg.involvesLei
        ? "Lady Elliot Island is aircraft-only. Pick flight. Do not pick car, bus, train, or ferry."
        : "",
      leg.involvesIsland && !leg.involvesLei
        ? "An island overnight is involved. Do not pick car. Prefer flight unless a single ferry sector is the real Catalina product. Bus and train are mainland only."
        : "",
      leg.carDisallowed ? "Car is forbidden on this leg." : "",
      "Pick uncertain only when this cannot be one booked sector (true multi-hop via a hub with no single mode). Uncertain is not a booking.",
    ]
      .filter(Boolean)
      .join(" ");
    questions[`leg_${index}`] = {
      type: "choice",
      instructions: `Which single transport mode should Catalina put on ${leg.fromLabel} → ${leg.toLabel}? ${constraints}`,
      criteria: { ...TRANSPORT_MODE_CRITERIA },
    };
  }

  if (Object.keys(questions).length === 0) {
    return assembleJevScores({
      itinerary: input.itinerary,
      answers: {},
      typesafeConfidence: null,
    });
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return assembleJevScores({
      itinerary: input.itinerary,
      answers: null,
      typesafeConfidence: null,
      error: "AI_GATEWAY_API_KEY is unset",
    });
  }

  try {
    const result = await withTimeout(
      evaluate({
        model: "typesafe-ai/jev",
        state: evaluationState({
          brief,
          title: input.itinerary.title,
          nightsSum: targets.nightsSum,
          durationDays: input.itinerary.durationDays,
          stops: targets.stops,
          legs: targets.legs,
        }),
        questions,
        providerOptions:
          process.env.JEV_ZDR === "1"
            ? { gateway: { zeroDataRetention: true } }
            : undefined,
      }),
      JEV_TIMEOUT_MS
    );

    const scores = assembleJevScores({
      itinerary: input.itinerary,
      answers: result.answers as Record<string, unknown>,
      typesafeConfidence: typesafeConfidence(result.providerMetadata),
    });
    return scores;
  } catch (error) {
    return assembleJevScores({
      itinerary: input.itinerary,
      answers: null,
      typesafeConfidence: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function itineraryWithRankings(
  itinerary: ClientItinerary,
  scores: JevScores
): ClientItinerary {
  return { ...itinerary, rankings: scores };
}

export async function publishJevScores(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  itinerary: ClientItinerary | null,
  lastUserText: string
): Promise<JevScores | null> {
  if (!isJevRankingEnabled() || !itinerary) {
    return null;
  }
  const scores = await evaluateJevRankings({ itinerary, lastUserText });
  dataStream.write({
    type: "data-jevScores",
    data: scores,
    transient: true,
  });
  return scores;
}
