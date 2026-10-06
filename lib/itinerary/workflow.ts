/**
 * Workflow stage helpers — kept separate from schema.ts to avoid ESM cycles
 * (schema ↔ stages) that collapse named exports to `default` only.
 */

export const ITINERARY_STAGES = ["stops", "stays", "days", "complete"] as const;
export type ItineraryStage = (typeof ITINERARY_STAGES)[number];

export type ApprovalRecord = {
  at: string;
  by: "human" | "auto";
};

export type ItineraryWorkflow = {
  stage: ItineraryStage;
  approved: {
    stops?: ApprovalRecord;
    stays?: ApprovalRecord;
    days?: ApprovalRecord;
  };
};

export const STAGE_LABELS: Record<ItineraryStage, string> = {
  stops: "Stops",
  stays: "Stays",
  days: "Days",
  complete: "Complete",
};

export const STAGE_HELP: Record<ItineraryStage, string> = {
  stops:
    "Overnight bases, nights, and transport cards between them. Approve when the spine looks right.",
  stays:
    "Pick a hotel for each overnight stop. Approve when properties match the brief.",
  days:
    "One card per overnight plus a departure morning. Last day stays airport-light. Approve when pacing is client-ready.",
  complete: "All stages approved. Chat to tweak, or export later.",
};

export function migrateApprovalValue(
  value: unknown
): ApprovalRecord | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim()) {
    return { at: value, by: "human" };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApprovalRecord).at === "string" &&
    ((value as ApprovalRecord).by === "human" ||
      (value as ApprovalRecord).by === "auto")
  ) {
    return {
      at: (value as ApprovalRecord).at,
      by: (value as ApprovalRecord).by,
    };
  }
  return undefined;
}

export function emptyWorkflow(stage: ItineraryStage = "stops"): ItineraryWorkflow {
  return { stage, approved: {} };
}

/** Migrate legacy stage `route` / approved.route → stops. */
export function migrateWorkflow(raw: unknown): ItineraryWorkflow {
  if (!raw || typeof raw !== "object") {
    return emptyWorkflow("stops");
  }
  const wf = raw as {
    stage?: string;
    approved?: Record<string, unknown>;
  };
  let stage: ItineraryStage = "stops";
  if (wf.stage === "route" || wf.stage === "stops") stage = "stops";
  else if (wf.stage === "stays") stage = "stays";
  else if (wf.stage === "days") stage = "days";
  else if (wf.stage === "complete") stage = "complete";

  const approvedIn = wf.approved ?? {};
  const stops =
    migrateApprovalValue(approvedIn.stops) ??
    migrateApprovalValue(approvedIn.route);

  return {
    stage,
    approved: {
      ...(stops ? { stops } : {}),
      ...(migrateApprovalValue(approvedIn.stays)
        ? { stays: migrateApprovalValue(approvedIn.stays) }
        : {}),
      ...(migrateApprovalValue(approvedIn.days)
        ? { days: migrateApprovalValue(approvedIn.days) }
        : {}),
    },
  };
}

export function ensureWorkflow(itinerary: {
  workflow?: unknown;
}): ItineraryWorkflow {
  if (itinerary.workflow != null) {
    return migrateWorkflow(itinerary.workflow);
  }
  return emptyWorkflow("stops");
}

export function nextStageAfter(stage: ItineraryStage): ItineraryStage {
  if (stage === "stops") return "stays";
  if (stage === "stays") return "days";
  return "complete";
}
