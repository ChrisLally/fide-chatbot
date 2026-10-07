import type { ClientItinerary } from "./schema";
import type { PlacePolicyMap } from "./place-policy";
import { ensureWorkflow, STAGE_LABELS, type ItineraryStage } from "./stages";
import { verifyItineraryStage } from "./stage-verifier";

/** Machine-readable fix hint for the agent. */
export type ItineraryStatusFix = {
  code: string;
  message: string;
  stopId?: string;
  dayId?: string;
  suggested?: Record<string, unknown>;
};

export type ItineraryToolStatus = {
  stage: ItineraryStage;
  stageLabel: string;
  /** Same gate as the UI Approve button (`forApprove: true`). */
  approveButtonClickable: boolean;
  errors: string[];
  warnings: string[];
  /** Machine-readable fixes derived from verifier errors. */
  fixes: ItineraryStatusFix[];
  nightsTotal: number;
  durationDays: number;
  stops: Array<{
    stopId?: string;
    stopIndex: number;
    placeName: string;
    nights: number;
    hotelName?: string;
  }>;
  days: Array<{
    dayId?: string;
    dayNumber: number;
    stopId?: string;
    title: string;
    stale?: boolean;
  }>;
  /** What Taylor should do next given stage + approve gate. */
  nextAction: string;
};

const STAY_MIN_RE = /stay-min/i;
const STAY_MAX_RE = /stay-max/i;
const HOTEL_RE = /Hotels still needed/i;
const INCOMPAT_RE = /incompatible-overnight|overnight bases/i;

function fixesFromErrors(
  itinerary: ClientItinerary,
  errors: string[]
): ItineraryStatusFix[] {
  const fixes: ItineraryStatusFix[] = [];
  for (const error of errors) {
    if (STAY_MIN_RE.test(error)) {
      const stop = itinerary.stops.find((s) =>
        error.toLowerCase().includes(s.placeName.toLowerCase())
      );
      fixes.push({
        code: "STAY_BELOW_MIN",
        message: error,
        stopId: stop?.stopId,
        suggested: stop ? { nights: stop.nights + 1 } : undefined,
      });
      continue;
    }
    if (STAY_MAX_RE.test(error)) {
      const stop = itinerary.stops.find((s) =>
        error.toLowerCase().includes(s.placeName.toLowerCase())
      );
      fixes.push({
        code: "STAY_ABOVE_MAX",
        message: error,
        stopId: stop?.stopId,
      });
      continue;
    }
    if (HOTEL_RE.test(error)) {
      fixes.push({ code: "HOTELS_REQUIRED", message: error });
      continue;
    }
    if (INCOMPAT_RE.test(error)) {
      fixes.push({ code: "INCOMPATIBLE_OVERNIGHTS", message: error });
      continue;
    }
    fixes.push({ code: "VERIFIER_ERROR", message: error });
  }
  return fixes;
}

function nextActionFor(
  stage: ItineraryStage,
  approveClickable: boolean,
  errors: string[]
): string {
  if (errors.length > 0 || !approveClickable) {
    if (stage === "stops") {
      return "Approve Stops is NOT clickable. Fix the errors (stay min/max, incompatible overnights, etc.) with patchItinerary / a corrected createDocument, then re-check status. Do not ask the human to Approve yet.";
    }
    if (stage === "stays") {
      return "Approve Stays is NOT clickable. Finish required hotels (and clear any hard errors) with patchItinerary setStopHotel, then re-check status. Do not ask the human to Approve yet.";
    }
    if (stage === "days") {
      return "Approve Days is NOT clickable. Add day blocks (and clear hard errors) with patchItinerary setDayBlocks, then re-check status. Do not ask the human to Approve yet.";
    }
    return "Approve is NOT clickable. Fix the listed errors before stopping.";
  }
  if (stage === "stops") {
    return "Approve Stops IS clickable. Your turn is DONE. Tell the human the overnight spine is ready and ask them to click Approve Stops. Do not call hotels-by-city, setStopHotel, or setDayBlocks until after that click — even if they asked for hotels and days in the same message.";
  }
  if (stage === "stays") {
    return "Approve Stays IS clickable (or will soft-auto-advance when hotels are complete). Prefer finishing hotels via setStopHotel; do not add day activities until days stage.";
  }
  if (stage === "days") {
    return "Approve Days IS clickable (or will soft-auto-advance when day blocks are complete).";
  }
  return "Itinerary stage is complete.";
}

/**
 * Snapshot the agent should read after createDocument / patchItinerary —
 * full spine + stage + whether the UI Approve button is enabled.
 */
export function buildItineraryToolStatus(
  itinerary: ClientItinerary,
  placePolicies?: PlacePolicyMap
): ItineraryToolStatus {
  const workflow = ensureWorkflow(itinerary);
  const stage = workflow.stage;
  const display = verifyItineraryStage(itinerary, stage, { placePolicies });
  const gate = verifyItineraryStage(itinerary, stage, {
    forApprove: true,
    placePolicies,
  });
  const nightsTotal = itinerary.stops.reduce(
    (sum, stop) => sum + stop.nights,
    0
  );
  const errors = gate.errors.length > 0 ? gate.errors : display.errors;

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    approveButtonClickable: gate.ok,
    errors,
    warnings: display.warnings,
    fixes: fixesFromErrors(itinerary, errors),
    nightsTotal,
    durationDays: itinerary.durationDays,
    stops: itinerary.stops.map((stop, stopIndex) => ({
      stopId: stop.stopId,
      stopIndex,
      placeName: stop.placeName,
      nights: stop.nights,
      hotelName: stop.hotelName,
    })),
    days: itinerary.days.map((day) => ({
      dayId: day.dayId,
      dayNumber: day.dayNumber,
      stopId: day.stopId,
      title: day.title,
      ...(day.stale ? { stale: true } : {}),
    })),
    nextAction: nextActionFor(stage, gate.ok, gate.errors),
  };
}
