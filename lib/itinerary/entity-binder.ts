import { rowsFromToolResult } from "@/lib/fide/tool-rows";
import { knownFideKind, rememberFideKind } from "./kind-cache";
import {
  type ClientItinerary,
  type DayBlock,
  fideIdHex,
  type PeekEntityKind,
} from "./schema";

export type AllowlistEntity = {
  fideId: string;
  name: string;
  kind: PeekEntityKind;
  source?: string;
};

/** Optional WM existence gate — kind is still validated from hex. */
export type ExistCheckFn = (id: string, kind: PeekEntityKind) => boolean;

export type TurnEntityBinder = {
  add: (entity: AllowlistEntity) => void;
  addMany: (entities: AllowlistEntity[]) => void;
  harvestRunView: (viewKey: string, output: unknown) => number;
  list: () => AllowlistEntity[];
  contextForPrompt: () => string;
  setExistCheck: (fn: ExistCheckFn | undefined) => void;
  bind: (itinerary: ClientItinerary) => {
    itinerary: ClientItinerary;
    bound: number;
    omitted: string[];
  };
};

const FIDE_ID_RE = /did:fide:0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{40}/g;

function normalizeDid(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("did:fide:")) {
    return trimmed;
  }
  if (fideIdHex(trimmed)) {
    return `did:fide:${fideIdHex(trimmed)}`;
  }
  return trimmed;
}

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function kindFromViewKey(viewKey: string): PeekEntityKind | null {
  const key = viewKey.toLowerCase();
  if (key.includes("restaurant")) return null;
  if (key.includes("hotel") || key.includes("venue")) return "hotel";
  if (key.includes("activity")) return "activity";
  if (key.includes("attraction")) return "attraction";
  if (key.includes("place") || key.includes("destination"))
    return "destination";
  return null;
}

function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * Harvest allowlist entities from a run_view result's rows (structuredContent).
 * Rendered text is never parsed: a result without rows harvests nothing.
 */
export function harvestEntitiesFromRunView(
  viewKey: string,
  output: unknown
): AllowlistEntity[] {
  // Brochure templates / sameAs dumps must not seed bindable stop entities.
  const key = viewKey.toLowerCase();
  if (key.includes("itinerar") || key.includes("same-as")) {
    return [];
  }
  const rows = rowsFromToolResult(output);
  if (!rows) {
    return [];
  }

  const defaultKind = kindFromViewKey(viewKey);
  const entities: AllowlistEntity[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const fideRaw = firstString(row, ["fide_id", "fideId"]);
    if (!fideIdHex(fideRaw)) {
      continue;
    }
    const fideId = normalizeDid(fideRaw);
    const name = firstString(row, [
      "place_name",
      "place",
      "hotel_name",
      "hotel",
      "activity",
      "attraction",
      "restaurant",
      "event",
      "name",
    ]);
    if (!name) {
      continue;
    }
    const kind = defaultKind ?? knownFideKind(fideId);
    if (!kind) {
      continue;
    }
    rememberFideKind(fideId, kind);

    const entityKey = `${kind}:${fideId}`;
    if (seen.has(entityKey)) {
      continue;
    }
    seen.add(entityKey);
    entities.push({ fideId, name, kind, source: viewKey });
  }

  return entities;
}

function shortLabel(fideId: string): string {
  const hex = fideIdHex(fideId);
  return hex ? hex.slice(0, 10) : fideId.slice(0, 16);
}

function kindMatchesFideId(kind: PeekEntityKind, id: string): boolean {
  return knownFideKind(id) === kind;
}

/**
 * Trust an already-typed Fide id. Harvest allowlist supplies labels only —
 * invent-id defense is kind-from-hex, not harvest membership.
 */
function acceptSuppliedFideId(
  id: string | undefined,
  name: string,
  kind: PeekEntityKind
): AllowlistEntity | null {
  if (!id || !fideIdHex(id) || !kindMatchesFideId(kind, id)) {
    return null;
  }
  return {
    fideId: normalizeDid(id),
    name: name.trim() || shortLabel(id),
    kind,
  };
}

function findById(
  entities: AllowlistEntity[],
  id: string,
  kind?: PeekEntityKind
): AllowlistEntity | null {
  const normalized = normalizeDid(id);
  return (
    entities.find(
      (e) => e.fideId === normalized && (kind == null || e.kind === kind)
    ) ?? null
  );
}

/**
 * Resolve by Fide id + kind from hex. Harvest list is labels only.
 * Optional existCheck rejects ids the WM says do not exist.
 */
function resolveById(
  entities: AllowlistEntity[],
  id: string | undefined,
  name: string,
  kind: PeekEntityKind,
  existCheck?: (id: string, kind: PeekEntityKind) => boolean
): AllowlistEntity | null {
  const accepted = acceptSuppliedFideId(id, name, kind);
  if (!accepted) return null;
  if (existCheck && !existCheck(accepted.fideId, kind)) {
    return null;
  }
  const harvested =
    findById(entities, accepted.fideId) ??
    findById(entities, accepted.fideId, kind);
  return {
    fideId: accepted.fideId,
    name: harvested?.name?.trim() || accepted.name,
    kind,
  };
}

/**
 * Bind itinerary entities by Fide id kind (hex) only.
 * Display names / harvest are labels; a wrong name never overrides placeId/hotelId/entityId.
 * Harvest is NOT an invent-id gate.
 */
