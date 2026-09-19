import { z } from "zod";
import { fideFingerprint } from "./sha256";
import { ensureWorkflow } from "./stages";

export const dayWhenSchema = z.enum([
  "morning",
  "afternoon",
  "evening",
  "flexible",
]);

/**
 * Opaque world-model entity id.
 * Prefer `did:fide:0x…` from inventory views. Member ids use reference type `20`
 * (IRI/NetworkResource); accepted sameAs clusters use statement-anchored `00`.
 * Never regex Catalina URL shapes for identity.
 */
const entityIdSchema = z.string().min(1);

const CATALINA_IRI_PREFIX = "https://www.catalinaquest.ai/#";

export type PeekEntityKind =
  | "hotel"
  | "activity"
  | "attraction"
  | "destination";

/** Peek targets in the itinerary canvas (includes transport legs). */
export type ItineraryPeekKind = PeekEntityKind | "transportation";

type GraphKindKey = "place" | "hotel" | "activity" | "attraction";

/**
 * Coerce bare slugs / fragments into the Catalina inventory id form peeks still
 * query with. Leaves http(s) and did:fide ids untouched.
 */
export function coerceGraphEntityId(
  id: string,
  kind: PeekEntityKind | GraphKindKey
): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("did:fide:")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("#")) {
    return `https://www.catalinaquest.ai/${trimmed}`;
  }

  let key: GraphKindKey = "place";
  if (kind === "destination") {
    key = "place";
  } else if (
    kind === "place" ||
    kind === "hotel" ||
    kind === "activity" ||
    kind === "attraction"
  ) {
    key = kind;
  }

  const slug = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
  if (!slug) {
    return trimmed;
  }
  if (trimmed.includes("=")) {
    return `${CATALINA_IRI_PREFIX}${trimmed.replace(/^#/, "")}`;
  }
  return `${CATALINA_IRI_PREFIX}${key}=${slug}`;
}

const FIDE_DID_PREFIX = "did:fide:";
const FIDE_HEX_RE = /^0x[0-9a-fA-F]+$/;

/**
 * Extract the `0x…` Fide id body from a full `did:fide:0x…` or bare `0x…`.
 * Returns null when the value is not a Fide id (e.g. Catalina IRI / bare slug).
 */
export function fideIdHex(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }
  const body = trimmed.startsWith(FIDE_DID_PREFIX)
    ? trimmed.slice(FIDE_DID_PREFIX.length)
    : trimmed;
  return FIDE_HEX_RE.test(body) ? body : null;
}

/** Entity type code after `0x` (e.g. `11` org, `31` concept, `40` place). */
export function fideIdEntityType(id: string): string | null {
  const hex = fideIdHex(id);
  if (!hex || hex.length < 6) {
    return null;
  }
  return hex.slice(2, 4).toLowerCase();
}

/**
 * Reference type after entity type: `20` = IRI/NetworkResource member,
 * `00` = statement-anchored cluster/profile (accepted sameAs).
 */
export function fideIdReferenceType(id: string): string | null {
  const hex = fideIdHex(id);
  if (!hex || hex.length < 6) {
    return null;
  }
  return hex.slice(4, 6).toLowerCase();
}

export function isClusterFideId(id: string): boolean {
  return fideIdReferenceType(id) === "00";
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  "11": "Organization",
  "31": "Concept",
  "40": "Place",
  "00": "Protocol",
  a0: "Literal",
};

const REFERENCE_TYPE_LABELS: Record<string, string> = {
  "20": "NetworkResource",
  "00": "Statement",
  a0: "Literal",
};

export function fideIdEntityTypeLabel(id: string): string | null {
  const code = fideIdEntityType(id);
  if (!code) return null;
  return ENTITY_TYPE_LABELS[code] ?? code;
}

export function fideIdReferenceTypeLabel(id: string): string | null {
  const code = fideIdReferenceType(id);
  if (!code) return null;
  return REFERENCE_TYPE_LABELS[code] ?? code;
}

/**
 * Peek/kind hint from entity type — works for both member (`20`) and cluster (`00`).
 * Concept (`31`) defaults to activity; view harvest may refine to attraction.
 */
export function kindFromFideId(id: string): PeekEntityKind | null {
  const entityType = fideIdEntityType(id);
  if (entityType === "11") return "hotel";
  if (entityType === "40") return "destination";
  if (entityType === "31") return "activity";
  return null;
}

/**
 * Extract the 36-hex fingerprint from a Fide id (`did:fide:0xTTSS` + fingerprint).
 * For member ids this is the NetworkResource fingerprint; for cluster ids (`SS=00`)
 * it is the accepted sameAs anchor statement fingerprint.
 */
