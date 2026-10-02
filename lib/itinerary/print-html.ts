import {
  dayBlocksForDisplay,
  dayWhenLabel,
  parseClientItinerary,
  type ClientItinerary,
  type DayBlock,
  type ItineraryTransfer,
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

/** AC Luxe style: "Thursday, 29 Apr 27" (UTC calendar date, no TZ shift). */
export function formatQuoteDate(date: Date): string {
  const weekday = date.toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
  const day = date.getUTCDate();
  const month = date.toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${weekday}, ${day} ${month} ${year}`;
}

/** Day 1 = startDate; dayNumber is 1-based. */
export function calendarDateForDay(
  startDate: string | undefined,
  dayNumber: number
): Date | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return null;
  }
  const [y, m, d] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + (dayNumber - 1));
  return date;
}

function dayHeading(
  dayNumber: number,
  startDate: string | undefined,
  suffix?: string
): string {
  const cal = calendarDateForDay(startDate, dayNumber);
  const base = cal ? formatQuoteDate(cal) : `Day ${dayNumber}`;
  if (suffix?.trim()) {
    return escapeHtml(`${base} · ${suffix.trim()}`);
  }
  return escapeHtml(base);
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

function labelForDay(
  dayNumber: number,
  startDate: string | undefined
): string {
  const cal = calendarDateForDay(startDate, dayNumber);
  return cal ? formatQuoteDate(cal) : `Day ${dayNumber}`;
}

/** Two-column quotation row: bold label | value (AC Luxe style). */
function fieldRows(
  rows: Array<{ label: string; value?: string | null; italic?: boolean }>
): string {
  return rows
    .filter((row) => Boolean(row.value?.trim()))
    .map((row) => {
      const value = escapeHtml(row.value!.trim());
      const valueHtml = row.italic ? `<em>${value}</em>` : value;
      return `<tr>
        <th>${escapeHtml(row.label)}</th>
        <td>${valueHtml}</td>
      </tr>`;
    })
    .join("");
}

function sectionBlock(dateLabel: string, rowsHtml: string): string {
  if (!rowsHtml.trim()) {
    return "";
  }
  return `<section class="service">
    <div class="date-bar"><span>${dateLabel}</span></div>
    <table class="fields">${rowsHtml}</table>
  </section>`;
}

function transferBlock(
  dateLabel: string,
  transfer: Partial<ItineraryTransfer> & {
    fromLabel: string;
    toLabel: string;
  }
): string {
  const from = transfer.fromPlaceName?.trim() || transfer.fromLabel;
  const to = transfer.toPlaceName?.trim() || transfer.toLabel;
  const service =
    transfer.label?.trim() ||
    [from, to].filter(Boolean).join(" to ") ||
    undefined;
  const duration =
    transfer.durationHours == null
      ? undefined
      : transfer.durationHours === 1
        ? "1 hour"
        : `${transfer.durationHours} hours`;

  return sectionBlock(
    dateLabel,
    fieldRows([
      { label: "Transfer:", value: transfer.mode || "Transfer" },
      { label: "Service:", value: service },
      { label: "Pick-up location:", value: from },
      { label: "Drop-off location:", value: to },
      { label: "Duration:", value: duration },
      { label: "Remarks:", value: transfer.note, italic: true },
    ])
  );
}

function accommodationBlock(input: {
  dateLabel: string;
  placeName: string;
  hotelName?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  remarks?: string;
}): string {
  return sectionBlock(
    input.dateLabel,
    fieldRows([
      {
        label: "Accommodation:",
        value: input.hotelName || `Overnight · ${input.placeName}`,
      },
      // PDF uses Address; we only store place name on the stop today.
      { label: "Address:", value: input.placeName },
      { label: "Check in date:", value: input.checkIn },
      { label: "Check out date:", value: input.checkOut },
      {
        label: "Number of nights:",
        value: String(input.nights),
      },
      {
        label: "Remarks:",
        value:
          input.remarks ||
          (input.hotelName
            ? undefined
            : "Hotel not confirmed — first-pass draft"),
        italic: true,
      },
    ])
  );
}

function activityKindLabel(block: DayBlock): string {
  if (block.entityKind === "attraction") {
    return "Entrance fee:";
  }
  if (block.entityKind === "activity") {
    return "Sightseeing:";
  }
  return "Sightseeing:";
}

function activityBlock(
  dateLabel: string,
  block: DayBlock,
  extras?: { description?: string; remarks?: string }
): string {
  const name = block.entityName || block.title || "Activity";
  const when = dayWhenLabel[block.when] ?? "";
  const description = [extras?.description, block.note]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n");
  return sectionBlock(
    dateLabel,
    fieldRows([
      { label: activityKindLabel(block), value: name },
      {
        label: "Service:",
        value:
          block.title && block.title !== name
            ? block.title
            : when || undefined,
      },
      { label: "Time of day:", value: when || undefined },
      { label: "Description:", value: description || undefined },
      {
        label: "Remarks:",
        value: extras?.remarks,
        italic: true,
      },
    ])
  );
}

function dayOverviewBlock(
  dateLabel: string,
  day: {
    title: string;
    description?: string;
    transitNote?: string;
  }
): string {
  return sectionBlock(
    dateLabel,
    fieldRows([
      { label: "Sightseeing:", value: day.title },
      { label: "Description:", value: day.description },
      { label: "Remarks:", value: day.transitNote, italic: true },
    ])
  );
}

/**
 * Client-facing quotation HTML modeled on Catalina's AC Luxe booking PDFs:
 * stacked BOOKING/QUOTATION title, agent meta, purple day bars, label/value service tables.
 */
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
  const title = escapeHtml(itinerary.title);
  const startDate = itinerary.startDate;

  const bodyParts: string[] = [];

  if (arrival) {
    const transfer = arrival.transfer;
    bodyParts.push(
      transferBlock(dayHeading(1, startDate, "Arrival"), {
        fromLabel: arrival.fromLabel,
        toLabel: arrival.toLabel,
        ...(transfer ?? {}),
      })
    );
  }

  for (let stopIndex = 0; stopIndex < itinerary.stops.length; stopIndex++) {
    const stop = itinerary.stops[stopIndex];
    const startDay = startDays[stopIndex] ?? 1;
    const endDay = startDay + stop.nights;
    const checkIn = labelForDay(startDay, startDate);
    const checkOut = labelForDay(endDay, startDate);

    if (stopIndex > 0) {
      const inbound = betweenByFrom.get(stopIndex - 1);
      if (inbound) {
        const transfer = inbound.transfer;
        bodyParts.push(
          transferBlock(dayHeading(startDay, startDate, "Transfer"), {
            fromLabel: inbound.fromLabel,
            toLabel: inbound.toLabel,
            ...(transfer ?? {}),
          })
        );
      }
    }

    bodyParts.push(
      accommodationBlock({
        dateLabel: dayHeading(startDay, startDate),
        placeName: stop.placeName,
        hotelName: stop.hotelName,
        checkIn,
        checkOut,
        nights: stop.nights,
      })
    );

    const stopDays = itinerary.days
      .filter((day) => day.stopIndex === stopIndex)
      .sort((a, b) => a.dayNumber - b.dayNumber);

    for (const day of stopDays) {
      const label = dayHeading(day.dayNumber, startDate, day.title);
      const blocks = dayBlocksForDisplay(day);
      const hasCopy =
        Boolean(day.description?.trim()) || Boolean(day.transitNote?.trim());

      // Day-level copy as its own quotation row (PDF-style), then each activity.
      if (hasCopy && blocks.length === 0) {
        bodyParts.push(dayOverviewBlock(label, day));
      } else if (hasCopy && blocks.length > 0) {
        bodyParts.push(dayOverviewBlock(label, day));
        for (const block of blocks) {
          bodyParts.push(activityBlock(label, block));
        }
      } else {
        for (const block of blocks) {
          bodyParts.push(activityBlock(label, block));
        }
      }
    }
  }

  if (departure) {
    const transfer = departure.transfer;
    const depDay = itinerary.durationDays;
    bodyParts.push(
      transferBlock(dayHeading(depDay, startDate, "Departure"), {
        fromLabel: departure.fromLabel,
        toLabel: departure.toLabel,
        ...(transfer ?? {}),
      })
    );
  }

  const summary = itinerary.summary?.trim()
    ? `<p class="intro">${escapeHtml(itinerary.summary.trim())}</p>`
    : `<p class="intro">Thank you for choosing Catalina Quest — we are pleased to present you with the below quotation of your forthcoming trip.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #111;
      --muted: #333;
      --bar: #4b2e6e;
      --rule: #ddd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: #fff;
      font-family: Calibri, "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 11pt;
      line-height: 1.35;
    }
    main {
      max-width: 48rem;
      margin: 0 auto;
      padding: 1.75rem 1.5rem 2.5rem;
    }
    .masthead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .doc-title {
      margin: 0;
      font-size: 28pt;
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .brand {
      text-align: right;
      padding-top: 0.35rem;
    }
    .brand-mark {
      display: inline-block;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 999px;
      border: 2px solid var(--bar);
      color: var(--bar);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      line-height: 2.55rem;
      text-align: center;
      margin-bottom: 0.35rem;
    }
    .brand-name {
      margin: 0;
      color: var(--bar);
      font-size: 14pt;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .meta {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 1rem;
    }
    .meta th {
      width: 10.5rem;
      padding: 0.15rem 0.75rem 0.15rem 0;
      text-align: left;
      vertical-align: top;
      font-weight: 700;
      white-space: nowrap;
    }
    .meta td {
      padding: 0.15rem 0;
      vertical-align: top;
    }
    .intro {
      margin: 0 0 1.35rem;
      color: var(--muted);
    }
    .service { margin: 0 0 1.1rem; }
    .date-bar {
      background: var(--bar);
      color: #fff;
      text-align: center;
      font-weight: 700;
      padding: 0.45rem 0.75rem;
      margin: 0 0 0.55rem;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .brand-mark,
    .brand-name {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .fields {
      width: 100%;
      border-collapse: collapse;
    }
    .fields th {
      width: 10.5rem;
      padding: 0.18rem 0.85rem 0.18rem 0;
      text-align: left;
      vertical-align: top;
      font-weight: 700;
      white-space: nowrap;
    }
    .fields td {
      padding: 0.18rem 0;
      vertical-align: top;
      color: var(--ink);
    }
    .disclaimer {
      margin-top: 1.75rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--rule);
      font-size: 9.5pt;
      color: var(--muted);
    }
    .disclaimer p { margin: 0.35rem 0; }
    .signoff { margin-top: 1.25rem; }
    .screen-hint {
      margin: 0 0 1rem;
      padding: 0.55rem 0.7rem;
      background: #f3eef8;
      color: #4b2e6e;
      font-size: 10pt;
    }
    @media print {
      main { max-width: none; padding: 0; }
      .screen-hint { display: none; }
      .service { page-break-inside: avoid; break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
      body, .date-bar, .brand-mark, .brand-name {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    @page { margin: 14mm; }
  </style>
</head>
<body>
  <main>
    <p class="screen-hint">Print this page or choose Save as PDF to keep the quotation layout.</p>
    <div class="masthead">
      <h1 class="doc-title">Booking<br />Quotation</h1>
      <div class="brand">
        <div class="brand-mark">CQ</div>
        <p class="brand-name">Catalina Quest</p>
      </div>
    </div>
    <table class="meta">
      <tr><th>Agent Name:</th><td>Catalina Quest</td></tr>
      <tr><th>Agent Reference:</th><td></td></tr>
      <tr><th>Our Reference:</th><td></td></tr>
      <tr><th>Booking Name:</th><td>${title}</td></tr>
      <tr><th>Trip start:</th><td>${
        startDate
          ? escapeHtml(labelForDay(1, startDate))
          : "<em>Not set — choose a start date in the itinerary panel</em>"
      }</td></tr>
      <tr><th>Trip length:</th><td>${itinerary.durationDays} days · ${nightsSum} ${nightsSum === 1 ? "night" : "nights"}</td></tr>
      <tr><th>Booking Total:</th><td><em>To be confirmed</em></td></tr>
    </table>
    ${summary}
    ${bodyParts.join("\n")}
    <div class="disclaimer">
      <p><strong>These details are a first-pass quotation draft.</strong> Nothing is currently booked. Rates, availability, flights, and entrance fees are subject to confirmation at the time of booking.</p>
      <p><strong>Price exclusions (typical):</strong> international and domestic air tickets unless listed; entrance tickets unless listed; meals and beverages not specified; personal expenses; tips for guides and drivers.</p>
      <p class="signoff">Kind regards,<br /><strong>Catalina Quest</strong></p>
      <p>Prepared ${escapeHtml(new Date().toLocaleDateString())}</p>
    </div>
  </main>
</body>
</html>
`;
}

export function parseItineraryForExport(content: string): ClientItinerary | null {
  const parsed = parseClientItinerary(content, { allowUnbound: true });
  return parsed.ok ? parsed.data : null;
}
