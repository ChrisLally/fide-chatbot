"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

function parseMembers(raw: Record<string, unknown>) {
  const names = readString(raw, ["member_names"])
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const placeIris = readString(raw, ["member_place_iris"])
    .split("|")
    .map((part) => part.trim());
  const placeNames = readString(raw, ["member_place_names"])
    .split("|")
    .map((part) => part.trim());
  return names.map((name, index) => ({
    name,
    placeIri: placeIris[index] || "",
    placeName: placeNames[index] || "",
  }));
}

export function CollectionCard({ item }: { item: TravelContextItem }) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;
  const kind = readString(raw, ["collection_kind", "kind"]);
  const memberCount = readString(raw, ["member_count"]);
  const members = parseMembers(raw);

  const fields = [
    { label: "Kind", value: kind },
    { label: "Members", value: memberCount },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Signature collection"
      onOpen={() => openTravelContext("collection", item.id)}
      subtitle={item.subtitle}
      title={item.name}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {kind && <StatusBadge label={kind} tone="info" />}
        {memberCount && (
          <StatusBadge label={`${memberCount} members`} tone="neutral" />
        )}
      </div>

      {item.description && (
        <p className="text-sm leading-relaxed text-foreground/90">
          {item.description}
        </p>
      )}

      {members.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Members
          </div>
          <div className="flex flex-col gap-1">
            {members.slice(0, 12).map((member) =>
              member.placeIri ? (
                <button
                  className="inline-flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/40"
                  key={member.name}
                  onClick={(event) => {
                    event.stopPropagation();
                    openTravelContext("destination", member.placeIri);
                  }}
                  type="button"
                >
                  <span className="truncate font-medium text-sky-700 dark:text-sky-400">
                    {member.name}
                  </span>
                  {member.placeName ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {member.placeName}
                    </span>
                  ) : null}
                </button>
              ) : (
                <div
                  className="rounded-md border border-border/40 bg-muted/10 px-2.5 py-1.5 text-sm text-muted-foreground"
                  key={member.name}
                >
                  {member.name}
                </div>
              )
            )}
            {members.length > 12 ? (
              <div className="text-xs text-muted-foreground">
                +{members.length - 12} more
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {fields.length > 0 && <FieldGrid fields={fields} />}
      <TagRow tags={item.tags} />
    </CardShell>
  );
}
