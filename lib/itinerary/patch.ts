import { z } from "zod";
import type { TurnEntityBinder } from "./entity-binder";
import {
  allocateStopId,
  ensureArtifactIds,
  nextStopIdCounter,
} from "./ids";
import {
  clientItinerarySchema,
  fideIdEntityType,
  fideIdHex,
  type ClientItinerary,
  type ClientItineraryDay,
  type ClientItineraryStop,
  type DayBlock,
  type ItineraryTransfer,
  type PeekEntityKind,
} from "./schema";
import { verifyItineraryStage } from "./stage-verifier";
import {
  policyForStop,
  stayCeiling,
  stayFloor,
  type PlacePolicyMap,
} from "./place-policy";
import {
  approveCurrentStage,
  bumpVersion,
  calendarDayCount,
  clearApprovalsAfterHotelChange,
  clearApprovalsAfterStopsChange,
  ensureWorkflow,
  nightsShrinkWouldLoseBlocks,
  overnightTotal,
  stubDaysForStops,
  syncDaysToNights,
  withWorkflow,
} from "./stages";

export type PatchVerifyOptions = {
  placePolicies?: PlacePolicyMap;
};

const fideIdSchema = z
  .string()
  .min(1)
  .refine((value) => Boolean(fideIdHex(value)), {
    message: "Must be a Fide id (did:fide:0x… or 0x…), not a title",
  });

const blockProposeSchema = z.object({
  when: z.enum(["morning", "afternoon", "evening", "flexible"]).default("flexible"),
  entityId: fideIdSchema.describe("did:fide:0x… copied from run_view"),
  entityKind: z.enum(["hotel", "activity", "attraction", "destination"]),
  entityName: z.string().optional(),
  title: z.string().optional(),
  note: z.string().optional(),
});

const transferSliceSchema = z.object({
  fromStopIndex: z.number().int().min(-1),
  toStopIndex: z.number().int().min(0),
  label: z.string().optional(),
  mode: z.string().optional(),
  durationHours: z.number().optional(),
  note: z.string().optional(),
  transportOptionIri: z.string().optional(),
  fromPlaceName: z.string().optional(),
  toPlaceName: z.string().optional(),
});

/** stopId preferred; stopIndex only when stopId absent (migration/tests). */
const stopRefFields = {
  stopId: z.string().regex(/^s\d+$/).optional(),
  stopIndex: z.number().int().min(0).optional(),
};

const dayRefFields = {
  dayId: z.string().regex(/^d\d+$/).optional(),
  dayNumber: z.number().int().min(1).optional(),
};

export const itineraryPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("setStopHotel"),
    ...stopRefFields,
    hotelId: fideIdSchema,
    hotelName: z.string().optional(),
  }),
  z.object({
    op: z.literal("setStopNights"),
    ...stopRefFields,
    nights: z.number().int().min(1),
    /** Required when shrinking nights would drop day cards with blocks. */
    confirmShrink: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("addStop"),
    /** Insert after this stopId (or within-batch temp key). Omit / use afterIndex:-1 for start. */
    afterStopId: z.string().optional(),
    afterIndex: z.number().int().min(-1).optional(),
    /** Within-batch temp key so later ops can address this stop before server id is known. */
    key: z.string().min(1).optional(),
    placeId: fideIdSchema,
    placeName: z.string().min(1).optional(),
    nights: z.number().int().min(1),
  }),
  z.object({
    op: z.literal("removeStop"),
    ...stopRefFields,
  }),
  z.object({
    op: z.literal("replaceStopPlace"),
    ...stopRefFields,
    placeId: fideIdSchema,
    placeName: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("setDayBlocks"),
    ...dayRefFields,
    title: z.string().optional(),
    description: z.string().optional(),
    blocks: z.array(blockProposeSchema).max(4),
  }),
  z.object({
    op: z.literal("setTransit"),
    fromStopIndex: z.number().int().min(-1),
    toStopIndex: z.number().int().min(0),
    label: z.string().optional(),
    mode: z.string().optional(),
    durationHours: z.number().optional(),
    note: z.string().optional(),
    transportOptionIri: z.string().optional(),
    fromPlaceName: z.string().optional(),
    toPlaceName: z.string().optional(),
  }),
  z.object({
    op: z.literal("setDayCopy"),
    ...dayRefFields,
    title: z.string().optional(),
    description: z.string().optional(),
    transitNote: z.string().optional(),
  }),
  z.object({
    op: z.literal("setSummary"),
    summary: z.string(),
  }),
  z.object({
    op: z.literal("setTitle"),
    title: z.string().min(1),
  }),
  z.object({
    op: z.literal("setStartDate"),
    startDate: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "startDate must be YYYY-MM-DD or empty to clear")
      .describe(
        "Trip Day 1 calendar date (YYYY-MM-DD) for the date picker and print bars. Empty string clears. Do not only put the date in summary prose."
      ),
  }),
]);

