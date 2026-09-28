import { fideIdHex, normalizeDid, shortEntityId } from "./schema";

export type PlacePolicy = {
  fideId: string;
  placeName: string;
  placeIri?: string;
  stayMinNights?: number;
  incompatibleOvernightFideIds: string[];
  incompatibleOvernightIris: string[];
  overnightRequiresBrief: boolean;
};

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
