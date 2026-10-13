import type { PeekEntityKind } from "./schema";

/**
 * Routing kind per entity, from the graph's kind Statement (`#kind`), keyed by
 * subject fingerprint. The Fide id type code is a base kind only (hotel and
 * activity are both Concept), so it cannot route. Filled from harvested views
 * and from `inventory/kind-of`. Unknown ids have no kind and fail closed.
 */
const kindByFingerprint = new Map<string, PeekEntityKind>();

const FIDE_ID_BODY = /^(?:did:fide:)?0x[0-9a-f]{4}([0-9a-f]+)$/i;

/** Entity fingerprint: everything after the entity and reference type codes (as the graph query takes it). */
export function fideFingerprintOf(id: string): string | null {
  const match = FIDE_ID_BODY.exec(id.trim());
  return match ? match[1].toLowerCase() : null;
}

export function rememberFideKind(id: string, kind: PeekEntityKind): void {
  const fingerprint = fideFingerprintOf(id);
  if (fingerprint) {
    kindByFingerprint.set(fingerprint, kind);
  }
}

export function knownFideKind(id: string): PeekEntityKind | null {
  const fingerprint = fideFingerprintOf(id);
  return fingerprint ? (kindByFingerprint.get(fingerprint) ?? null) : null;
}

/** Ids whose kind is not cached yet, de-duplicated by fingerprint. */
export function uncachedFideIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const fingerprint = fideFingerprintOf(id);
    if (!fingerprint || kindByFingerprint.has(fingerprint) || seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    out.push(id.trim());
  }
  return out;
}

/** Every `did:fide:` string anywhere in a payload (patches, documents). */
export function fideIdsIn(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim().startsWith("did:fide:") ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(fideIdsIn);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(fideIdsIn);
  }
  return [];
}

export function clearFideKindCache(): void {
  kindByFingerprint.clear();
}