export function subjectFingerprintFromFideId(id: string): string | null {
  const hex = fideIdHex(id);
  if (!hex) {
    return null;
  }
  // body after 0x: entity(2) + reference(2) + fingerprint(36)
  const body = hex.slice(2);
  if (body.length < 40) {
    return null;
  }
  return body.slice(4);
}

/**
 * Compact Fide id chip: first 8 chars of `0x…` then ellipsis.
 * Empty when the value is not a Fide id — do not fake IRI slugs as ids.
 */
export function shortEntityId(id: string, chars = 8): string {
  const hex = fideIdHex(id);
  if (!hex) {
    return "";
  }
  return hex.length <= chars ? hex : `${hex.slice(0, chars)}…`;
}

/** Entity-type hex codes used when minting Catalina member Fide ids. */
const FIDE_TYPE_CODE: Record<"place" | "hotel" | "activity" | "attraction", string> = {
  place: "40",
  hotel: "11",
  activity: "31",
  attraction: "31",
};

function typeKeyFromKind(kind: PeekEntityKind | GraphKindKey): keyof typeof FIDE_TYPE_CODE {
  if (kind === "destination" || kind === "place") return "place";
  if (kind === "hotel") return "hotel";
  if (kind === "activity") return "activity";
  return "attraction";
}

/**
 * Upgrade a Catalina IRI / slug to a member Fide id (`did:fide:0x…`).
 * Already-valid Fide ids are normalized to the `did:fide:` form.
 */
export function upgradeToFideId(
  id: string,
  kind: PeekEntityKind | GraphKindKey
): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return trimmed;
  }

  const existing = fideIdHex(trimmed);
  if (existing) {
    return trimmed.startsWith(FIDE_DID_PREFIX)
      ? trimmed
      : `${FIDE_DID_PREFIX}${existing}`;
  }

  // Pending placeholders from normalize — do not mint synthetic Fide ids.
  if (trimmed.startsWith("pending:")) {
    return trimmed;
  }

  const iri = coerceGraphEntityId(trimmed, kind);
  if (!iri.startsWith("http://") && !iri.startsWith("https://")) {
    return trimmed;
  }

  const typeCode = FIDE_TYPE_CODE[typeKeyFromKind(kind)];
  return `${FIDE_DID_PREFIX}0x${typeCode}20${fideFingerprint(iri)}`;
}

/** Every day block is a world-model entity — no custom / name-only rows. */
export const dayBlockSchema = z.object({
  when: dayWhenSchema.default("flexible"),
  title: z.string().optional(),
  note: z.string().optional(),
  entityId: entityIdSchema,
  entityName: z.string().min(1),
  entityKind: z.enum(["hotel", "activity", "attraction", "destination"]),
});

export const clientItineraryStopSchema = z.object({
  placeId: entityIdSchema,
  placeName: z.string().min(1),
  nights: z.number().int().min(1),
  /** If set, must be a graph hotel id (no name-only hotels). */
  hotelId: entityIdSchema.optional(),
  hotelName: z.string().min(1).optional(),
});

/**
 * Leg before/between/after overnight stops.
 * fromStopIndex = -1 → arrival into first stop.
 * toStopIndex = stops.length → departure after last stop.
 * Otherwise fromStopIndex → toStopIndex are consecutive overnight indices.
 */
export const itineraryTransferSchema = z.object({
  fromStopIndex: z.number().int().min(-1),
  toStopIndex: z.number().int().min(0),
  /** Display label, e.g. route name from inventory. */
  label: z.string().optional(),
  mode: z.string().optional(),
  durationHours: z.number().optional(),
  note: z.string().optional(),
  /** Optional graph route id / IRI when bound from transport views. */
  routeId: z.string().optional(),
  fromPlaceName: z.string().optional(),
  toPlaceName: z.string().optional(),
  fromPlaceId: z.string().optional(),
  toPlaceId: z.string().optional(),
});

export const clientItineraryDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  stopIndex: z.number().int().min(0),
  title: z.string().min(1),
  description: z.string().default(""),
  blocks: z.array(dayBlockSchema).optional(),
  /** Legacy — promoted to blocks then stripped. */
  activityIds: z.array(z.string()).optional(),
  activityNames: z.array(z.string()).optional(),
  transitNote: z.string().optional(),
});

export const itineraryStageSchema = z.enum([
  "route",
  "stays",
  "days",
  "complete",
]);