export type ItineraryPatch = z.infer<typeof itineraryPatchSchema>;

export type PatchDiagnostic = {
  opIndex: number;
  code: string;
  message: string;
  candidates?: string[];
};

export type PatchResult =
  | { ok: true; itinerary: ClientItinerary }
  | { ok: false; error: string; diagnostics: PatchDiagnostic[] };

export const proposeStopsSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  /** Day 1 calendar date (YYYY-MM-DD) when the brief names one. */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  durationDays: z.number().int().min(1).optional(),
  stops: z
    .array(
      z.object({
        placeId: fideIdSchema,
        placeName: z.string().min(1).optional(),
        nights: z.number().int().min(1),
      })
    )
    .min(1)
    .max(12),
  transfers: z.array(transferSliceSchema).optional(),
});

/** @deprecated Internal alias — agent-facing name is proposeStopsSchema. */
export type ProposeStops = z.infer<typeof proposeStopsSchema>;

function asDid(id: string): string {
  const hex = fideIdHex(id);
  return hex ? `did:fide:${hex}` : id.trim();
}

function fideKindOk(id: string, kind: PeekEntityKind): boolean {
  const type = fideIdEntityType(id);
  if (kind === "hotel") return type === "11";
  if (kind === "destination") return type === "40";
  if (kind === "activity" || kind === "attraction") return type === "31";
  return false;
}

function labelFromBinder(
  binder: TurnEntityBinder | undefined,
  id: string,
  kind: PeekEntityKind,
  fallback: string
): string {
  const hex = fideIdHex(id);
  const hit = binder?.list().find(
    (entity) => entity.kind === kind && fideIdHex(entity.fideId) === hex
  );
  return hit?.name?.trim() || fallback.trim() || "Untitled";
}

function nightsSum(stops: ClientItineraryStop[]): number {
  return calendarDayCount(stops);
}

function remapTransfers(
  transfers: ItineraryTransfer[],
  oldStopCount: number,
  mapIndex: (index: number) => number | null
): ItineraryTransfer[] {
  const next: ItineraryTransfer[] = [];
  for (const transfer of transfers) {
    const from =
      transfer.fromStopIndex === -1
        ? -1
        : mapIndex(transfer.fromStopIndex);
    const to =
      transfer.toStopIndex === oldStopCount
        ? mapIndex(oldStopCount)
        : mapIndex(transfer.toStopIndex);
    if (from == null || to == null) {
      continue;
    }
    next.push({ ...transfer, fromStopIndex: from, toStopIndex: to });
  }
  return next;
}

function pendingBlock(
  block: z.infer<typeof blockProposeSchema>,
  binder?: TurnEntityBinder
): DayBlock {
  const entityId = asDid(block.entityId);
  const name = labelFromBinder(
    binder,
    entityId,
    block.entityKind,
    block.entityName || block.title || "Entity"
  );
  return {
    when: block.when,
    title: block.title,
    note: block.note,
    entityId,
    entityName: name,
    entityKind: block.entityKind,
  };
}

function failDiag(
  opIndex: number,
  code: string,
  message: string,
  candidates?: string[]
): PatchResult {
  return {
    ok: false,
    error: message,
    diagnostics: [
      {
        opIndex,
        code,
        message,
        ...(candidates?.length ? { candidates } : {}),
      },
    ],
  };
}

function parseKeep(itinerary: ClientItinerary, opIndex = 0): PatchResult {
  const parsed = clientItinerarySchema.safeParse({
    ...itinerary,
    durationDays: nightsSum(itinerary.stops),
  });
  if (!parsed.success) {
    return failDiag(opIndex, "SCHEMA_INVALID", parsed.error.message);
  }
  return { ok: true, itinerary: parsed.data };
}

function kindFail(
  id: string,
  kind: PeekEntityKind,
  opIndex: number
): PatchResult | null {
  if (fideKindOk(id, kind)) return null;
  const got = fideIdEntityType(id) ?? "unknown";
  return failDiag(
    opIndex,
    "KIND_MISMATCH",
    `${kind} id must be a typed Fide id (hotel=0x11, place=0x40, activity=0x31). Got type ${got} for ${id}.`
  );
}

