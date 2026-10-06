import type {
  ClientItinerary,
  ClientItineraryDay,
  ClientItineraryStop,
} from "./schema";

export const CURRENT_SCHEMA_VERSION = 2;

const STOP_ID_RE = /^s(\d+)$/;
const DAY_ID_RE = /^d(\d+)$/;

export function parseStopIdNum(stopId: string): number | null {
  const match = STOP_ID_RE.exec(stopId.trim());
  return match ? Number(match[1]) : null;
}

export function parseDayIdNum(dayId: string): number | null {
  const match = DAY_ID_RE.exec(dayId.trim());
  return match ? Number(match[1]) : null;
}

export function formatStopId(n: number): string {
  return `s${n}`;
}

export function formatDayId(n: number): string {
  return `d${n}`;
}

/** Next unused stop id counter from existing stops (never reuse). */
export function nextStopIdCounter(stops: Array<{ stopId?: string }>): number {
  let max = 0;
  for (const stop of stops) {
    const n = stop.stopId ? parseStopIdNum(stop.stopId) : null;
    if (n != null && n > max) max = n;
  }
  return max + 1;
}

/** Next unused day id counter from existing days (never reuse). */
export function nextDayIdCounter(days: Array<{ dayId?: string }> | undefined | null): number {
  let max = 0;
  for (const day of days ?? []) {
    const n = day.dayId ? parseDayIdNum(day.dayId) : null;
    if (n != null && n > max) max = n;
  }
  return max + 1;
}

export function allocateStopId(
  stops: Array<{ stopId?: string }>,
  counter?: { next: number }
): string {
  const state = counter ?? { next: nextStopIdCounter(stops) };
  const id = formatStopId(state.next);
  state.next += 1;
  return id;
}

export function allocateDayId(
  days: Array<{ dayId?: string }>,
  counter?: { next: number }
): string {
  const state = counter ?? { next: nextDayIdCounter(days) };
  const id = formatDayId(state.next);
  state.next += 1;
  return id;
}

/**
 * Backfill missing stopId / dayId on an itinerary.
 * Never reassigns an existing id. Monotonic counters skip used numbers.
 */
export function ensureArtifactIds(itinerary: ClientItinerary): ClientItinerary {
  const stopsIn = itinerary.stops ?? [];
  const daysIn = itinerary.days ?? [];
  const stopCounter = { next: nextStopIdCounter(stopsIn) };
  const stops: ClientItineraryStop[] = stopsIn.map((stop) => {
    if (stop.stopId && parseStopIdNum(stop.stopId) != null) {
      return stop;
    }
    return { ...stop, stopId: allocateStopId(stopsIn, stopCounter) };
  });

  const dayCounter = { next: nextDayIdCounter(daysIn) };
  const days: ClientItineraryDay[] = daysIn.map((day) => {
    if (day.dayId && parseDayIdNum(day.dayId) != null) {
      return day;
    }
    return { ...day, dayId: allocateDayId(daysIn, dayCounter) };
  });

  return {
    ...itinerary,
    stops,
    days,
    version: itinerary.version ?? 1,
    schemaVersion: itinerary.schemaVersion ?? CURRENT_SCHEMA_VERSION,
  };
}
