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
  shortEntityId,
  subjectFingerprintFromFideId,
} from "@/lib/itinerary/schema";
import { cn } from "@/lib/utils";

function fullFideId(id: string): string {
  if (id.startsWith("did:fide:")) {
    return id;
  }
  const hex = fideIdHex(id);
  return hex ? `did:fide:${hex}` : id;
}

async function fetchClusterMemberIds(id: string): Promise<string[]> {
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
    const memberIds: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const memberId = readString(row, ["member_fide_id"]);
      if (memberId && !seen.has(memberId)) {
        seen.add(memberId);
        memberIds.push(memberId);
      }
    }
    return memberIds;
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
 * Cluster ids list all member Fide ids; the anchor fingerprint is the earliest
 * accepted sameAs statement in the component — not a preferred member.
 */
export function FideIdChip({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
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
      ? fetchClusterMemberIds(id).then((ids) => {
          if (!cancelled) {
            setMemberIds(ids);
          }
        })
      : Promise.resolve();

    load.finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, id, cluster]);

  if (!short) {
    return null;
  }

  const entityTypeDisplay =
    entityType && entityTypeLabel
      ? `${entityTypeLabel} (${entityType})`
      : (entityType ?? "—");
  const referenceTypeDisplay =
    referenceType && referenceTypeLabel
      ? `${referenceTypeLabel} (${referenceType})`
      : (referenceType ?? "—");

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
              label={cluster ? "Anchor statement fingerprint" : "Fingerprint"}
              mono
              value={fingerprint ?? "—"}
            />
            {cluster ? (
              <div className="space-y-1">
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  Member Fide ids
                </p>
                {loading ? (
                  <p className="text-[12px] text-muted-foreground">Loading…</p>
                ) : memberIds.length > 0 ? (
                  <ul className="space-y-1.5">
                    {memberIds.map((memberId) => (
                      <li
                        className="break-all font-mono text-[12px] leading-relaxed text-foreground"
                        key={memberId}
                      >
                        {memberId}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground">—</p>
                )}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
