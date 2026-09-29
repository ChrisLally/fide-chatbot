import { fideIdHex, normalizeDid, shortEntityId } from "./schema";

export type PlacePolicy = {
  fideId: string;
  placeName: string;
  placeIri?: string;
  /** Graph `#stay-min-nights` — hard floor when set. */
  stayMinNights?: number;
  /** Graph `#stay-recommended-nights` — preferred target when allocating. */
  stayRecommendedNights?: number;
  /** Graph `#stay-max-nights` — hard ceiling when set. */
  stayMaxNights?: number;
  incompatibleOvernightFideIds: string[];
  incompatibleOvernightIris: string[];
  overnightRequiresBrief: boolean;
};

/** Soft autofit ceiling when the graph has no stay-max (legacy padding cap). */
export const STAY_AUTOFIT_SOFT_MAX = 6;

export function stayFloor(policy: PlacePolicy | undefined): number {
  return policy?.stayMinNights != null ? policy.stayMinNights : 1;
}

export function stayCeiling(policy: PlacePolicy | undefined): number {
  if (policy?.stayMaxNights != null) {
    return policy.stayMaxNights;
  }
  return STAY_AUTOFIT_SOFT_MAX;
}

/** Preferred nights: recommended when present, else clamped mid-band / current. */
export function stayTarget(
  policy: PlacePolicy | undefined,
  currentNights?: number
): number {
  const floor = stayFloor(policy);
  const ceiling = stayCeiling(policy);
  if (policy?.stayRecommendedNights != null) {
    return Math.min(ceiling, Math.max(floor, policy.stayRecommendedNights));
  }
  if (currentNights != null) {
    return Math.min(ceiling, Math.max(floor, currentNights));
  }
  return floor;
}

export type PlacePolicyMap = Map<string, PlacePolicy>;

function rowVal(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && String(direct).trim()) {
      return String(direct).trim();
    }
  }
  for (const [rk, rv] of Object.entries(row)) {
    const norm = rk.replace(/\s+/g, "_").toLowerCase();
    if (
      keys.some((k) => k.toLowerCase() === norm) &&
      rv != null &&
      String(rv).trim()
    ) {
      return String(rv).trim();
    }
  }
  return "";
}

function splitPipe(value: string): string[] {
  return value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function parseIntish(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function placePolicyFromViewRow(
  row: Record<string, unknown>
): PlacePolicy | null {
  const fideIdRaw = rowVal(row, "fide_id", "fideId");
  if (!fideIdHex(fideIdRaw)) {
    return null;
  }
  const fideId = normalizeDid(fideIdRaw);
  return {
    fideId,
    placeName:
      rowVal(row, "place", "place_name", "placeName") || shortEntityId(fideId),
    placeIri: rowVal(row, "iri", "place_iri") || undefined,
    stayMinNights: parseIntish(rowVal(row, "stay_min_nights", "stayMinNights")),
    stayRecommendedNights: parseIntish(
      rowVal(
        row,
        "stay_recommended_nights",
        "stayRecommendedNights",
        "stay_rec_nights"
      )
    ),
    stayMaxNights: parseIntish(
      rowVal(row, "stay_max_nights", "stayMaxNights")
    ),
    incompatibleOvernightFideIds: splitPipe(
      rowVal(
        row,
        "incompatible_overnight_fide_ids",
        "incompatibleOvernightFideIds"
      )
    ).map(normalizeDid),
    incompatibleOvernightIris: splitPipe(
      rowVal(row, "incompatible_overnight_iris", "incompatibleOvernightIris")
    ),
    overnightRequiresBrief: parseBool(
      rowVal(row, "overnight_requires_brief", "overnightRequiresBrief")
    ),
  };
}

export function policyForStop(
  policies: PlacePolicyMap | undefined,
  placeId: string | undefined
): PlacePolicy | undefined {
  if (!policies || !placeId) {
    return undefined;
  }
  return policies.get(normalizeDid(placeId)) ?? policies.get(placeId);
}
