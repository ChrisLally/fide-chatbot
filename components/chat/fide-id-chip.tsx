"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractRows, readString } from "@/lib/fide/travel-context";
import {
  fideIdEntityType,
  fideIdEntityTypeLabel,
  fideIdHex,
  fideIdReferenceType,
  fideIdReferenceTypeLabel,
  isClusterFideId,
  kindFromFideId,
  shortEntityId,
  subjectFingerprintFromFideId,
  type PeekEntityKind,
} from "@/lib/itinerary/schema";
import { cn } from "@/lib/utils";

function fullFideId(id: string): string {
  if (id.startsWith("did:fide:")) {
    return id;
  }
  const hex = fideIdHex(id);
  return hex ? `did:fide:${hex}` : id;
}

const DETAIL_QUERY: Record<
  PeekEntityKind,
  { query: string; legacyIriParam: string }
> = {
  hotel: { query: "hotelDetail", legacyIriParam: "hotel_iri" },
  activity: { query: "activityDetail", legacyIriParam: "activity_iri" },
  attraction: { query: "attractionDetail", legacyIriParam: "attraction_iri" },
  destination: { query: "destinationDetail", legacyIriParam: "place_iri" },
};

async function fetchMemberIri(id: string): Promise<string | null> {
  const kind = kindFromFideId(id);
  if (!kind) {
    return null;
  }

  const candidates: PeekEntityKind[] =
    kind === "activity" ? ["activity", "attraction"] : [kind];

  for (const candidate of candidates) {
    const config = DETAIL_QUERY[candidate];
    const hex = fideIdHex(id);
    if (!hex) {
      continue;
    }
    const fideId = id.startsWith("did:fide:") ? id : `did:fide:${hex}`;
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: config.query,
            params: {
              fideId,
              subjectFingerprint: subjectFingerprintFromFideId(id) ?? "",
              [config.legacyIriParam]: "",
            },
          }),
        }
      );
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as { result?: unknown };
      const row = extractRows(payload.result)[0];
      if (!row) {
        continue;
      }
      const iri = readString(row, [
        "iri",
        "hotel_iri",
        "activity_iri",
        "attraction_iri",
        "place_iri",
      ]);
      if (iri) {
        return iri;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function fetchClusterMemberIris(id: string): Promise<string[]> {
  const hex = fideIdHex(id);
  if (!hex) {
    return [];
  }
  const fideId = id.startsWith("did:fide:") ? id : `did:fide:${hex}`;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/context/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "clusterMembers",
          params: { fideId },
        }),
      }
    );
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { result?: unknown };
    const rows = extractRows(payload.result);
    const iris: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const iri = readString(row, ["member_iri"]);
      if (iri && !seen.has(iri)) {
        seen.add(iri);
        iris.push(iri);
      }
    }
    return iris;
  } catch {
    return [];
  }
}

function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "break-all text-[12px] leading-relaxed text-foreground",
          mono && "font-mono"
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Truncated Fide id chip. Click opens a dialog with the full id breakdown.
 * Cluster ids list all member IRIs; the anchor fingerprint is the earliest
 * accepted sameAs statement in the component — not a preferred member.
 */
export function FideIdChip({
  id,
  className,
  iri: iriProp,
}: {
  id: string;
  className?: string;
  /** Optional known member IRI — skips the lookup when provided. */
  iri?: string;
}) {
  const [open, setOpen] = useState(false);
  const [memberIri, setMemberIri] = useState<string | null>(iriProp ?? null);
  const [memberIris, setMemberIris] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const short = shortEntityId(id);
  const full = fullFideId(id);
  const entityType = fideIdEntityType(id);
  const entityTypeLabel = fideIdEntityTypeLabel(id);
  const referenceType = fideIdReferenceType(id);
  const referenceTypeLabel = fideIdReferenceTypeLabel(id);
  const fingerprint = subjectFingerprintFromFideId(id);
  const cluster = isClusterFideId(id);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = cluster
      ? fetchClusterMemberIris(id).then((iris) => {
          if (!cancelled) {
            setMemberIris(iris);
          }
        })
      : memberIri || iriProp
        ? Promise.resolve()
        : fetchMemberIri(id).then((value) => {
            if (!cancelled) {
              setMemberIri(value);
            }
          });

    load.finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, id, cluster, iriProp, memberIri]);

  if (!short) {
    return null;
  }

  const entityTypeDisplay =
    entityType && entityTypeLabel
      ? `${entityTypeLabel} (${entityType})`
      : entityType ?? "—";
  const referenceTypeDisplay =
    referenceType && referenceTypeLabel
      ? `${referenceTypeLabel} (${referenceType})`
      : referenceType ?? "—";

  return (
    <>
      <button
        className={cn(
          "inline max-w-full break-all text-left font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline",
          className
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        title="Show full Fide id"
        type="button"
      >
        {short}
      </button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent
          className="max-w-md gap-4 rounded-xl p-4 sm:max-w-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Fide id details</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <MetaRow label="Fide id" mono value={full} />
            <MetaRow label="Entity type" value={entityTypeDisplay} />
            <MetaRow label="Reference type" value={referenceTypeDisplay} />
            <MetaRow
              label={
                cluster
                  ? "Anchor statement fingerprint"
                  : "Fingerprint"
              }
              mono
              value={fingerprint ?? "—"}
            />
            {cluster ? (
              <div className="space-y-1">
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Member IRIs
                </p>
                {loading ? (
                  <p className="text-[12px] text-muted-foreground">Loading…</p>
                ) : memberIris.length > 0 ? (
                  <ul className="space-y-1.5">
                    {memberIris.map((iri) => (
                      <li
                        className="break-all font-mono text-[12px] leading-relaxed text-foreground"
                        key={iri}
                      >
                        {iri}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground">—</p>
                )}
              </div>
            ) : (
              <MetaRow
                label="IRI"
                mono
                value={
                  loading ? "Looking up…" : memberIri ?? iriProp ?? "—"
                }
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
