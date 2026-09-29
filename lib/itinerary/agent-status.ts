import type { ClientItinerary } from "./schema";
import type { PlacePolicyMap } from "./place-policy";
import { ensureWorkflow, STAGE_LABELS, type ItineraryStage } from "./stages";
import { verifyItineraryStage } from "./stage-verifier";

export type ItineraryToolStatus = {
  stage: ItineraryStage;
  stageLabel: string;
  /** Same gate as the UI Approve button (`forApprove: true`). */
  approveButtonClickable: boolean;
  errors: string[];
  warnings: string[];
  nightsTotal: number;
  durationDays: number;
  stops: Array<{
    stopIndex: number;
    placeName: string;
    nights: number;
    hotelName?: string;
  }>;
  /** What Taylor should do next given stage + approve gate. */
  nextAction: string;
};

function nextActionFor(
  stage: ItineraryStage,
  approveClickable: boolean,
  errors: string[]
): string {
  if (errors.length > 0 || !approveClickable) {
    if (stage === "route") {
      return "Approve Route is NOT clickable. Fix the errors (stay min/max, incompatible overnights, etc.) with patchItinerary / a corrected createDocument, then re-check status. Do not ask the human to Approve yet.";
    }
    if (stage === "stays") {
      return "Approve Stays is NOT clickable. Finish required hotels (and clear any hard errors) with patchItinerary proposeStay/setStopHotel, then re-check status. Do not ask the human to Approve yet.";
    }
    if (stage === "days") {
      return "Approve Days is NOT clickable. Add day blocks (and clear hard errors) with patchItinerary proposeDay, then re-check status. Do not ask the human to Approve yet.";
    }
    return "Approve is NOT clickable. Fix the listed errors before stopping.";
  }
  if (stage === "route") {
    return "Approve Route IS clickable. STOP and wait for the human to click Approve Route. Do not add hotels or days.";
  }
  if (stage === "stays") {
    return "Approve Stays IS clickable. STOP and wait for the human to click Approve Stays. Do not add day activities yet.";
  }
  if (stage === "days") {
    return "Approve Days IS clickable. STOP and wait for the human to click Approve Days.";
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

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    approveButtonClickable: gate.ok,
    errors: gate.errors.length > 0 ? gate.errors : display.errors,
    warnings: display.warnings,
    nightsTotal,
    durationDays: itinerary.durationDays,
    stops: itinerary.stops.map((stop, stopIndex) => ({
      stopIndex,
      placeName: stop.placeName,
      nights: stop.nights,
      hotelName: stop.hotelName,
    })),
    nextAction: nextActionFor(stage, gate.ok, gate.errors),
  };
}