function bindAndKeep(
  itinerary: ClientItinerary,
  binder: TurnEntityBinder | undefined,
  requiredHint: string,
  opIndex = 0
): PatchResult {
  if (!binder) {
    const parsed = clientItinerarySchema.safeParse(itinerary);
    if (!parsed.success) {
      return failDiag(opIndex, "SCHEMA_INVALID", parsed.error.message);
    }
    return { ok: true, itinerary: parsed.data };
  }

  const { itinerary: bound, omitted } = binder.bind(itinerary);
  if (bound.stops.length === 0) {
    return failDiag(
      opIndex,
      "BIND_EMPTY",
      `Bind dropped every stop. run_view places-search first. (${omitted.join("; ") || requiredHint})`
    );
  }
  if (
    omitted.some(
      (row) =>
        row.toLowerCase().includes(requiredHint.toLowerCase()) ||
        row.includes(requiredHint)
    )
  ) {
    return failDiag(
      opIndex,
      "BIND_OMITTED",
      `Invalid or unbound entity id: ${omitted.join("; ")}. Copy did:fide:0x… from run_view.`
    );
  }

  const parsed = clientItinerarySchema.safeParse({
    ...bound,
    durationDays: nightsSum(bound.stops),
  });
  if (!parsed.success) {
    return failDiag(opIndex, "SCHEMA_INVALID", parsed.error.message);
  }
  return { ok: true, itinerary: parsed.data };
}

function stageBlocksOp(
  stage: ReturnType<typeof ensureWorkflow>["stage"],
  op: string,
  opIndex: number
): PatchResult | null {
  const hotelOps = op === "setStopHotel";
  const dayOps = op === "setDayBlocks";
  if (stage === "stops" && (hotelOps || dayOps)) {
    return failDiag(
      opIndex,
      "STAGE_BLOCKED",
      "Stops are not approved yet. Wait for the human to click Approve Stops before hotels or day activities."
    );
  }
  if (stage === "stays" && dayOps) {
    return failDiag(
      opIndex,
      "STAGE_BLOCKED",
      "Stays are not approved yet. Only set hotels (setStopHotel). Wait for Approve Stays before day activities."
    );
  }
  return null;
}

function verifyHard(
  itinerary: ClientItinerary,
  options: PatchVerifyOptions = {},
  opIndex = 0
): PatchResult | null {
  const stage = ensureWorkflow(itinerary).stage;
  const verified = verifyItineraryStage(itinerary, stage, {
    placePolicies: options.placePolicies,
  });
  const blockers = verified.errors.filter(
    (error) =>
      /incompatible-overnight|overnight bases/i.test(error) ||
      /overnight-requires-brief|standard first-timer overnight/i.test(error) ||
      /stay-min|stay-max/i.test(error) ||
      /exceeds 3\.5h/i.test(error)
  );
  if (blockers.length > 0) {
    return failDiag(opIndex, "VERIFIER_BLOCK", blockers.join("; "));
  }
  return null;
}

type BatchCtx = {
  /** Maps within-batch temp key → assigned stopId. */
  tempKeys: Map<string, string>;
  stopCounter: { next: number };
};

function resolveStopIndex(
  itinerary: ClientItinerary,
  patch: { stopId?: string; stopIndex?: number },
  ctx: BatchCtx,
  opIndex: number
): { ok: true; index: number } | PatchResult {
  if (patch.stopId) {
    const mapped = ctx.tempKeys.get(patch.stopId);
    const id = mapped ?? patch.stopId;
    const index = itinerary.stops.findIndex((stop) => stop.stopId === id);
    if (index < 0) {
      // Temp key referenced before definition
      if (!mapped && !/^s\d+$/.test(patch.stopId)) {
        return failDiag(
          opIndex,
          "TEMP_KEY_UNDEFINED",
          `Temp key "${patch.stopId}" is not defined yet in this batch.`
        );
      }
      return failDiag(
        opIndex,
        "STOP_NOT_FOUND",
        `No stop with stopId "${patch.stopId}".`,
        itinerary.stops.map((s) => s.stopId).filter(Boolean) as string[]
      );
    }
    return { ok: true, index };
  }
  if (typeof patch.stopIndex === "number") {
    if (patch.stopIndex < 0 || patch.stopIndex >= itinerary.stops.length) {
      return failDiag(
        opIndex,
        "STOP_INDEX_OOR",
        `stopIndex ${patch.stopIndex} is out of range (${itinerary.stops.length} stops).`
      );
    }
    return { ok: true, index: patch.stopIndex };
  }
  return failDiag(
    opIndex,
    "STOP_REF_REQUIRED",
    "Patch must include stopId (preferred) or stopIndex."
  );
}

