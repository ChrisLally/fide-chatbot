import { z } from "zod";
import type { TurnEntityBinder } from "./entity-binder";
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
  calendarDayCount,
  ensureWorkflow,
  overnightTotal,
  stubDaysForStops,
  syncDaysToNights,
  withWorkflow,
} from "./stages";

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
  routeId: z.string().optional(),
  fromPlaceName: z.string().optional(),
  toPlaceName: z.string().optional(),
});

export const itineraryPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("setStopHotel"),
    stopIndex: z.number().int().min(0),
    hotelId: fideIdSchema,
    hotelName: z.string().optional(),
  }),
  z.object({
    op: z.literal("proposeStay"),
    stopIndex: z.number().int().min(0),
    hotelId: fideIdSchema,
    hotelName: z.string().optional(),
  }),
  z.object({
    op: z.literal("setStopNights"),
    stopIndex: z.number().int().min(0),
    nights: z.number().int().min(1),
  }),
  z.object({
    op: z.literal("addStop"),
    afterIndex: z.number().int().min(-1),
    placeId: fideIdSchema,
    placeName: z.string().min(1).optional(),
    nights: z.number().int().min(1),
  }),
  z.object({
    op: z.literal("removeStop"),
    stopIndex: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("replaceStopPlace"),
    stopIndex: z.number().int().min(0),
    placeId: fideIdSchema,
    placeName: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("setDayBlocks"),
    dayNumber: z.number().int().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    blocks: z.array(blockProposeSchema).max(4),
  }),
  z.object({
    op: z.literal("proposeDay"),
    dayNumber: z.number().int().min(1),
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
    routeId: z.string().optional(),
    fromPlaceName: z.string().optional(),
    toPlaceName: z.string().optional(),
  }),
  z.object({
    op: z.literal("setDayCopy"),
    dayNumber: z.number().int().min(1),
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
]);

export type ItineraryPatch = z.infer<typeof itineraryPatchSchema>;

export type PatchResult =
  | { ok: true; itinerary: ClientItinerary; omitted: string[] }
  | { ok: false; error: string; omitted?: string[] };

export const proposeRouteSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
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

export type ProposeRoute = z.infer<typeof proposeRouteSchema>;

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

function parseKeep(itinerary: ClientItinerary, omitted: string[] = []): PatchResult {
  const parsed = clientItinerarySchema.safeParse({
    ...itinerary,
    durationDays: nightsSum(itinerary.stops),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message, omitted };
  }
  return { ok: true, itinerary: parsed.data, omitted };
}

function kindFail(id: string, kind: PeekEntityKind): PatchResult | null {
  if (fideKindOk(id, kind)) return null;
  const got = fideIdEntityType(id) ?? "unknown";
  return {
    ok: false,
    error: `${kind} id must be a typed Fide id (hotel=0x11, place=0x40, activity=0x31). Got type ${got} for ${id}.`,
  };
}

function bindAndKeep(
  itinerary: ClientItinerary,
  binder: TurnEntityBinder | undefined,
  requiredHint: string
): PatchResult {
  if (!binder) {
    const parsed = clientItinerarySchema.safeParse(itinerary);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }
    return { ok: true, itinerary: parsed.data, omitted: [] };
  }

  const { itinerary: bound, omitted } = binder.bind(itinerary);
  if (bound.stops.length === 0) {
    return {
      ok: false,
      error: `Bind dropped every stop. run_view places-search first. (${omitted.join("; ") || requiredHint})`,
      omitted,
    };
  }
  if (omitted.some((row) => row.toLowerCase().includes(requiredHint.toLowerCase()) || row.includes(requiredHint))) {
    return {
      ok: false,
      error: `Not on this turn's allowlist: ${omitted.join("; ")}. run_view the matching inventory view and retry with the exact name.`,
      omitted,
    };
  }

  const parsed = clientItinerarySchema.safeParse({
    ...bound,
    durationDays: nightsSum(bound.stops),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message, omitted };
  }
  return { ok: true, itinerary: parsed.data, omitted };
}

function stageBlocksOp(
  stage: ReturnType<typeof ensureWorkflow>["stage"],
  op: string
): PatchResult | null {
  const hotelOps = op === "setStopHotel" || op === "proposeStay";
  const dayOps = op === "setDayBlocks" || op === "proposeDay";
  if (stage === "route" && (hotelOps || dayOps)) {
    return {
      ok: false,
      error:
        "Route is not approved yet. Stop. Do not add hotels or day activities, and do not call createDocument again. Wait for the human to click Approve Route.",
    };
  }
  if (stage === "stays" && dayOps) {
    return {
      ok: false,
      error:
        "Stays are not approved yet. Only set hotels (setStopHotel). Wait for Approve Stays before day activities.",
    };
  }
  return null;
}