export const itineraryWorkflowSchema = z.object({
  stage: itineraryStageSchema,
  approved: z
    .object({
      route: z.string().optional(),
      stays: z.string().optional(),
      days: z.string().optional(),
    })
    .default({}),
});

export const clientItinerarySchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().default(""),
    durationDays: z.number().int().min(1),
    stops: z.array(clientItineraryStopSchema).min(1),
    /** May be empty during route stage (stubs filled server-side). */
    days: z.array(clientItineraryDaySchema).default([]),
    /** Arrival / between-stop / departure transport cards. */
    transfers: z.array(itineraryTransferSchema).default([]),
    workflow: itineraryWorkflowSchema.optional(),
  })
  .superRefine((data, ctx) => {
    data.stops.forEach((stop, index) => {
      if (stop.hotelName && !stop.hotelId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "hotelName requires hotelId (graph-only)",
          path: ["stops", index, "hotelId"],
        });
      }
    });
    data.transfers.forEach((transfer, index) => {
      if (transfer.toStopIndex > data.stops.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "toStopIndex out of range",
          path: ["transfers", index, "toStopIndex"],
        });
      }
      if (transfer.fromStopIndex >= data.stops.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "fromStopIndex out of range",
          path: ["transfers", index, "fromStopIndex"],
        });
      }
    });
  });

export type DayWhen = z.infer<typeof dayWhenSchema>;
export type DayBlock = z.infer<typeof dayBlockSchema>;
export type ClientItineraryStop = z.infer<typeof clientItineraryStopSchema>;
export type ClientItineraryDay = z.infer<typeof clientItineraryDaySchema>;
export type ItineraryTransfer = z.infer<typeof itineraryTransferSchema>;
export type ClientItinerary = z.infer<typeof clientItinerarySchema>;

/** Infer kind from Catalina IRI fragments when present; otherwise null. */
export function kindFromEntityId(id: string): PeekEntityKind | null {
  if (id.includes("#hotel=")) return "hotel";
  if (id.includes("#activity=")) return "activity";
  if (id.includes("#attraction=")) return "attraction";
  if (id.includes("#place=")) return "destination";
  return null;
}

/** Like kindFromEntityId, but also maps `#route=` legs to transportation peeks. */
export function peekKindFromEntityId(id: string): ItineraryPeekKind | null {
  if (id.includes("#route=")) return "transportation";
  return kindFromEntityId(id);
}

/** @deprecated Use kindFromEntityId */
export const kindFromIri = kindFromEntityId;

/**
 * Graph-only hygiene:
 * - Keep stops with placeName (placeId optional until server bind)
 * - Keep blocks with entityName + entityKind (entityId optional until bind)
 * - Accept legacy *Iri field names from older drafts
 * - When `pendingNonFide`, non-Fide ids become `pending:…` for allowlist bind
 * - Otherwise upgrade Catalina IRIs/slugs to Fide ids (UI / offline parse)
 */