function resolveDay(
  itinerary: ClientItinerary,
  patch: { dayId?: string; dayNumber?: number },
  opIndex: number
): { ok: true; day: ClientItineraryDay } | PatchResult {
  if (patch.dayId) {
    const day = itinerary.days.find((row) => row.dayId === patch.dayId);
    if (!day) {
      return failDiag(
        opIndex,
        "DAY_NOT_FOUND",
        `No day with dayId "${patch.dayId}".`,
        itinerary.days.map((d) => d.dayId).filter(Boolean) as string[]
      );
    }
    return { ok: true, day };
  }
  if (typeof patch.dayNumber === "number") {
    const day = itinerary.days.find((row) => row.dayNumber === patch.dayNumber);
    if (!day) {
      return failDiag(
        opIndex,
        "DAY_NOT_FOUND",
        `No day ${patch.dayNumber}. This trip has days 1–${itinerary.days.at(-1)?.dayNumber ?? 0} (${itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0)} nights + departure morning).`
      );
    }
    return { ok: true, day };
  }
  return failDiag(
    opIndex,
    "DAY_REF_REQUIRED",
    "Patch must include dayId (preferred) or dayNumber."
  );
}

function resolveAfterIndex(
  itinerary: ClientItinerary,
  patch: { afterStopId?: string; afterIndex?: number },
  ctx: BatchCtx,
  opIndex: number
): { ok: true; insertAt: number } | PatchResult {
  if (patch.afterStopId) {
    const mapped = ctx.tempKeys.get(patch.afterStopId);
    const id = mapped ?? patch.afterStopId;
    const index = itinerary.stops.findIndex((stop) => stop.stopId === id);
    if (index < 0) {
      if (!mapped && !/^s\d+$/.test(patch.afterStopId)) {
        return failDiag(
          opIndex,
          "TEMP_KEY_UNDEFINED",
          `Temp key "${patch.afterStopId}" is not defined yet in this batch.`
        );
      }
      return failDiag(
        opIndex,
        "STOP_NOT_FOUND",
        `afterStopId "${patch.afterStopId}" not found.`
      );
    }
    return { ok: true, insertAt: index + 1 };
  }
  const afterIndex = patch.afterIndex ?? -1;
  if (afterIndex < -1 || afterIndex >= itinerary.stops.length) {
    return failDiag(
      opIndex,
      "AFTER_INDEX_OOR",
      `afterIndex ${afterIndex} is out of range.`
    );
  }
  return { ok: true, insertAt: afterIndex + 1 };
}

/**
 * Soft auto-advance: when stays/days verifier is clean, auto-approve and advance.
 * NEVER auto-approve stops.
 */
export function maybeSoftAutoAdvance(
  itinerary: ClientItinerary,
  options: PatchVerifyOptions = {}
): ClientItinerary {
  let current = itinerary;
  for (let guard = 0; guard < 2; guard++) {
    const workflow = ensureWorkflow(current);
    if (workflow.stage !== "stays" && workflow.stage !== "days") {
      break;
    }
    const gate = verifyItineraryStage(current, workflow.stage, {
      forApprove: true,
      placePolicies: options.placePolicies,
    });
    if (!gate.ok) break;
    current = approveCurrentStage(current, { by: "auto", bump: false });
  }
  return current;
}

export function applyItineraryPatch(
  previous: ClientItinerary,
  patch: ItineraryPatch,
  binder?: TurnEntityBinder,
  options: PatchVerifyOptions = {}
): PatchResult {
  return applyItineraryPatches(previous, [patch], binder, options);
}

/** Apply ops atomically — any failure rejects the whole batch. */
export function applyItineraryPatches(
  previous: ClientItinerary,
  patches: ItineraryPatch[],
  binder?: TurnEntityBinder,
  options: PatchVerifyOptions = {}
): PatchResult {
  if (patches.length === 0) {
    return failDiag(-1, "EMPTY_BATCH", "patches must contain at least one op.");
  }

  // Pre-scan temp keys for duplicates
  const seenKeys = new Set<string>();
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    if (patch.op === "addStop" && patch.key) {
      if (seenKeys.has(patch.key)) {
        return failDiag(
          i,
          "DUPLICATE_TEMP_KEY",
          `Temp key "${patch.key}" is used more than once in this batch.`
        );
      }
      seenKeys.add(patch.key);
    }
  }

  let current = ensureArtifactIds(structuredClone(previous) as ClientItinerary);
  const ctx: BatchCtx = {
    tempKeys: new Map(),
    stopCounter: { next: nextStopIdCounter(current.stops) },
  };

  for (let i = 0; i < patches.length; i++) {
    const result = applyOneItineraryPatch(current, patches[i], binder, options, ctx, i);
    if (!result.ok) {
      return result;
    }
    current = result.itinerary;
  }

  current = bumpVersion(current);
  current = maybeSoftAutoAdvance(current, options);
  return { ok: true, itinerary: current };
}