function verifyHard(itinerary: ClientItinerary): PatchResult | null {
  const stage = ensureWorkflow(itinerary).stage;
  const verified = verifyItineraryStage(itinerary, stage);
  const blockers = verified.errors.filter(
    (error) =>
      /Cairns and Port Douglas/i.test(error) ||
      /Townsville|Magnetic/i.test(error) ||
      /stay-min/i.test(error) ||
      /exceeds 3\.5h/i.test(error)
  );
  if (blockers.length > 0) {
    return { ok: false, error: blockers.join("; ") };
  }
  return null;
}

export function applyItineraryPatch(
  previous: ClientItinerary,
  patch: ItineraryPatch,
  binder?: TurnEntityBinder
): PatchResult {
  const itinerary = structuredClone(previous) as ClientItinerary;
  const workflow = ensureWorkflow(itinerary);
  itinerary.workflow = workflow;
  itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
  itinerary.durationDays = nightsSum(itinerary.stops);

  const blocked = stageBlocksOp(workflow.stage, patch.op);
  if (blocked) return blocked;

  const failIndex = (index: number, noun: string): PatchResult | null => {
    if (index < 0 || index >= itinerary.stops.length) {
      return { ok: false, error: `${noun} ${index} is out of range (${itinerary.stops.length} stops).` };
    }
    return null;
  };

  switch (patch.op) {
    case "setStopHotel":
    case "proposeStay": {
      const bad = failIndex(patch.stopIndex, "stopIndex");
      if (bad) return bad;
      const kindBad = kindFail(patch.hotelId, "hotel");
      if (kindBad) return kindBad;
      const hotelId = asDid(patch.hotelId);
      itinerary.stops[patch.stopIndex] = {
        ...itinerary.stops[patch.stopIndex],
        hotelId,
        hotelName: labelFromBinder(
          binder,
          hotelId,
          "hotel",
          patch.hotelName || itinerary.stops[patch.stopIndex].hotelName || "Hotel"
        ),
      };
      return parseKeep(itinerary);
    }
    case "setStopNights": {
      const bad = failIndex(patch.stopIndex, "stopIndex");
      if (bad) return bad;
      itinerary.stops[patch.stopIndex] = {
        ...itinerary.stops[patch.stopIndex],
        nights: patch.nights,
      };
      itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
      itinerary.durationDays = nightsSum(itinerary.stops);
      return { ok: true, itinerary, omitted: [] };
    }
    case "addStop": {
      if (patch.afterIndex < -1 || patch.afterIndex >= itinerary.stops.length) {
        return { ok: false, error: `afterIndex ${patch.afterIndex} is out of range.` };
      }
      const insertAt = patch.afterIndex + 1;
      const oldCount = itinerary.stops.length;
      const draftStop: ClientItineraryStop = {
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
      const kindBad = kindFail(patch.placeId, "destination");
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
      return verifyHard(itinerary) ?? parseKeep(itinerary);
    }
    case "removeStop": {
      const bad = failIndex(patch.stopIndex, "stopIndex");
      if (bad) return bad;
      if (itinerary.stops.length === 1) {
        return { ok: false, error: "Cannot remove the last overnight stop." };
      }
      const oldCount = itinerary.stops.length;
      const removed = patch.stopIndex;
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
      return verifyHard(itinerary) ?? { ok: true, itinerary, omitted: [] };
    }
    case "replaceStopPlace": {
      const bad = failIndex(patch.stopIndex, "stopIndex");
      if (bad) return bad;
      const kindBad = kindFail(patch.placeId, "destination");
      if (kindBad) return kindBad;
      const placeId = asDid(patch.placeId);
      itinerary.stops[patch.stopIndex] = {
        placeId,
        placeName: labelFromBinder(
          binder,
          placeId,
          "destination",
          patch.placeName || itinerary.stops[patch.stopIndex].placeName
        ),
        nights: itinerary.stops[patch.stopIndex].nights,
        hotelId: undefined,
        hotelName: undefined,
      };
      itinerary.days = syncDaysToNights(itinerary.stops, itinerary.days);
      return verifyHard(itinerary) ?? parseKeep(itinerary);
    }
    case "setDayBlocks":
    case "proposeDay": {
      const day = itinerary.days.find((row) => row.dayNumber === patch.dayNumber);
      if (!day) {
        return {
          ok: false,
          error: `No day ${patch.dayNumber}. This trip has days 1–${itinerary.days.at(-1)?.dayNumber ?? 0} (${itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0)} nights + departure morning).`,
        };
      }
      for (const block of patch.blocks) {
        const kindBad = kindFail(block.entityId, block.entityKind);
        if (kindBad) return kindBad;
      }
      const nextDay: ClientItineraryDay = {
        ...day,
        title: patch.title?.trim() || day.title,
        description: patch.description ?? day.description,
        blocks: patch.blocks.map((block) => pendingBlock(block, binder)),
      };
      itinerary.days = itinerary.days.map((row) =>
        row.dayNumber === patch.dayNumber ? nextDay : row
      );
      return parseKeep(itinerary);
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
        routeId: patch.routeId,
        fromPlaceName: patch.fromPlaceName,
        toPlaceName: patch.toPlaceName,
      };
      if (existing >= 0) {
        transfers[existing] = { ...transfers[existing], ...next };
      } else {
        transfers.push(next);
      }
      itinerary.transfers = transfers;
      return verifyHard(itinerary) ?? { ok: true, itinerary, omitted: [] };
    }
    case "setDayCopy": {
      const day = itinerary.days.find((row) => row.dayNumber === patch.dayNumber);
      if (!day) {
        return {
          ok: false,
          error: `No day ${patch.dayNumber}. This trip has days 1–${itinerary.days.at(-1)?.dayNumber ?? 0} (${itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0)} nights + departure morning).`,
        };
      }
      itinerary.days = itinerary.days.map((row) =>
        row.dayNumber === patch.dayNumber
          ? {
              ...row,
              title: patch.title?.trim() || row.title,
              description: patch.description ?? row.description,
              transitNote: patch.transitNote ?? row.transitNote,
            }
          : row
      );
      return { ok: true, itinerary, omitted: [] };
    }
    case "setSummary":
      itinerary.summary = patch.summary;
      return { ok: true, itinerary, omitted: [] };
    case "setTitle":
      itinerary.title = patch.title;
      return { ok: true, itinerary, omitted: [] };
    default: {
      const _never: never = patch;
      return { ok: false, error: `Unknown op: ${String(_never)}` };
    }
  }
}

