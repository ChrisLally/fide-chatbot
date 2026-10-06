import type { ClientItinerary, ClientItineraryDay, ClientItineraryStop } from "./schema";
import {
  allocateDayId,
  allocateStopId,
  ensureArtifactIds,
  nextDayIdCounter,
} from "./ids";
import {
  emptyWorkflow,
  ensureWorkflow,
  migrateApprovalValue,
  migrateWorkflow,
  nextStageAfter,
  STAGE_HELP,
  STAGE_LABELS,
  type ApprovalRecord,
  type ItineraryStage,
  type ItineraryWorkflow,
} from "./workflow";

export {
  emptyWorkflow,
  ensureWorkflow,
  migrateApprovalValue,
  migrateWorkflow,
  nextStageAfter,
  STAGE_HELP,
  STAGE_LABELS,
};
export type { ApprovalRecord, ItineraryStage, ItineraryWorkflow };
export const ITINERARY_STAGES = ["stops", "stays", "days", "complete"] as const;

export function withWorkflow(
  itinerary: ClientItinerary,
  workflow: ItineraryWorkflow
): ClientItinerary {
  return { ...itinerary, workflow };
}

export function bumpVersion(itinerary: ClientItinerary): ClientItinerary {
  return { ...itinerary, version: (itinerary.version ?? 1) + 1 };
}

export function approveCurrentStage(
  itinerary: ClientItinerary,
  options?: { by?: "human" | "auto"; bump?: boolean }
): ClientItinerary {
  const workflow = ensureWorkflow(itinerary);
  if (workflow.stage === "complete") {
    return withWorkflow(itinerary, workflow);
  }
  const now = new Date().toISOString();
  const by = options?.by ?? "human";
  const stage = workflow.stage as "stops" | "stays" | "days";
  const record: ApprovalRecord = { at: now, by };
  const next = withWorkflow(itinerary, {
    stage: nextStageAfter(workflow.stage),
    approved: { ...workflow.approved, [stage]: record },
  });
  return options?.bump === false ? next : bumpVersion(next);
}

export function reopenStage(
  itinerary: ClientItinerary,
  stage: "stops" | "stays" | "days"
): ClientItinerary {
  const workflow = ensureWorkflow(itinerary);
  const approved = { ...workflow.approved };
  if (stage === "stops") {
    delete approved.stops;
    delete approved.stays;
    delete approved.days;
  } else if (stage === "stays") {
    delete approved.stays;
    delete approved.days;
  } else {
    delete approved.days;
  }
  return bumpVersion(withWorkflow(itinerary, { stage, approved }));
}

/** Clear stays + days approvals after a stops-structure mutation. */
export function clearApprovalsAfterStopsChange(
  itinerary: ClientItinerary
): ClientItinerary {
  const workflow = ensureWorkflow(itinerary);
  const approved = { ...workflow.approved };
  delete approved.stays;
  delete approved.days;
  const stage =
    workflow.stage === "days" || workflow.stage === "complete"
      ? "stays"
      : workflow.stage === "stays"
        ? "stays"
        : workflow.stage;
  return withWorkflow(itinerary, { stage, approved });
}

/** Clear stays approval after a hotel mutation (days approval untouched). */
export function clearApprovalsAfterHotelChange(
  itinerary: ClientItinerary
): ClientItinerary {
  const workflow = ensureWorkflow(itinerary);
  const approved = { ...workflow.approved };
  delete approved.stays;
  return withWorkflow(itinerary, { stage: workflow.stage, approved });
}

export function overnightTotal(stops: ClientItineraryStop[]): number {
  return Math.max(
    1,
    stops.reduce((sum, stop) => sum + Math.max(1, stop.nights), 0)
  );
}

/** Nights plus the departure morning after the last stay. */
export function calendarDayCount(stops: ClientItineraryStop[]): number {
  return overnightTotal(stops) + 1;
}

export function stubDaysForStops(
  stops: ClientItineraryStop[]
): ClientItineraryDay[] {
  return syncDaysToNights(stops, []);
}

function isDepartureTitle(title: string): boolean {
  return /^depart\b/i.test(title.trim()) || /\bdeparture\b/i.test(title.trim());
}

/**
 * One day card per overnight, plus a departure morning on the last stop.
 * Calendar dayNumber is 1…sum(nights)+1.
 * Preserves dayId when reusing a prior day; allocates new ids for new slots.
 */
export function syncDaysToNights(
  stops: ClientItineraryStop[],
  existing: ClientItineraryDay[] = []
): ClientItineraryDay[] {
  const days: ClientItineraryDay[] = [];
  let dayNumber = 1;
  const dayCounter = { next: nextDayIdCounter(existing) };

  stops.forEach((stop, stopIndex) => {
    const nights = Math.max(1, stop.nights);
    const isLast = stopIndex === stops.length - 1;
    const prior = existing
      .filter((day) =>
        stop.stopId && day.stopId
          ? day.stopId === stop.stopId
          : day.stopIndex === stopIndex
      )
      .sort((a, b) => a.dayNumber - b.dayNumber);
    const departPrior = isLast
      ? prior.filter((day) => isDepartureTitle(day.title ?? ""))
      : [];
    const stayPrior = prior.filter((day) => !isDepartureTitle(day.title ?? ""));
    const withBlocks = stayPrior.filter((day) => (day.blocks?.length ?? 0) > 0);
    const empty = stayPrior.filter((day) => (day.blocks?.length ?? 0) === 0);
    const keepStay = [...withBlocks, ...empty].slice(0, nights);
    const slots = isLast ? nights + 1 : nights;

    for (let offset = 0; offset < slots; offset++) {
      const isDeparture = isLast && offset === nights;
      const source = isDeparture ? departPrior[0] : keepStay[offset];
      const autoTitle = isDeparture
        ? `Depart ${stop.placeName}`
        : offset === 0
          ? `Stay in ${stop.placeName}`
          : `${stop.placeName} · day ${offset + 1}`;
      const priorTitle = source?.title?.trim() ?? "";
      const titleIsStub =
        !priorTitle ||
        /^stay in /i.test(priorTitle) ||
        / · day \d+$/i.test(priorTitle) ||
        isDepartureTitle(priorTitle);
      const dayId =
        source?.dayId && source.dayId.trim()
          ? source.dayId
          : allocateDayId(existing, dayCounter);
      days.push({
        dayNumber,
        dayId,
        stopIndex,
        stopId: stop.stopId,
        title: titleIsStub ? autoTitle : priorTitle,
        description: source?.description ?? "",
        transitNote: source?.transitNote,
        blocks: source?.blocks ?? [],
        ...(source?.stale ? { stale: true } : {}),
      });
      dayNumber += 1;
    }
  });

  if (days.length > 0) {
    return days;
  }

  const fallbackStopId =
    stops[0]?.stopId ?? allocateStopId(stops.length ? stops : [{ stopId: "s0" }]);
  return [
    {
      dayNumber: 1,
      dayId: allocateDayId([], dayCounter),
      stopIndex: 0,
      stopId: fallbackStopId,
      title: "Draft",
      description: "",
      blocks: [],
    },
  ];
}