function applyOneItineraryPatch(
  previous: ClientItinerary,
  patch: ItineraryPatch,
  binder: TurnEntityBinder | undefined,
  options: PatchVerifyOptions,
  ctx: BatchCtx,
  opIndex: number
): PatchResult {
  const itinerary = structuredClone(previous) as ClientItinerary;
  const workflow = ensureWorkflow(itinerary);
  itinerary.workflow = workflow;
  itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
  itinerary.durationDays = nightsSum(itinerary.stops);

  const blocked = stageBlocksOp(workflow.stage, patch.op, opIndex);
  if (blocked) return blocked;

  switch (patch.op) {
    case "setStopHotel": {
      const resolved = resolveStopIndex(itinerary, patch, ctx, opIndex);
      if (!("index" in resolved)) return resolved;
      const kindBad = kindFail(patch.hotelId, "hotel", opIndex);
      if (kindBad) return kindBad;
      const hotelId = asDid(patch.hotelId);
      itinerary.stops[resolved.index] = {
        ...itinerary.stops[resolved.index],
        hotelId,
        hotelName: labelFromBinder(
          binder,
          hotelId,
          "hotel",
          patch.hotelName || itinerary.stops[resolved.index].hotelName || "Hotel"
        ),
      };
      Object.assign(itinerary, clearApprovalsAfterHotelChange(itinerary));
      return parseKeep(itinerary, opIndex);
    }
    case "setStopNights": {
      const resolved = resolveStopIndex(itinerary, patch, ctx, opIndex);
      if (!("index" in resolved)) return resolved;
      const prevNights = itinerary.stops[resolved.index].nights;
      if (
        patch.nights < prevNights &&
        nightsShrinkWouldLoseBlocks(
          itinerary.stops,
          itinerary.days,
          resolved.index,
          patch.nights
        ) &&
        !patch.confirmShrink
      ) {
        return failDiag(
          opIndex,
          "NIGHTS_SHRINK_NEEDS_CONFIRM",
          `Reducing nights from ${prevNights} to ${patch.nights} would drop day cards with blocks. Re-submit with confirmShrink:true (lost day content will be discarded; remaining days for this stop may be marked stale).`
        );
      }
      itinerary.stops[resolved.index] = {
        ...itinerary.stops[resolved.index],
        nights: patch.nights,
      };
      if (patch.nights < prevNights && patch.confirmShrink) {
        const stopId = itinerary.stops[resolved.index].stopId;
        itinerary.days = itinerary.days.map((day) =>
          (stopId && day.stopId === stopId) || day.stopIndex === resolved.index
            ? { ...day, stale: true }
            : day
        );
      }
      itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
      itinerary.durationDays = nightsSum(itinerary.stops);
      Object.assign(itinerary, clearApprovalsAfterStopsChange(itinerary));
      return verifyHard(itinerary, options, opIndex) ?? { ok: true, itinerary };
    }
    case "addStop": {
      const after = resolveAfterIndex(itinerary, patch, ctx, opIndex);
      if (!("insertAt" in after)) return after;
      const insertAt = after.insertAt;
      const oldCount = itinerary.stops.length;
      const stopId = allocateStopId(itinerary.stops, ctx.stopCounter);
      if (patch.key) {
        ctx.tempKeys.set(patch.key, stopId);
      }
      const draftStop: ClientItineraryStop = {
        stopId,
        placeId: patch.placeId,
        placeName: patch.placeName?.trim() || "Place",
        nights: patch.nights,
      };
      itinerary.stops.splice(insertAt, 0, draftStop);
      itinerary.days = itinerary.days.map((day) =>
        day.stopIndex >= insertAt ? { ...day, stopIndex: day.stopIndex + 1 } : day
      );
      itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
      itinerary.transfers = remapTransfers(
        itinerary.transfers ?? [],
        oldCount,
        (index) => (index >= insertAt ? index + 1 : index)
      );
      itinerary.durationDays = nightsSum(itinerary.stops);
      const kindBad = kindFail(patch.placeId, "destination", opIndex);
      if (kindBad) return kindBad;
      itinerary.stops[insertAt] = {
        ...itinerary.stops[insertAt],
        placeId: asDid(patch.placeId),
        placeName: labelFromBinder(
          binder,
          asDid(patch.placeId),
          "destination",
          patch.placeName || "Place"
        ),
      };
      Object.assign(itinerary, clearApprovalsAfterStopsChange(itinerary));
      return verifyHard(itinerary, options, opIndex) ?? parseKeep(itinerary, opIndex);
    }
    case "removeStop": {
      const resolved = resolveStopIndex(itinerary, patch, ctx, opIndex);
      if (!("index" in resolved)) return resolved;
      if (itinerary.stops.length === 1) {
        return failDiag(
          opIndex,
          "LAST_STOP",
          "Cannot remove the last overnight stop."
        );
      }
      const oldCount = itinerary.stops.length;
      const removed = resolved.index;
      itinerary.stops = itinerary.stops.filter((_, index) => index !== removed);
      itinerary.days = syncDaysToNights(
        itinerary.stops,
        itinerary.days
          .filter((day) => day.stopIndex !== removed)
          .map((day) =>
            day.stopIndex > removed ? { ...day, stopIndex: day.stopIndex - 1 } : day
          )
      );
      itinerary.transfers = remapTransfers(
        itinerary.transfers ?? [],
        oldCount,
        (index) => {
          if (index === removed) return null;
          if (index === oldCount) return itinerary.stops.length;
          if (index > removed) return index - 1;
          return index;
        }
      );
      itinerary.durationDays = nightsSum(itinerary.stops);
      Object.assign(itinerary, clearApprovalsAfterStopsChange(itinerary));
      return verifyHard(itinerary, options, opIndex) ?? { ok: true, itinerary };
    }
    case "replaceStopPlace": {
      const resolved = resolveStopIndex(itinerary, patch, ctx, opIndex);
      if (!("index" in resolved)) return resolved;
      const kindBad = kindFail(patch.placeId, "destination", opIndex);
      if (kindBad) return kindBad;
      const placeId = asDid(patch.placeId);
      const stopId = itinerary.stops[resolved.index].stopId;
      itinerary.stops[resolved.index] = {
        stopId,
        placeId,
        placeName: labelFromBinder(
          binder,
          placeId,
          "destination",
          patch.placeName || itinerary.stops[resolved.index].placeName
        ),
        nights: itinerary.stops[resolved.index].nights,
        hotelId: undefined,
        hotelName: undefined,
      };
      // Flag day blocks on this stop as stale (hotel already cleared).
      itinerary.days = itinerary.days.map((day) =>
        (stopId && day.stopId === stopId) || day.stopIndex === resolved.index
          ? { ...day, stale: true }
          : day
      );
      itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
      Object.assign(itinerary, clearApprovalsAfterStopsChange(itinerary));
      return verifyHard(itinerary, options, opIndex) ?? parseKeep(itinerary, opIndex);
    }
    case "setDayBlocks": {
      const resolved = resolveDay(itinerary, patch, opIndex);
      if (!("day" in resolved)) return resolved;
      const day = resolved.day;
      for (const block of patch.blocks) {
        const kindBad = kindFail(block.entityId, block.entityKind, opIndex);
        if (kindBad) return kindBad;
      }
      const nextDay: ClientItineraryDay = {
        ...day,
        title: patch.title?.trim() || day.title,
        description: patch.description ?? day.description,
        blocks: patch.blocks.map((block) => pendingBlock(block, binder)),
        stale: undefined,
      };
      itinerary.days = itinerary.days.map((row) =>
        (day.dayId && row.dayId === day.dayId) || row.dayNumber === day.dayNumber
          ? nextDay
          : row
      );
      return parseKeep(itinerary, opIndex);
    }
    case "setTransit": {
      const transfers = [...(itinerary.transfers ?? [])];
      const existing = transfers.findIndex(
        (row) =>
          row.fromStopIndex === patch.fromStopIndex &&
          row.toStopIndex === patch.toStopIndex
      );
      const next: ItineraryTransfer = {
        fromStopIndex: patch.fromStopIndex,
        toStopIndex: patch.toStopIndex,
        label: patch.label,
        mode: patch.mode,
        durationHours: patch.durationHours,
        note: patch.note,
        transportOptionIri: patch.transportOptionIri,
        fromPlaceName: patch.fromPlaceName,
        toPlaceName: patch.toPlaceName,
      };
      if (existing >= 0) {
        transfers[existing] = { ...transfers[existing], ...next };
      } else {
        transfers.push(next);
      }
      itinerary.transfers = transfers;
      return verifyHard(itinerary, options, opIndex) ?? { ok: true, itinerary };
    }
    case "setDayCopy": {
      const resolved = resolveDay(itinerary, patch, opIndex);
      if (!("day" in resolved)) return resolved;
      const day = resolved.day;
      itinerary.days = itinerary.days.map((row) =>
        (day.dayId && row.dayId === day.dayId) || row.dayNumber === day.dayNumber
          ? {
              ...row,
              title: patch.title?.trim() || row.title,
              description: patch.description ?? row.description,
              transitNote: patch.transitNote ?? row.transitNote,
            }
          : row
      );
      return { ok: true, itinerary };
    }
    case "setSummary":
      itinerary.summary = patch.summary;
      return { ok: true, itinerary };
    case "setTitle":
      itinerary.title = patch.title;
      return { ok: true, itinerary };
    case "setStartDate":
      itinerary.startDate = patch.startDate.trim() || undefined;
      return { ok: true, itinerary };
    default: {
      const _never: never = patch;
      return failDiag(opIndex, "UNKNOWN_OP", `Unknown op: ${String(_never)}`);
    }
  }
}

