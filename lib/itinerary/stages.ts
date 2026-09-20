import type { ClientItinerary, ClientItineraryDay, ClientItineraryStop } from "./schema";

export const ITINERARY_STAGES = ["route", "stays", "days", "complete"] as const;
export type ItineraryStage = (typeof ITINERARY_STAGES)[number];

export type ItineraryWorkflow = {
  stage: ItineraryStage;
  approved: {
    route?: string;
    stays?: string;
    days?: string;
  };
};

export const STAGE_LABELS: Record<ItineraryStage, string> = {
  route: "Route",
  stays: "Stays",
  days: "Days",
  complete: "Complete",
};

export const STAGE_HELP: Record<ItineraryStage, string> = {
  route:
    "Overnight bases, nights, and transport cards between them. Approve when the spine looks right.",
  stays:
    "Pick a hotel for each overnight stop. Approve when properties match the brief.",
  days:
    "One card per overnight plus a departure morning. Last day stays airport-light. Approve when pacing is client-ready.",
  complete: "All stages approved. Chat to tweak, or export later.",
};

export function emptyWorkflow(stage: ItineraryStage = "route"): ItineraryWorkflow {
  return { stage, approved: {} };
}

/** Infer workflow for legacy itineraries that lack the field. Never skip ahead. */
export function ensureWorkflow(itinerary: ClientItinerary): ItineraryWorkflow {
  if (itinerary.workflow?.stage) {
    return {
      stage: itinerary.workflow.stage,
      approved: { ...itinerary.workflow.approved },
    };
  }
  return emptyWorkflow("route");
}

export function withWorkflow(
  itinerary: ClientItinerary,
  workflow: ItineraryWorkflow
): ClientItinerary {
  return { ...itinerary, workflow };
}

export function nextStageAfter(stage: ItineraryStage): ItineraryStage {
  if (stage === "route") return "stays";
  if (stage === "stays") return "days";
  return "complete";
}

export function approveCurrentStage(itinerary: ClientItinerary): ClientItinerary {
  const workflow = ensureWorkflow(itinerary);
  if (workflow.stage === "complete") {
    return withWorkflow(itinerary, workflow);
  }
  const now = new Date().toISOString();
  const stage = workflow.stage as "route" | "stays" | "days";
  return withWorkflow(itinerary, {
    stage: nextStageAfter(workflow.stage),
    approved: { ...workflow.approved, [stage]: now },
  });
}

export function reopenStage(
  itinerary: ClientItinerary,
  stage: "route" | "stays" | "days"
): ClientItinerary {
  const workflow = ensureWorkflow(itinerary);
  const approved = { ...workflow.approved };
  if (stage === "route") {
    delete approved.route;
    delete approved.stays;
    delete approved.days;
  } else if (stage === "stays") {
    delete approved.stays;
    delete approved.days;
  } else {
    delete approved.days;
  }
  return withWorkflow(itinerary, { stage, approved });
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
 */
export function syncDaysToNights(
  stops: ClientItineraryStop[],
  existing: ClientItineraryDay[] = []
): ClientItineraryDay[] {
  const days: ClientItineraryDay[] = [];
  let dayNumber = 1;

  stops.forEach((stop, stopIndex) => {
    const nights = Math.max(1, stop.nights);
    const isLast = stopIndex === stops.length - 1;
    const prior = existing
      .filter((day) => day.stopIndex === stopIndex)
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
      days.push({
        dayNumber,
        stopIndex,
        title: titleIsStub ? autoTitle : priorTitle,
        description: source?.description ?? "",
        transitNote: source?.transitNote,
        blocks: source?.blocks ?? [],
      });
      dayNumber += 1;
    }
  });

  return days.length > 0
    ? days
    : [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Draft",
          description: "",
          blocks: [],
        },
      ];
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

  if (stage === "route") {
    const stops = itinerary.stops.map((stop) => ({
      placeId: stop.placeId,
      placeName: stop.placeName,
      nights: stop.nights,
    }));
    const days =
      itinerary.days.length > 0
        ? syncDaysToNights(
            stops,
            itinerary.days.map((day) => ({
              ...day,
              blocks: [] as ClientItineraryDay["blocks"],
            }))
          )
        : stubDaysForStops(stops);
    return withWorkflow(
      {
        ...itinerary,
        stops,
        days,
        transfers: itinerary.transfers ?? [],
        durationDays: Math.max(itinerary.durationDays, calendarDayCount(stops)),
      },
      { stage: "route", approved: {} }
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

  if (stage === "route" || stage === "complete") {
    return withWorkflow(
      stage === "route" ? projectToStage(draft, "route") : draft,
      workflow
    );
  }

  if (stage === "stays") {
    const stops = previous.stops.map((stop, index) => {
      const match =
        draft.stops.find(
          (candidate) =>
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
    return "Route approved. Continue on stays from the brief and the overnight stops already on the canvas.";
  }
  if (stage === "days") {
    return "Stays approved. Continue on days from the brief, the route, and realistic travel time. Keep departure mornings light.";
  }
  return null;
}
