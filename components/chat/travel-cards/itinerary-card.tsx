"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import {
  type TravelContextItem,
  readString,
} from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

type ItineraryDay = {
  day: number;
  title: string;
  summary: string;
  stopPosition: number;
  visitNames: string[];
  visitIris: string[];
  highlightNames: string[];
  highlightIris: string[];
};

function contextKindForIri(iri: string): "destination" | "attraction" | "activity" {
  if (iri.includes("#attraction=")) return "attraction";
  if (iri.includes("#activity=")) return "activity";
  return "destination";
}

function parseStops(raw: Record<string, unknown>) {
  const names = readString(raw, ["stop_place_names"])
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const iris = readString(raw, ["stop_place_iris"])
    .split("|")
    .map((part) => part.trim());
  const nights = readString(raw, ["stop_nights"])
    .split("|")
    .map((part) => part.trim());
  return names.map((name, index) => ({
    name,
    placeIri: iris[index] || "",
    nights: nights[index] || "",
    position: index + 1,
  }));
}

function parseDays(raw: Record<string, unknown>): ItineraryDay[] {
  const value = raw.days_json;
  let parsed: unknown = value;
  if (typeof value === "string" && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const row = entry as Record<string, unknown>;
      const visitNames = String(row.visit_names ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const visitIris = String(row.visit_iris ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const highlightNames = String(row.highlight_names ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const highlightIris = String(row.highlight_iris ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return {
        day: Number(row.day) || 0,
        title: String(row.title ?? ""),
        summary: String(row.summary ?? ""),
        stopPosition: Number(row.stop_position) || 0,
        visitNames,
        visitIris,
        highlightNames,
        highlightIris,
      };
    })
    .filter((day): day is ItineraryDay => Boolean(day && day.day));
}

export function ItineraryCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const duration = readString(raw, ["duration"]);
  const bestFor = readString(raw, ["best_for"]);
  const when = readString(raw, ["when_to_go"]);
  const route = readString(raw, ["route_summary"]);
  const stops = parseStops(raw);
  const days = parseDays(raw);

  const fields = [
    { label: "Duration", value: duration },
    { label: "Best for", value: bestFor },
    { label: "When to go", value: when },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Itinerary template"
      onOpen={
        showOpenAction
          ? () => openTravelContext("itinerary", item.id)
          : undefined
      }
      subtitle={item.subtitle}
      title={item.name}
      entityId={item.id}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {duration && <StatusBadge label={duration} tone="info" />}
        {bestFor && <StatusBadge label={bestFor} tone="neutral" />}
      </div>

      {item.description && (
        <p className="text-sm leading-relaxed text-foreground/90">
          {item.description}
        </p>
      )}

      {stops.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Stops
          </div>
          {stops.map((stop) => {
            const stopDays = days.filter(
              (day) => day.stopPosition === stop.position
            );
            return (
              <div
                className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2"
                key={`${stop.placeIri || stop.name}-${stop.position}`}
              >
                <button
                  className="flex w-full items-center justify-between gap-2 text-left transition-colors hover:opacity-80"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (stop.placeIri) {
                      openTravelContext("destination", stop.placeIri);
                    } else {
                      openTravelContext("itinerary", item.id);
                    }
                  }}
                  type="button"
                >
                  <span className="truncate font-medium text-foreground">
                    {stop.position}. {stop.name}
                  </span>
                  {stop.nights ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {stop.nights}n
                    </span>
                  ) : null}
                </button>
                {stopDays.length > 0 ? (
                  <ul className="mt-1.5 space-y-1 border-border/40 border-l pl-2.5">
                    {stopDays.map((day) => (
                      <li
                        className="text-xs leading-snug text-muted-foreground"
                        key={`${stop.position}-${day.day}`}
                      >
                        <div>
                          <span className="font-medium text-foreground/80">
                            Day {day.day}
                          </span>
                          {day.title ? ` — ${day.title}` : ""}
                          {day.visitNames[0] ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {day.visitNames[0]}
                            </span>
                          ) : null}
                        </div>
                        {day.highlightNames.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {day.highlightNames.map((name, index) => {
                              const iri = day.highlightIris[index] || "";
                              if (!iri) {
                                return (
                                  <span
                                    className="rounded border border-border/40 px-1.5 py-0.5 text-[10px]"
                                    key={`${day.day}-h-${name}`}
                                  >
                                    {name}
                                  </span>
                                );
                              }
                              return (
                                <button
                                  className="rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                                  key={`${day.day}-h-${iri}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openTravelContext(
                                      contextKindForIri(iri),
                                      iri
                                    );
                                  }}
                                  type="button"
                                >
                                  {name}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : route ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{route}</p>
      ) : null}

      {fields.length > 0 && <FieldGrid fields={fields} />}

      <TagRow tags={item.tags} />
    </CardShell>
  );
}
