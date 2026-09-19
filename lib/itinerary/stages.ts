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
    "Day cards and activity blocks. Approve when pacing is client-ready.",
  complete: "All stages approved. Chat to tweak, or export later.",
};

export function emptyWorkflow(stage: ItineraryStage = "route"): ItineraryWorkflow {
  return { stage, approved: {} };
}

/** Infer workflow for legacy itineraries that lack the field. */
export function ensureWorkflow(itinerary: ClientItinerary): ItineraryWorkflow {
  if (itinerary.workflow?.stage) {
    return {
      stage: itinerary.workflow.stage,
      approved: { ...itinerary.workflow.approved },
    };
  }

  const hasHotels = itinerary.stops.some((s) => Boolean(s.hotelId));
  const hasBlocks = itinerary.days.some((d) => (d.blocks?.length ?? 0) > 0);
  if (hasHotels && hasBlocks) {
    return {
      stage: "complete",
      approved: {
        route: "legacy",
        stays: "legacy",
        days: "legacy",
      },
    };
  }
  if (hasHotels) {
    return { stage: "days", approved: { route: "legacy", stays: "legacy" } };
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

export function stubDaysForStops(
  stops: ClientItineraryStop[]
): ClientItineraryDay[] {
  let dayNumber = 1;
  const days: ClientItineraryDay[] = [];
  stops.forEach((stop, stopIndex) => {
    days.push({
      dayNumber,
      stopIndex,
      title: `Stay in ${stop.placeName}`,
      description: "",
      blocks: [],
    });
    dayNumber += 1;
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
        ? itinerary.days.map((day) => ({
            ...day,
            blocks: [] as ClientItineraryDay["blocks"],
          }))
        : stubDaysForStops(stops);
    return withWorkflow(
      {
        ...itinerary,
        stops,
        days,
        transfers: itinerary.transfers ?? [],
        durationDays: Math.max(itinerary.durationDays, days.length),
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

export function stageAdvancePrompt(stage: ItineraryStage): string {
  if (stage === "stays") {
    return `[Workflow] Route stage approved. Continue to **stays** only: run_view inventory/hotels-by-city for each overnight stop, then updateDocument with hotelName/hotelId on those stops. Do not change places, nights, or day blocks.`;
  }
  if (stage === "days") {
    return `[Workflow] Stays approved. Continue to **days** only: run_view activities-by-city / attractions-by-city for each stop, then updateDocument with day cards and timed blocks. Do not change stops, nights, or hotels.`;
  }
  if (stage === "complete") {
    return `[Workflow] Days approved — itinerary stages complete. Confirm briefly; only edit if I ask.`;
  }
  return `[Workflow] Focus on the **route** stage: overnight places + nights only.`;
}