export function normalizeClientItinerary(
  data: ClientItinerary & {
    stops?: Array<
      ClientItineraryStop & {
        placeIri?: string;
        hotelIri?: string;
      }
    >;
    days?: Array<
      ClientItineraryDay & {
        activityIris?: string[];
        blocks?: Array<
          Partial<DayBlock> & {
            entityIri?: string;
            isCustom?: boolean;
          }
        >;
      }
    >;
  },
  options?: { pendingNonFide?: boolean }
): ClientItinerary {
  type DraftStop = ClientItineraryStop & {
    placeIri?: string;
    hotelIri?: string;
  };
  type DraftDay = ClientItineraryDay & {
    activityIris?: string[];
    blocks?: Array<
      Partial<DayBlock> & {
        entityIri?: string;
        isCustom?: boolean;
      }
    >;
  };

  const pendingNonFide = options?.pendingNonFide === true;
  const inputStops = (data.stops ?? []) as DraftStop[];
  const inputDays = (data.days ?? []) as DraftDay[];
  const keptIndexes: number[] = [];
  const filteredStops = inputStops.filter((stop, index) => {
    const placeId = (stop.placeId ?? stop.placeIri)?.trim();
    const hasPlace = Boolean(placeId) || Boolean(stop.placeName?.trim());
    const hasDays = inputDays.some((day) => day.stopIndex === index);
    const keep = hasPlace && (stop.nights >= 1 || hasDays);
    if (keep) {
      keptIndexes.push(index);
    }
    return keep;
  });

  if (filteredStops.length === 0) {
    return { ...data, stops: [], days: [] };
  }

  const indexMap = new Map(
    keptIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex])
  );
  const remappedDays = inputDays
    .filter((day) => indexMap.has(day.stopIndex))
    .map((day) => ({
      ...day,
      stopIndex: indexMap.get(day.stopIndex) ?? 0,
    }));

  const resolveId = (
    raw: string | undefined,
    kind: PeekEntityKind,
    pendingKey: string
  ): string | undefined => {
    const trimmed = raw?.trim();
    if (trimmed && fideIdHex(trimmed)) {
      return upgradeToFideId(trimmed, kind);
    }
    const pendingKind = kind === "destination" ? "place" : kind;
    if (pendingNonFide) {
      return pendingKey ? `pending:${pendingKind}:${pendingKey}` : undefined;
    }
    if (trimmed) {
      return upgradeToFideId(trimmed, kind);
    }
    return pendingKey ? `pending:${pendingKind}:${pendingKey}` : undefined;
  };

  const stops = filteredStops.map((stop) => {
    const rawPlace = (stop.placeId ?? stop.placeIri)?.trim();
    const placeId =
      resolveId(rawPlace, "destination", stop.placeName.trim()) ??
      `pending:place:${stop.placeName.trim()}`;

    const hotelRaw = (stop.hotelId ?? stop.hotelIri)?.trim();
    const hotelName = stop.hotelName?.trim();
    const hotelId = resolveId(hotelRaw, "hotel", hotelName || "");

    return {
      placeId,
      placeName: stop.placeName,
      nights: stop.nights < 1 ? 1 : stop.nights,
      ...(hotelId
        ? {
            hotelId,
            hotelName: hotelName || labelFromEntityId(hotelId, "Hotel"),
          }
        : {}),
    };
  });

  const days = remappedDays.map((day) => {
    const legacyActivityIds = day.activityIds ?? day.activityIris ?? [];
    const blocksSource: Array<{
      when?: DayWhen;
      title?: string;
      note?: string;
      entityId?: string;
      entityIri?: string;
      entityName?: string;
      entityKind?: PeekEntityKind;
    }> = day.blocks?.length
      ? day.blocks
      : legacyActivityIds.map((id, index) => ({
          when: "flexible" as const,
          entityId: id,
          entityName:
            day.activityNames?.[index] || labelFromEntityId(id, "Activity"),
          entityKind: (kindFromEntityId(id) ?? "activity") as PeekEntityKind,
        }));

    const blocks: DayBlock[] = [];
    for (const block of blocksSource) {
      const rawId = (block.entityId ?? block.entityIri)?.trim();
      const entityName = block.entityName?.trim() || block.title?.trim() || "";
      const kind =
        block.entityKind ??
        (rawId ? kindFromEntityId(rawId) : null) ??
        (entityName ? ("activity" as PeekEntityKind) : null);
      if (!kind || (!rawId && !entityName)) {
        continue;
      }
      const id =
        resolveId(rawId, kind, entityName) ??
        `pending:${kind}:${entityName || "entity"}`;
      blocks.push({
        when: block.when ?? "flexible",
        title: block.title,
        note: block.note,
        entityId: id,
        entityName: entityName || labelFromEntityId(id, kind),
        entityKind: kindFromEntityId(rawId || "") ?? kind,
      });
    }

    return {
      dayNumber: day.dayNumber,
      stopIndex: day.stopIndex,
      title: day.title,
      description: day.description ?? "",
      transitNote: day.transitNote,
      blocks,
    };
  });

  return {
    ...data,
    stops,
    days,
    transfers: Array.isArray(data.transfers) ? data.transfers : [],
    workflow: data.workflow,
  };
}

