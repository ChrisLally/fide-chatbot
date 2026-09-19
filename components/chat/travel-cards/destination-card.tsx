"use client";

import { useContextNav } from "@/hooks/use-context-nav";
import { type TravelContextItem, readString } from "@/lib/fide/travel-context";
import { CardShell, FieldGrid, StatusBadge, TagRow } from "./shared";

function parseAdvisorLinks(raw: Record<string, unknown>) {
  const labels = readString(raw, ["advisor_link_labels"])
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const urls = readString(raw, ["advisor_link_urls"])
    .split("|")
    .map((part) => part.trim());
  if (labels.length > 0) {
    return labels.map((label, index) => ({
      label,
      url: urls[index] || "",
    }));
  }
  const combined = readString(raw, ["advisor_links"]);
  return combined
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [label, url] = part.split("::").map((p) => p.trim());
      return { label: label || part, url: url || "" };
    });
}

export function DestinationCard({
  item,
  showOpenAction = true,
}: {
  item: TravelContextItem;
  showOpenAction?: boolean;
}) {
  const advisorLinks = parseAdvisorLinks(item.raw);
  const { openTravelContext } = useContextNav();
  const raw = item.raw;

  const region = readString(raw, ["region_name", "region", "area"]);
  const vibe = readString(raw, ["vibe", "style"]);
  const recommended = readString(raw, ["stay_recommended_nights"]);
  const stayMin = readString(raw, ["stay_min_nights"]);
  const stayMax = readString(raw, ["stay_max_nights"]);
  const stayRange =
    stayMin && stayMax ? `${stayMin}–${stayMax} nights` : stayMin || stayMax;
  const priority = readString(raw, ["city_priority"]);
  const landscapes = readString(raw, ["landscapes"]);
  const iata = readString(raw, ["iata_code"]);

  const fields = [
    { label: "Region", value: region },
    { label: "Vibe", value: vibe },
    { label: "Recommended nights", value: recommended },
    { label: "Stay range", value: stayRange },
    { label: "Priority", value: priority },
    { label: "Landscapes", value: landscapes },
    { label: "IATA", value: iata },
  ].filter((f) => Boolean(f.value));

  return (
    <CardShell
      accent="catalina"
      eyebrow="Destination / Area"
      onOpen={
        showOpenAction
          ? () => openTravelContext("destination", item.id)
          : undefined
      }
      subtitle={item.subtitle}
      title={item.name}
      entityId={item.id}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {region && <StatusBadge label={region} tone="info" />}
        {vibe && <StatusBadge label={vibe} tone="neutral" />}
        {recommended ? (
          <StatusBadge label={`${recommended} nights`} tone="neutral" />
        ) : null}
      </div>

      {item.description && (
        <p className="text-sm leading-relaxed text-foreground/90">
          {item.description}
        </p>
      )}

      {fields.length > 0 && <FieldGrid fields={fields} />}

      {advisorLinks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Advisor links
          </div>
          <div className="flex flex-col gap-1">
            {advisorLinks.map((link) =>
              link.url ? (
                <a
                  className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                  href={link.url}
                  key={`${link.label}-${link.url}`}
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link.label}
                </a>
              ) : (
                <span className="text-sm text-muted-foreground" key={link.label}>
                  {link.label}
                </span>
              )
            )}
          </div>
        </div>
      ) : null}

      <TagRow tags={item.tags} />
    </CardShell>
  );
}
