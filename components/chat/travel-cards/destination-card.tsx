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
  const sellRole = readString(raw, ["sell_role"]);
  const accessNote = readString(raw, ["access_note"]);
  const incompatible = readString(raw, [
    "incompatible_overnights",
    "incompatible_overnight_iris",
  ]);
  const requiresBriefRaw = readString(raw, ["overnight_requires_brief"]);
  const requiresBrief =
    requiresBriefRaw === "true" ||
    requiresBriefRaw === "1" ||
    requiresBriefRaw.toLowerCase() === "yes";
  const priceTier = readString(raw, ["price_tier"]);
  const goodForVisit = readString(raw, ["good_for_visit"]);
  const goodForTravelers = readString(raw, ["good_for_travelers"]);
  const goodForInterests = readString(raw, ["good_for_interests"]);
  const goodForAccess = readString(raw, ["good_for_access"]);
  const badForVisit = readString(raw, ["bad_for_visit"]);
  const badForTravelers = readString(raw, ["bad_for_travelers"]);
  const badForInterests = readString(raw, ["bad_for_interests"]);
  const badForAccess = readString(raw, ["bad_for_access"]);
  const isFirstTimeFit = /first-time/i.test(goodForVisit);

  const fields = [
    { label: "Region", value: region },
    { label: "Vibe", value: vibe },
    { label: "Recommended nights", value: recommended },
    { label: "Stay range", value: stayRange },
    { label: "Min nights (enforced)", value: stayMin },
    { label: "Max nights (enforced)", value: stayMax },
    { label: "Priority", value: priority },
    { label: "Price tier", value: priceTier },
    { label: "Landscapes", value: landscapes },
    { label: "IATA", value: iata },
  ].filter((f) => Boolean(f.value));

  const fitFields = [
    { label: "Visit fit", value: goodForVisit },
    { label: "Travelers", value: goodForTravelers },
    { label: "Interests", value: goodForInterests },
    { label: "Access", value: goodForAccess },
    {
      label: "Less suitable",
      value: [badForVisit, badForTravelers, badForInterests, badForAccess]
        .filter(Boolean)
        .join(" · "),
    },
  ].filter((f) => Boolean(f.value));

  const policyFields = [
    { label: "Sell role", value: sellRole },
    {
      label: "Do not overnight with",
      value: incompatible
        ? incompatible
            .split("|")
            .map((part) => part.trim())
            .filter(Boolean)
            .join(", ")
        : "",
    },
    {
      label: "Overnight requires brief",
      value: requiresBrief ? "Yes — only if the client named it" : "",
    },
    { label: "Access note", value: accessNote },
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
        {isFirstTimeFit ? (
          <StatusBadge label="First-time visitor" tone="info" />
        ) : null}
        {sellRole ? <StatusBadge label={sellRole} tone="neutral" /> : null}
        {requiresBrief ? (
          <StatusBadge label="Brief-gated overnight" tone="warning" />
        ) : null}
        {incompatible ? (
          <StatusBadge label="Has overnight conflicts" tone="warning" />
        ) : null}
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

      {fitFields.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Fit
          </div>
          <FieldGrid fields={fitFields} />
        </div>
      ) : null}

      {policyFields.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Advisor policy
          </div>
          <FieldGrid fields={policyFields} />
        </div>
      ) : null}

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