export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Incoming drafts may use placeId or legacy placeIri — normalize repairs. */
const clientItineraryLooseSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(""),
  durationDays: z.number().int().min(1),
  stops: z
    .array(
      z.object({
        placeId: z.string().optional(),
        placeIri: z.string().optional(),
        placeName: z.string().min(1),
        nights: z.number().int().min(0),
        hotelId: z.string().optional(),
        hotelIri: z.string().optional(),
        hotelName: z.string().optional(),
        isCustom: z.boolean().optional(),
      })
    )
    .min(1),
  days: z
    .array(
      z.object({
        dayNumber: z.number().int().min(1),
        stopIndex: z.number().int().min(0),
        title: z.string().min(1),
        description: z.string().optional().default(""),
        blocks: z
          .array(
            z.object({
              when: dayWhenSchema.optional().default("flexible"),
              title: z.string().optional(),
              note: z.string().optional(),
              entityId: z.string().optional(),
              entityIri: z.string().optional(),
              entityName: z.string().optional(),
              entityKind: z
                .enum(["hotel", "activity", "attraction", "destination"])
                .optional(),
              isCustom: z.boolean().optional(),
            })
          )
          .optional(),
        activityIds: z.array(z.string()).optional(),
        activityIris: z.array(z.string()).optional(),
        activityNames: z.array(z.string()).optional(),
        customActivities: z.array(z.string()).optional(),
        transitNote: z.string().optional(),
      })
    )
    .optional()
    .default([]),
  transfers: z
    .array(
      z.object({
        fromStopIndex: z.number().int().min(-1),
        toStopIndex: z.number().int().min(0),
        label: z.string().optional(),
        mode: z.string().optional(),
        durationHours: z.number().optional(),
        note: z.string().optional(),
        routeId: z.string().optional(),
        fromPlaceName: z.string().optional(),
        toPlaceName: z.string().optional(),
        fromPlaceId: z.string().optional(),
        toPlaceId: z.string().optional(),
      })
    )
    .optional()
    .default([]),
  workflow: z
    .object({
      stage: z.enum(["route", "stays", "days", "complete"]),
      approved: z
        .object({
          route: z.string().optional(),
          stays: z.string().optional(),
          days: z.string().optional(),
        })
        .optional()
        .default({}),
    })
    .optional(),
});

/** True when any stop/block still has a pending or non-Fide id. */
export function hasUnresolvedEntityIds(data: ClientItinerary): boolean {
  for (const stop of data.stops) {
    if (!fideIdHex(stop.placeId)) return true;
    if (stop.hotelId && !fideIdHex(stop.hotelId)) return true;
  }
  for (const day of data.days) {
    for (const block of day.blocks ?? []) {
      if (!fideIdHex(block.entityId)) return true;
    }
  }
  return false;
}

export function parseClientItinerary(
  raw: string,
  options?: { allowUnbound?: boolean }
): { ok: true; data: ClientItinerary } | { ok: false; error: string } {
  if (!raw.trim()) {
    return { ok: false, error: "empty" };
  }

  try {
    const parsed = JSON.parse(stripJsonFences(raw));
    const loose = clientItineraryLooseSchema.safeParse(parsed);
    if (!loose.success) {
      return { ok: false, error: loose.error.message };
    }
    const normalized = normalizeClientItinerary(
      loose.data as unknown as Parameters<typeof normalizeClientItinerary>[0],
      { pendingNonFide: options?.allowUnbound === true }
    );
    if (normalized.stops.length === 0) {
      return {
        ok: false,
        error:
          "No overnight stops (every stop needs placeName; server binds placeId from allowlist)",
      };
    }

    if (options?.allowUnbound) {
      // Shape-check only — binder fills real Fide ids next.
      const draft = clientItinerarySchema.safeParse(normalized);
      if (!draft.success) {
        return { ok: false, error: draft.error.message };
      }
      return { ok: true, data: draft.data };
    }

    if (hasUnresolvedEntityIds(normalized)) {
      return {
        ok: false,
        error:
          "Unresolved entity ids — need Fide placeId/entityId (or turn allowlist bind)",
      };
    }

    const result = clientItinerarySchema.safeParse(normalized);
    if (!result.success) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, data: result.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid json",
    };
  }
}

export function serializeClientItinerary(data: ClientItinerary): string {
  const withWf = { ...data, workflow: ensureWorkflow(data) };
  return `${JSON.stringify(withWf, null, 2)}\n`;
}

export function labelFromEntityId(id: string, fallback = "Entity"): string {
  const hash = id.split("#").at(-1) ?? id;
  const value = hash.includes("=") ? hash.split("=").at(-1) : hash;
  if (!value || value.startsWith("did:fide:")) {
    return fallback;
  }
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** @deprecated Use labelFromEntityId */
export const labelFromIri = labelFromEntityId;

/** Display blocks — graph entities only. */
export function dayBlocksForDisplay(day: ClientItineraryDay): DayBlock[] {
  if (day.blocks && day.blocks.length > 0) {
    return day.blocks.filter((block) => Boolean(block.entityId));
  }

  const blocks: DayBlock[] = [];
  for (const [index, id] of (day.activityIds ?? []).entries()) {
    const kind = kindFromEntityId(id);
    if (!kind) {
      continue;
    }
    blocks.push({
      when: "flexible",
      entityId: id,
      entityName: day.activityNames?.[index] || labelFromEntityId(id, "Activity"),
      entityKind: kind,
    });
  }
  return blocks;
}

export const dayWhenLabel: Record<DayWhen, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  flexible: "Anytime",
};