function validateTransferIndices(
  stopCount: number,
  transfers: ProposeStops["transfers"] | undefined
): PatchResult | null {
  if (!transfers?.length) return null;
  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i]!;
    if (
      transfer.fromStopIndex !== -1 &&
      (transfer.fromStopIndex < 0 || transfer.fromStopIndex >= stopCount)
    ) {
      return failDiag(
        i,
        "TRANSFER_INDEX_OOR",
        `transfers[${i}].fromStopIndex ${transfer.fromStopIndex} is out of range (${stopCount} stops; use -1 for arrival).`
      );
    }
    if (transfer.toStopIndex < 0 || transfer.toStopIndex > stopCount) {
      return failDiag(
        i,
        "TRANSFER_INDEX_OOR",
        `transfers[${i}].toStopIndex ${transfer.toStopIndex} is out of range (0..${stopCount}; ${stopCount} = departure).`
      );
    }
  }
  return null;
}

export function materializeStops(
  title: string,
  draft: ProposeStops,
  binder?: TurnEntityBinder,
  options: PatchVerifyOptions = {}
): PatchResult {
  const fitted = fitStopsToTripLength(
    draft.stops.map((stop) => ({
      placeId: stop.placeId,
      placeName: stop.placeName?.trim() || "Place",
      nights: stop.nights,
    })),
    claimedTripDays(title, draft),
    options.placePolicies
  );
  if (!fitted.ok) {
    return failDiag(0, "TRIP_LENGTH", fitted.error);
  }
  const stops = fitted.stops;
  const transferFail = validateTransferIndices(stops.length, draft.transfers);
  if (transferFail) return transferFail;

  const pending: ClientItinerary = ensureArtifactIds({
    title: draft.title?.trim() || title,
    summary: draft.summary ?? "",
    durationDays: calendarDayCount(stops),
    startDate: draft.startDate,
    version: 1,
    schemaVersion: 2,
    stops,
    days: [],
    transfers: draft.transfers ?? [],
    workflow: { stage: "stops", approved: {} },
  });
  pending.days = stubDaysForStops(pending.stops);
  const bound = bindAndKeep(pending, binder, "stop");
  if (!bound.ok) return bound;
  const next = withWorkflow(
    ensureArtifactIds({
      ...bound.itinerary,
      durationDays: calendarDayCount(bound.itinerary.stops),
      days:
        bound.itinerary.days.length > 0
          ? bound.itinerary.days
          : stubDaysForStops(bound.itinerary.stops),
      version: 1,
      schemaVersion: 2,
    }),
    { stage: "stops", approved: {} }
  );
  return verifyHard(next, options) ?? { ok: true, itinerary: next };
}