export function materializeRoute(
  title: string,
  draft: ProposeRoute,
  binder?: TurnEntityBinder
): PatchResult {
  const fitted = fitStopsToTripLength(
    draft.stops.map((stop) => ({
      placeId: stop.placeId,
      placeName: stop.placeName?.trim() || "Place",
      nights: stop.nights,
    })),
    claimedTripDays(title, draft)
  );
  if (!fitted.ok) {
    return { ok: false, error: fitted.error };
  }
  const stops = fitted.stops;

  const pending: ClientItinerary = {
    title: draft.title?.trim() || title,
    summary: draft.summary ?? "",
    durationDays: calendarDayCount(stops),
    stops,
    days: [],
    transfers: draft.transfers ?? [],
    workflow: { stage: "route", approved: {} },
  };
  pending.days = stubDaysForStops(pending.stops);
  const bound = bindAndKeep(pending, binder, "stop");
  if (!bound.ok) return bound;
  const next = withWorkflow(
    {
      ...bound.itinerary,
      durationDays: calendarDayCount(bound.itinerary.stops),
      days:
        bound.itinerary.days.length > 0
          ? bound.itinerary.days
          : stubDaysForStops(bound.itinerary.stops),
    },
    { stage: "route", approved: {} }
  );
  return verifyHard(next) ?? { ok: true, itinerary: next, omitted: bound.omitted };
}

/** N-day trip → N−1 hotel nights so the last calendar card is departure morning. */
export function fitStopsToTripLength(
  stops: ClientItineraryStop[],
  claimedDays: number | null
): { ok: true; stops: ClientItineraryStop[] } | { ok: false; error: string } {
  const next = stops.map((stop) => ({ ...stop }));
  if (claimedDays == null) {
    return { ok: true, stops: next };
  }

  const nights = overnightTotal(next);
  const targetNights = Math.max(1, claimedDays - 1);
  const delta = targetNights - nights;
  const maxAutofit = 4;

  if (delta === 0) {
    return { ok: true, stops: next };
  }

  if (delta > 0 && delta <= maxAutofit) {
    addNightsFromEnd(next, delta);
    return { ok: true, stops: next };
  }

  if (delta < 0 && delta >= -maxAutofit) {
    const removed = removeNightsFromEnd(next, -delta);
    if (removed === -delta) {
      return { ok: true, stops: next };
    }
  }

  if (nights < targetNights) {
    return {
      ok: false,
      error: `This is a ${claimedDays}-day brief. Allocate ${targetNights} overnight nights across real stops now (you passed ${nights}). Do not add a filler city and do not ask which destination should soak the rest.`,
    };
  }

  return {
    ok: false,
    error: `This is a ${claimedDays}-day brief (${targetNights} nights + departure morning). You passed ${nights} nights — trim a stop rather than stretching the calendar.`,
  };
}

function addNightsFromEnd(stops: ClientItineraryStop[], extra: number): void {
  let index = stops.length - 1;
  let guard = 0;
  while (extra > 0 && guard < 80) {
    if (stops[index].nights < 6) {
      stops[index].nights += 1;
      extra -= 1;
    }
    index = (index - 1 + stops.length) % stops.length;
    guard += 1;
  }
}

function removeNightsFromEnd(stops: ClientItineraryStop[], remove: number): number {
  let index = stops.length - 1;
  let removed = 0;
  let guard = 0;
  while (removed < remove && guard < 80) {
    if (stops[index].nights > 1) {
      stops[index].nights -= 1;
      removed += 1;
    }
    index = (index - 1 + stops.length) % stops.length;
    guard += 1;
  }
  return removed;
}

function claimedTripDays(title: string, draft: ProposeRoute): number | null {
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
