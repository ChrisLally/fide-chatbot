import {
  dayBlocksForDisplay,
  dayWhenLabel,
  parseClientItinerary,
  type ClientItinerary,
} from "./schema";
import { calendarDayCount, syncDaysToNights } from "./stages";
import { stopStartDayNumbers, transferSlots } from "./transfers";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function itineraryExportFilename(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "itinerary"}.${extension}`;
}

function displayItinerary(raw: ClientItinerary): ClientItinerary {
  const days = syncDaysToNights(raw.stops, raw.days);
  return {
    ...raw,
    days,
    durationDays: Math.max(raw.durationDays, calendarDayCount(raw.stops)),
  };
}

export function itineraryToPrintHtml(raw: ClientItinerary): string {
  const itinerary = displayItinerary(raw);
  const slots = transferSlots(itinerary);
  const arrival = slots.find((slot) => slot.kind === "arrival");
  const departure = slots.find((slot) => slot.kind === "departure");
  const betweenByFrom = new Map(
    slots
      .filter((slot) => slot.kind === "between")
      .map((slot) => [slot.fromStopIndex, slot])
  );
  const startDays = stopStartDayNumbers(itinerary.stops);
  const nightsSum = itinerary.stops.reduce((sum, stop) => sum + stop.nights, 0);

  const transferHtml = (
    from: string,
    to: string,
    mode?: string,
    hours?: number,
    label?: string,
    note?: string
  ) => {
    const meta = [
      mode,
      hours != null ? (hours === 1 ? "1 hour" : `${hours} hours`) : null,
      label,
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div class="transfer">
      <div class="transfer-route">${escapeHtml(from)} <span class="arrow">→</span> ${escapeHtml(to)}</div>
      ${meta ? `<div class="muted">${escapeHtml(meta)}</div>` : ""}
      ${note ? `<p class="note">${escapeHtml(note)}</p>` : ""}
    </div>`;
  };

  const slotHtml = (slot: (typeof slots)[number] | undefined) => {
    if (!slot) {
      return "";
    }
    const transfer = slot.transfer;
    const from = transfer?.fromPlaceName?.trim() || slot.fromLabel;
    const to = transfer?.toPlaceName?.trim() || slot.toLabel;
    if (
      !transfer ||
      !(
        transfer.mode ||
        transfer.durationHours != null ||
        transfer.label ||
        transfer.note
      )
    ) {
      return transferHtml(from, to);
    }
    return transferHtml(
      from,
      to,
      transfer.mode,
      transfer.durationHours,
      transfer.label,
      transfer.note
    );
  };

  const stopSections = itinerary.stops
    .map((stop, stopIndex) => {
      const inbound =
        stopIndex === 0 ? arrival : betweenByFrom.get(stopIndex - 1);
      const dayNumber = startDays[stopIndex] ?? 1;
      const stopDays = itinerary.days
        .filter((day) => day.stopIndex === stopIndex)
        .sort((a, b) => a.dayNumber - b.dayNumber);

      const daysHtml = stopDays
        .map((day) => {
          const blocks = dayBlocksForDisplay(day);
          const items = blocks
            .map((block) => {
              const name =
                block.entityName || block.title || "Activity";
              const when = dayWhenLabel[block.when] ?? "";
              const extra = block.note
                ? `<div class="note">${escapeHtml(block.note)}</div>`
                : "";
              return `<li><span class="when">${escapeHtml(when)}</span> ${escapeHtml(name)}${extra}</li>`;
            })
            .join("");
          const copy = day.description
            ? `<p class="note">${escapeHtml(day.description)}</p>`
            : "";
          return `<div class="day">
            <h4>Day ${day.dayNumber}${day.title ? ` · ${escapeHtml(day.title)}` : ""}</h4>
            ${copy}
            ${items ? `<ul>${items}</ul>` : ""}
          </div>`;
        })
        .join("");

      const hotel = stop.hotelName
        ? `<div class="hotel">${escapeHtml(stop.hotelName)}</div>`
        : "";

      return `${inbound ? slotHtml(inbound) : ""}
      <article class="stop">
        <p class="kicker">Day ${dayNumber} · Stay ${stopIndex + 1}</p>
        <h2>${escapeHtml(stop.placeName)}</h2>
        <p class="muted">${stop.nights} ${stop.nights === 1 ? "night" : "nights"}</p>
        ${hotel}
        ${daysHtml}
      </article>`;
    })
    .join("\n");

  const departureHtml = departure ? slotHtml(departure) : "";
  const title = escapeHtml(itinerary.title);
  const summary = itinerary.summary
    ? `<p class="summary">${escapeHtml(itinerary.summary)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1a1714;
      background: #fff;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", serif;
      font-size: 15px;
      line-height: 1.5;
    }
    main { max-width: 40rem; margin: 0 auto; padding: 2.5rem 1.5rem 3rem; }
    header { border-bottom: 1px solid #d9d0c6; padding-bottom: 1.25rem; margin-bottom: 1.5rem; }
    .brand { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #8a7a6a; font-family: ui-sans-serif, system-ui, sans-serif; }
    h1 { font-size: 1.85rem; font-weight: 600; margin: 0.35rem 0 0.4rem; letter-spacing: -0.02em; }
    h2 { font-size: 1.25rem; margin: 0.15rem 0 0.2rem; }
    h4 { font-size: 0.95rem; margin: 0 0 0.25rem; }
    .meta, .muted, .kicker, .when { font-family: ui-sans-serif, system-ui, sans-serif; }
    .meta { color: #5c534a; font-size: 13px; }
    .muted { color: #6b6258; font-size: 13px; margin: 0; }
    .kicker { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8a7a6a; margin: 0 0 0.2rem; }
    .summary { margin: 0.75rem 0 0; color: #3f3a35; }
    .hotel { margin-top: 0.35rem; font-style: italic; }
    .stop { padding: 1.1rem 0; page-break-inside: avoid; break-inside: avoid; }
    .day { margin-top: 0.75rem; }
    ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
    li { margin: 0.2rem 0; }
    .when { display: inline-block; min-width: 5.5rem; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8a7a6a; }
    .transfer {
      border-top: 1px dashed #d9d0c6;
      border-bottom: 1px dashed #d9d0c6;
      padding: 0.7rem 0;
      margin: 0.2rem 0;
      page-break-inside: avoid;
      break-inside: avoid;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 13px;
    }
    .transfer-route { font-weight: 600; }
    .arrow { color: #8a7a6a; font-weight: 400; }
    .note { margin: 0.25rem 0 0; color: #5c534a; font-size: 13px; }
    footer { margin-top: 2rem; padding-top: 0.75rem; border-top: 1px solid #d9d0c6; font-size: 11px; color: #8a7a6a; font-family: ui-sans-serif, system-ui, sans-serif; }
    .screen-hint {
      margin: 0 0 1.25rem;
      padding: 0.65rem 0.8rem;
      background: #f4efe8;
      color: #5c534a;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
    }
    @media print {
      body { background: #fff; }
      main { max-width: none; padding: 0; }
      a { color: inherit; text-decoration: none; }
      .screen-hint { display: none; }
    }
    @page { margin: 16mm; }
  </style>
</head>
<body>
  <main>
    <p class="screen-hint">Print this page or choose Save as PDF to keep the layout.</p>
    <header>
      <div class="brand">Catalina Quest</div>
      <h1>${title}</h1>
      <p class="meta">${itinerary.durationDays} days · ${nightsSum} ${nightsSum === 1 ? "night" : "nights"}</p>
      ${summary}
    </header>
    ${stopSections}
    ${departureHtml}
    <footer>Prepared ${escapeHtml(new Date().toLocaleDateString())}</footer>
  </main>
</body>
</html>
`;
}

export function parseItineraryForExport(content: string): ClientItinerary | null {
  const parsed = parseClientItinerary(content, { allowUnbound: true });
  return parsed.ok ? parsed.data : null;
}