/**
 * Fit overnight totals to an N-day brief (N−1 nights).
 * Prefer graph recommended nights; never autofit outside graph min–max when known.
 */
export function fitStopsToTripLength(
  stops: ClientItineraryStop[],
  claimedDays: number | null,
  placePolicies?: PlacePolicyMap
): { ok: true; stops: ClientItineraryStop[] } | { ok: false; error: string } {
  const next = stops.map((stop) => {
    const policy = policyForStop(placePolicies, stop.placeId);
    const floor = stayFloor(policy);
    const ceiling = stayCeiling(policy);
    const nights = Math.min(ceiling, Math.max(floor, stop.nights));
    return { ...stop, nights };
  });

  if (claimedDays == null) {
    return { ok: true, stops: next };
  }

  const targetNights = Math.max(1, claimedDays - 1);
  const maxAutofit = 4;

  for (const stop of next) {
    const policy = policyForStop(placePolicies, stop.placeId);
    const floor = stayFloor(policy);
    const ceiling = stayCeiling(policy);
    if (stop.nights < floor) stop.nights = floor;
    if (stop.nights > ceiling) stop.nights = ceiling;
  }

  let nights = overnightTotal(next);
  let delta = targetNights - nights;

  if (delta === 0) {
    return { ok: true, stops: next };
  }

  if (delta > 0 && delta <= maxAutofit) {
    const added = addNightsWithinBands(next, delta, placePolicies);
    if (added === delta) {
      return { ok: true, stops: next };
    }
    delta = targetNights - overnightTotal(next);
  }

  if (delta < 0 && delta >= -maxAutofit) {
    const removed = removeNightsWithinBands(next, -delta, placePolicies);
    if (removed === -delta || overnightTotal(next) === targetNights) {
      return { ok: true, stops: next };
    }
    delta = targetNights - overnightTotal(next);
  }

  nights = overnightTotal(next);
  if (nights === targetNights) {
    return { ok: true, stops: next };
  }

  if (nights < targetNights) {
    return {
      ok: false,
      error: `This is a ${claimedDays}-day brief (${targetNights} nights). Stops total ${nights} after respecting graph stay-min/max — add a destination or lengthen a stop that still has headroom under stay-max. Do not exceed any place's stay-max.`,
    };
  }

  return {
    ok: false,
    error: `This is a ${claimedDays}-day brief (${targetNights} nights + departure morning). Stops total ${nights} after respecting graph stay-min — trim a stop or shorten one still above stay-min rather than going below min.`,
  };
}

