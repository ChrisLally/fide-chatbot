import type { ClientItinerary } from "./schema";
import {
  matchesCatalinaPlaceSlug,
  normalizeDid,
} from "./schema";
import { ensureWorkflow, type ItineraryStage } from "./stages";
import {
  policyForStop,
  type PlacePolicyMap,
} from "./place-policy";

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
  /**
   * Live (or test-injected) place policy from the world model.
   * Stay min/max, incompatible overnights, and overnight-requires-brief come from here —
   * not from hardcoded Catalina place lists. Recommended is preferred at allocate-time.
   */
  placePolicies?: PlacePolicyMap;
};

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

function stopMatchesIncompatible(
  otherPlaceId: string,
  otherPlaceName: string,
  policy: NonNullable<ReturnType<typeof policyForStop>>
): boolean {
  const otherDid = normalizeDid(otherPlaceId);
  if (
    policy.incompatibleOvernightFideIds.some(
      (id) => normalizeDid(id) === otherDid
    )
  ) {
    return true;
  }
  const otherIri = otherPlaceId.includes("#place=")
    ? otherPlaceId
    : undefined;
  if (
    otherIri &&
    policy.incompatibleOvernightIris.some((iri) => iri === otherIri)
  ) {
    return true;
  }
  // IRI fingerprint match via slug in incompatible iris
  return policy.incompatibleOvernightIris.some((iri) => {
    const slug = iri.split("#place=")[1];
    return slug
      ? matchesCatalinaPlaceSlug(otherPlaceId, slug) ||
          otherPlaceName.toLowerCase().includes(slug.replace(/-/g, " "))
      : false;
  });
}

/** Deterministic must-pass checks for the active stage (no LLM). */
export function verifyItineraryStage(
  itinerary: ClientItinerary,
  stage: ItineraryStage = ensureWorkflow(itinerary).stage,
  options: StageVerifyOptions = {}
): StageVerifyResult {
  const { forApprove = false, placePolicies } = options;
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

  // World-model overnight policy (incompatible pairs, brief-gated sells, stay band).
  for (let i = 0; i < itinerary.stops.length; i++) {
    const stop = itinerary.stops[i];
    const policy = policyForStop(placePolicies, stop.placeId);
    if (!policy) {
      continue;
    }

    if (policy.overnightRequiresBrief) {
      errors.push(
        `${stop.placeName} is not a standard first-timer overnight unless the brief named it (world-model overnight-requires-brief).`
      );
    }

    if (
      policy.stayMinNights != null &&
      stop.nights < policy.stayMinNights
    ) {
      errors.push(
        `${stop.placeName} needs at least ${policy.stayMinNights} nights (graph stay-min); currently ${stop.nights}.`
      );
    }

    if (
      policy.stayMaxNights != null &&
      stop.nights > policy.stayMaxNights
    ) {
      errors.push(
        `${stop.placeName} allows at most ${policy.stayMaxNights} nights (graph stay-max); currently ${stop.nights}.`
      );
    }

    if (
      policy.stayRecommendedNights != null &&
      stop.nights !== policy.stayRecommendedNights &&
      (policy.stayMinNights == null || stop.nights >= policy.stayMinNights) &&
      (policy.stayMaxNights == null || stop.nights <= policy.stayMaxNights)
    ) {
      warnings.push(
        `${stop.placeName}: ${stop.nights} nights (graph recommended ${policy.stayRecommendedNights}; stay within min–max).`
      );
    }

    for (let j = i + 1; j < itinerary.stops.length; j++) {
      const other = itinerary.stops[j];
      if (stopMatchesIncompatible(other.placeId, other.placeName, policy)) {
        errors.push(
          `Hard rule: do not use both ${stop.placeName} and ${other.placeName} as overnight bases — pick one (world-model incompatible-overnight-with).`
        );
      }
      const otherPolicy = policyForStop(placePolicies, other.placeId);
      if (
        otherPolicy &&
        stopMatchesIncompatible(stop.placeId, stop.placeName, otherPolicy)
      ) {
        // Avoid duplicate message if both edges exist
        const dup = errors.some(
          (e) =>
            e.includes(stop.placeName) &&
            e.includes(other.placeName) &&
            /incompatible-overnight/i.test(e)
        );
        if (!dup) {
          errors.push(
            `Hard rule: do not use both ${other.placeName} and ${stop.placeName} as overnight bases — pick one (world-model incompatible-overnight-with).`
          );
        }
      }
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