/**
 * True when shrinking nights would drop day cards that still have blocks.
 */
export function nightsShrinkWouldLoseBlocks(
  stops: ClientItineraryStop[],
  existing: ClientItineraryDay[],
  stopIndex: number,
  newNights: number
): boolean {
  const stop = stops[stopIndex];
  if (!stop) return false;
  const prior = existing
    .filter((day) =>
      stop.stopId && day.stopId
        ? day.stopId === stop.stopId
        : day.stopIndex === stopIndex
    )
    .filter((day) => !isDepartureTitle(day.title ?? ""))
    .sort((a, b) => a.dayNumber - b.dayNumber);
  const withBlocks = prior.filter((day) => (day.blocks?.length ?? 0) > 0);
  return withBlocks.length > newNights;
}

/** Strip fields that belong to later stages. */
export function projectToStage(
  itinerary: ClientItinerary,
  stage: ItineraryStage
): ClientItinerary {
  const workflow =
    stage === "complete"
      ? ensureWorkflow(itinerary)
      : {
          stage,
          approved: ensureWorkflow(itinerary).approved,
        };

  if (stage === "stops") {
    const stops = itinerary.stops.map((stop) => ({
      stopId: stop.stopId,
      placeId: stop.placeId,
      placeName: stop.placeName,
      nights: stop.nights,
    }));
    const withIds = ensureArtifactIds({ ...itinerary, stops, days: [] });
    const days =
      itinerary.days.length > 0
        ? syncDaysToNights(
            withIds.stops,
            itinerary.days.map((day) => ({
              ...day,
              blocks: [] as ClientItineraryDay["blocks"],
            }))
          )
        : stubDaysForStops(withIds.stops);
    return withWorkflow(
      {
        ...itinerary,
        stops: withIds.stops,
        days,
        transfers: itinerary.transfers ?? [],
        durationDays: Math.max(itinerary.durationDays, calendarDayCount(withIds.stops)),
      },
      { stage: "stops", approved: {} }
    );
  }

  if (stage === "stays") {
    return withWorkflow(
      {
        ...itinerary,
        days: itinerary.days.map((day) => ({ ...day, blocks: day.blocks ?? [] })),
      },
      workflow.stage === "stays"
        ? workflow
        : { stage: "stays", approved: workflow.approved }
    );
  }

  return withWorkflow(itinerary, workflow);
}

/**
 * Merge a model update into the locked previous itinerary for the active stage.
 */
export function mergeStageUpdate(
  previous: ClientItinerary,
  draft: ClientItinerary
): ClientItinerary {
  const workflow = ensureWorkflow(previous);
  const stage = workflow.stage;

  if (stage === "stops" || stage === "complete") {
    return withWorkflow(
      stage === "stops" ? projectToStage(draft, "stops") : draft,
      workflow
    );
  }

  if (stage === "stays") {
    const stops = previous.stops.map((stop, index) => {
      const match =
        draft.stops.find(
          (candidate) =>
            (stop.stopId && candidate.stopId === stop.stopId) ||
            candidate.placeId === stop.placeId ||
            candidate.placeName.toLowerCase() === stop.placeName.toLowerCase()
        ) ?? draft.stops[index];
      if (!match?.hotelId || !match.hotelName) {
        return stop;
      }
      return {
        ...stop,
        hotelId: match.hotelId,
        hotelName: match.hotelName,
      };
    });
    return withWorkflow(
      {
        ...previous,
        stops,
        transfers: previous.transfers ?? [],
      },
      workflow
    );
  }

  // days — keep stops + transfers; take days from draft when stopIndex in range
  const days = draft.days
    .filter((day) => day.stopIndex >= 0 && day.stopIndex < previous.stops.length)
    .map((day) => ({
      ...day,
      blocks: day.blocks ?? [],
    }));
  return withWorkflow(
    {
      ...previous,
      transfers: previous.transfers ?? [],
      days: days.length > 0 ? days : previous.days,
      durationDays: Math.max(previous.durationDays, days.length || previous.days.length),
    },
    workflow
  );
}

export function stageAdvancePrompt(stage: ItineraryStage): string | null {
  if (stage === "stays") {
    return "Stops approved. Continue on stays from the brief and the overnight stops already on the canvas.";
  }
  if (stage === "days") {
    return "Stays approved. Continue on days from the brief, the stops, and realistic travel time. Keep departure mornings light.";
  }
  return null;
}