export function bindItineraryToAllowlist(
  itinerary: ClientItinerary,
  entities: AllowlistEntity[],
  options?: { existCheck?: ExistCheckFn }
): { itinerary: ClientItinerary; bound: number; omitted: string[] } {
  const omitted: string[] = [];
  let bound = 0;
  const existCheck = options?.existCheck;

  const stops = itinerary.stops.flatMap((stop, index) => {
    const place = resolveById(
      entities,
      stop.placeId,
      stop.placeName,
      "destination",
      existCheck
    );
    if (!place) {
      omitted.push(`stop ${index + 1} "${stop.placeName}"`);
      return [];
    }
    bound += 1;

    let hotelId = stop.hotelId;
    let hotelName = stop.hotelName;
    if (hotelName || hotelId) {
      const hotel = resolveById(
        entities,
        hotelId,
        hotelName || "",
        "hotel",
        existCheck
      );
      if (hotel) {
        hotelId = hotel.fideId;
        hotelName = hotel.name;
        bound += 1;
      } else {
        omitted.push(
          `hotel on stop ${index + 1} "${hotelName || hotelId || "unknown"}"`
        );
        hotelId = undefined;
        hotelName = undefined;
      }
    }

    return [
      {
        stopId: stop.stopId,
        placeId: place.fideId,
        placeName: place.name,
        nights: stop.nights < 1 ? 1 : stop.nights,
        ...(hotelId && hotelName ? { hotelId, hotelName } : {}),
      },
    ];
  });

  // Remap days when stops dropped
  const keptOldIndexes: number[] = [];
  itinerary.stops.forEach((stop, index) => {
    const place = resolveById(
      entities,
      stop.placeId,
      stop.placeName,
      "destination",
      existCheck
    );
    if (place) {
      keptOldIndexes.push(index);
    }
  });
  const indexMap = new Map(
    keptOldIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex])
  );

  const days = itinerary.days
    .filter((day) => indexMap.has(day.stopIndex))
    .map((day) => {
      const blocks: DayBlock[] = [];
      for (const block of day.blocks ?? []) {
        const kind = block.entityKind;
        const matched = resolveById(
          entities,
          block.entityId,
          block.entityName || block.title || "",
          kind,
          existCheck
        );
        if (!matched) {
          omitted.push(
            `day ${day.dayNumber} block "${block.entityName || block.title || block.entityId}"`
          );
          continue;
        }
        bound += 1;
        blocks.push({
          when: block.when,
          title: block.title,
          note: block.note,
          entityId: matched.fideId,
          entityName: matched.name,
          entityKind: matched.kind,
        });
      }
      const newStopIndex = indexMap.get(day.stopIndex) ?? 0;
      return {
        dayNumber: day.dayNumber,
        dayId: day.dayId,
        stopIndex: newStopIndex,
        stopId: stops[newStopIndex]?.stopId ?? day.stopId,
        title: day.title,
        description: day.description ?? "",
        transitNote: day.transitNote,
        blocks,
        ...(day.stale ? { stale: true as const } : {}),
      };
    });

  return {
    itinerary: {
      ...itinerary,
      stops,
      days,
      transfers: itinerary.transfers ?? [],
      durationDays: Math.max(itinerary.durationDays, days.length || 1),
    },
    bound,
    omitted,
  };
}

export function formatAllowlistForPrompt(entities: AllowlistEntity[]): string {
  if (entities.length === 0) {
    return "(empty allowlist — run_view inventory first; do not invent entities)";
  }
  const byKind = new Map<PeekEntityKind, AllowlistEntity[]>();
  for (const entity of entities) {
    const list = byKind.get(entity.kind) ?? [];
    list.push(entity);
    byKind.set(entity.kind, list);
  }
  const lines: string[] = [
    "ALLOWED ENTITIES (use exact did:fide:0x… ids from run_view; names are labels only):",
  ];
  for (const kind of [
    "destination",
    "hotel",
    "activity",
    "attraction",
  ] as const) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    lines.push(`\n## ${kind}`);
    for (const entity of list.slice(0, 80)) {
      lines.push(`- ${entity.name} — ${entity.fideId}`);
    }
  }
  return lines.join("\n");
}

export function createTurnEntityBinder(options?: {
  existCheck?: ExistCheckFn;
}): TurnEntityBinder {
  const entities: AllowlistEntity[] = [];
  const seen = new Set<string>();
  let existCheck = options?.existCheck;

  const add = (entity: AllowlistEntity) => {
    const fideId = normalizeDid(entity.fideId);
    if (!fideIdHex(fideId) || !entity.name.trim()) return;
    const key = `${entity.kind}:${fideId}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({
      ...entity,
      fideId,
      name: entity.name.trim(),
    });
  };

  return {
    add,
    addMany: (items) => {
      for (const item of items) add(item);
    },
    harvestRunView: (viewKey, output) => {
      const harvested = harvestEntitiesFromRunView(viewKey, output);
      for (const entity of harvested) add(entity);
      return harvested.length;
    },
    list: () => [...entities],
    contextForPrompt: () => formatAllowlistForPrompt(entities),
    setExistCheck: (fn) => {
      existCheck = fn;
    },
    bind: (itinerary) =>
      bindItineraryToAllowlist(itinerary, entities, { existCheck }),
  };
}
