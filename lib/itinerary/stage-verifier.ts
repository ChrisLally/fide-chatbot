import type { ClientItinerary } from "./schema";
import {
  graphStayMinNights,
  matchesCatalinaPlaceSlug,
} from "./schema";
import { ensureWorkflow, type ItineraryStage } from "./stages";

export type StageVerifyResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type StageVerifyOptions = {
  /**
   * When true, incomplete stage work (hotels / day blocks) is a hard error so
   * Approve can gate. When false (default UI), those are warnings — expected
   * right after advancing into stays/days before Taylor populates them.
   */
  forApprove?: boolean;
};

function hasPlace(itinerary: ClientItinerary, slug: string): boolean {
  return itinerary.stops.some((stop) =>
    matchesCatalinaPlaceSlug(stop.placeId, slug)
  );
}

function isLeiStop(placeId: string | undefined): boolean {
  return matchesCatalinaPlaceSlug(placeId, "lady-elliot-island");
}

/** Graph `#transport-mode=car` — not a scan of free-text "drive" copy. */
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

/** Deterministic must-pass checks for the active stage (no LLM). */
export function verifyItineraryStage(
  itinerary: ClientItinerary,
  stage: ItineraryStage = ensureWorkflow(itinerary).stage,
  options: StageVerifyOptions = {}
): StageVerifyResult {
  const { forApprove = false } = options;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (itinerary.stops.length === 0) {
    errors.push("Need at least one overnight stop.");
  }

  const nightsSum = itinerary.stops.reduce((sum, s) => sum + s.nights, 0);
  if (nightsSum < 1) {
    errors.push("Total nights must be at least 1.");
  }
  if (itinerary.durationDays < nightsSum + 1) {
    warnings.push(
      `durationDays (${itinerary.durationDays}) should be nights (${nightsSum}) plus a departure morning.`
    );
  }

  for (const day of itinerary.days) {
    if (day.stopIndex < 0 || day.stopIndex >= itinerary.stops.length) {
      errors.push(`Day ${day.dayNumber} has invalid stopIndex ${day.stopIndex}.`);
    }
  }

  if (hasPlace(itinerary, "cairns") && hasPlace(itinerary, "port-douglas")) {
    errors.push(
      "Hard rule: do not use both Cairns and Port Douglas as overnight bases — pick one gateway."
    );
  }
  if (
    hasPlace(itinerary, "townsville") ||
    hasPlace(itinerary, "magnetic-island")
  ) {
    errors.push(
      "Townsville / Magnetic Island are not standard first-timer sells unless the brief named them."
    );
  }

  for (const stop of itinerary.stops) {
    const min = graphStayMinNights(stop.placeId);
    if (min != null && stop.nights < min) {
      errors.push(
        `${stop.placeName} needs at least ${min} nights (graph stay-min); currently ${stop.nights}.`
      );
    }
  }

  if (stage === "stays" || stage === "days" || stage === "complete") {
    const missingHotels = itinerary.stops.filter((s) => !s.hotelId || !s.hotelName);
    if (missingHotels.length > 0) {
      const nonLei = missingHotels.filter((s) => !isLeiStop(s.placeId));
      if (nonLei.length > 0) {
        const message = `Hotels still needed on: ${nonLei.map((s) => s.placeName).join(", ")}.`;
        if (forApprove || stage === "days" || stage === "complete") {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      } else {
        warnings.push("Lady Elliot stop has no separate hotel row (resort stay may be OK).");
      }
    }
  }

  if (stage === "days" || stage === "complete") {
    const withBlocks = itinerary.days.filter((d) => (d.blocks?.length ?? 0) > 0);
    if (withBlocks.length === 0) {
      const message = "Day blocks still needed — ask Taylor to fill the days stage.";
      if (forApprove || stage === "complete") {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  for (const transfer of itinerary.transfers ?? []) {
    const hours = transfer.durationHours;
    if (hours != null && hours > 3.5 && isCarTransportMode(transfer.mode)) {
      errors.push(
        `Transfer ${transfer.fromPlaceName ?? transfer.fromStopIndex} → ${transfer.toPlaceName ?? transfer.toStopIndex}: ${hours}h car exceeds 3.5h — use a flight or different corridor.`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
