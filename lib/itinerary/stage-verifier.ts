import type { ClientItinerary } from "./schema";
import { ensureWorkflow, type ItineraryStage } from "./stages";

const CAIRNS = /\bcairns\b/i;
const PORT_DOUGLAS = /\bport\s*douglas\b/i;
const TOWNSVILLE = /\btownsville\b/i;
const MAGNETIC = /\bmagnetic\s*island\b/i;
const LADY_ELLIOT = /\blady\s*elliot\b/i;
const CERT = /\b(certif|refresher|open\s*water\s*course|learn\s*to\s*dive)\b/i;

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

function placeNames(itinerary: ClientItinerary): string[] {
  return itinerary.stops.map((s) => s.placeName);
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
  if (itinerary.durationDays < nightsSum) {
    warnings.push(
      `durationDays (${itinerary.durationDays}) is less than sum of nights (${nightsSum}).`
    );
  }

  for (const day of itinerary.days) {
    if (day.stopIndex < 0 || day.stopIndex >= itinerary.stops.length) {
      errors.push(`Day ${day.dayNumber} has invalid stopIndex ${day.stopIndex}.`);
    }
  }

  const names = placeNames(itinerary);
  const hasCairns = names.some((n) => CAIRNS.test(n));
  const hasPd = names.some((n) => PORT_DOUGLAS.test(n));
  if (hasCairns && hasPd) {
    errors.push(
      "Hard rule: do not use both Cairns and Port Douglas as overnight bases — pick one gateway."
    );
  }
  if (names.some((n) => TOWNSVILLE.test(n) || MAGNETIC.test(n))) {
    errors.push(
      "Townsville / Magnetic Island are not standard first-timer sells unless the brief named them."
    );
  }

  for (const stop of itinerary.stops) {
    if (LADY_ELLIOT.test(stop.placeName) && stop.nights < 3) {
      errors.push(
        `Lady Elliot Island needs at least 3 nights (graph stay-min); currently ${stop.nights}.`
      );
    }
  }

  if (stage === "stays" || stage === "days" || stage === "complete") {
    const missingHotels = itinerary.stops.filter((s) => !s.hotelId || !s.hotelName);
    if (missingHotels.length > 0) {
      const nonLei = missingHotels.filter((s) => !LADY_ELLIOT.test(s.placeName));
      if (nonLei.length > 0) {
        const message = `Hotels still needed on: ${nonLei.map((s) => s.placeName).join(", ")}.`;
        // During stays work, missing hotels are expected until Taylor fills them.
        // Only fail hard when approving stays, or once past stays.
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
    for (const day of itinerary.days) {
      for (const block of day.blocks ?? []) {
        if (CERT.test(`${block.entityName} ${block.title ?? ""} ${block.note ?? ""}`)) {
          errors.push(
            `Day ${day.dayNumber} looks like a dive-cert upsell ("${block.entityName}") — remove if clients are already certified.`
          );
        }
      }
    }
  }

  for (const day of itinerary.days) {
    if (day.transitNote && /7\s*-\s*8\s*hour|7–8\s*hour|all[\s-]*day\s*drive/i.test(day.transitNote)) {
      errors.push(
        `Day ${day.dayNumber} transitNote suggests an endurance drive — use a flight or shorten.`
      );
    }
  }

  for (const transfer of itinerary.transfers ?? []) {
    const mode = transfer.mode ?? "";
    const hours = transfer.durationHours;
    if (
      hours != null &&
      hours > 3.5 &&
      /drive|car|self[-\s]?drive|road/i.test(mode)
    ) {
      errors.push(
        `Transfer ${transfer.fromPlaceName ?? transfer.fromStopIndex} → ${transfer.toPlaceName ?? transfer.toStopIndex}: ${hours}h drive exceeds 3.5h — use a flight or different corridor.`
      );
    }
    if (/7\s*-\s*8\s*hour|7–8\s*hour|all[\s-]*day\s*drive/i.test(transfer.note ?? "")) {
      errors.push(
        `Transfer note suggests an endurance drive (${transfer.label || "leg"}).`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