function addNightsWithinBands(
  stops: ClientItineraryStop[],
  extra: number,
  placePolicies?: PlacePolicyMap
): number {
  let remaining = extra;
  let cursor = stops.length - 1;
  let guard = 0;
  while (remaining > 0 && guard < 80) {
    guard += 1;

    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < stops.length; k++) {
      const i = (cursor - k + stops.length) % stops.length;
      const policy = policyForStop(placePolicies, stops[i].placeId);
      const ceiling = stayCeiling(policy);
      if (stops[i].nights >= ceiling) continue;
      const rec = policy?.stayRecommendedNights;
      if (rec != null && stops[i].nights < rec) {
        const score = (rec - stops[i].nights) * 100 - k;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }

    if (best < 0) {
      for (let k = 0; k < stops.length; k++) {
        const i = (cursor - k + stops.length) % stops.length;
        const policy = policyForStop(placePolicies, stops[i].placeId);
        if (stops[i].nights < stayCeiling(policy)) {
          best = i;
          break;
        }
      }
    }

    if (best < 0) break;
    stops[best].nights += 1;
    remaining -= 1;
    cursor = (best - 1 + stops.length) % stops.length;
  }
  return extra - remaining;
}

function removeNightsWithinBands(
  stops: ClientItineraryStop[],
  remove: number,
  placePolicies?: PlacePolicyMap
): number {
  let removed = 0;
  let cursor = stops.length - 1;
  let guard = 0;
  while (removed < remove && guard < 80) {
    guard += 1;

    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < stops.length; k++) {
      const i = (cursor - k + stops.length) % stops.length;
      const policy = policyForStop(placePolicies, stops[i].placeId);
      const floor = stayFloor(policy);
      if (stops[i].nights <= floor) continue;
      const rec = policy?.stayRecommendedNights;
      if (rec != null && stops[i].nights > rec) {
        const score = (stops[i].nights - rec) * 100 - k;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    }

    if (best < 0) {
      for (let k = 0; k < stops.length; k++) {
        const i = (cursor - k + stops.length) % stops.length;
        const policy = policyForStop(placePolicies, stops[i].placeId);
        if (stops[i].nights > stayFloor(policy)) {
          best = i;
          break;
        }
      }
    }

    if (best < 0) break;
    stops[best].nights -= 1;
    removed += 1;
    cursor = (best - 1 + stops.length) % stops.length;
  }
  return removed;
}

function claimedTripDays(title: string, draft: ProposeStops): number | null {
  const text = `${title} ${draft.title ?? ""} ${draft.summary ?? ""}`;
  const named = text.match(/\b(\d{1,2})\s*[-–]?\s*days?\b/i);
  if (named) {
    return Number(named[1]);
  }
  return draft.durationDays ?? null;
}

export function patchNeedsAllowlist(_patch: ItineraryPatch): boolean {
  return false;
}
