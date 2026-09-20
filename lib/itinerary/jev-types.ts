/** Client-safe Jev ranking view. No SDK imports. */

export const NIGHT_FIT_CRITERIA = [
  "Poor — rushed or far too long for this place in this trip",
  "Weak — legal but awkward pacing",
  "Acceptable — workable first-timer stay, including a short gateway hop",
  "Good — typical first-timer pacing given remaining nights (no stay-band implied)",
  "Strong — nights sit on a known stay-min/rec/max band, or the brief locked this length",
] as const;

export const TRANSPORT_MODE_CRITERIA = {
  flight:
    "One booked commercial flight or light-aircraft sector (graph air / light-aircraft)",
  car: "Self-drive only if this is a short mainland corridor (not an island, not >3.5h)",
  bus: "Coach or scheduled bus between mainland towns (graph bus)",
  train: "Rail where a train corridor exists (graph train); never for island aircraft legs",
  ferry: "A single ferry or boat sector (not a substitute for Lady Elliot aircraft)",
  uncertain:
    "Do not book from this row — missing corridor, or this is a multi-hop via a hub rather than one mode",
} as const;

export type JevTransportMode = keyof typeof TRANSPORT_MODE_CRITERIA;

export type JevNightRow = {
  stopIndex: number;
  placeId: string;
  placeName: string;
  nights: number;
  stayMin?: number;
  stayRec?: number;
  stayMax?: number;
  score: number;
  label: string;
  probabilities?: Record<string, number>;
};

export type JevLegRow = {
  key: string;
  fromLabel: string;
  toLabel: string;
  chosenMode?: string;
  durationHours?: number;
  carDisallowed: boolean;
  recommended: JevTransportMode | string;
  probabilities: Record<string, number>;
};

export type JevScores = {
  evaluatedAt: string;
  nightsSum: number;
  durationDays: number | null;
  verifierOk: boolean;
  verifierErrors: string[];
  nights: JevNightRow[];
  legs: JevLegRow[];
  typesafeConfidence: unknown;
  error?: string;
};

export function nightFitLabel(score: number): string {
  const index = Math.max(0, Math.min(NIGHT_FIT_CRITERIA.length - 1, Math.round(score)));
  return NIGHT_FIT_CRITERIA[index] ?? NIGHT_FIT_CRITERIA[0];
}

export function parseJevScores(value: unknown): JevScores | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<JevScores>;
  if (!Array.isArray(record.nights) || !Array.isArray(record.legs)) {
    return null;
  }
  return record as JevScores;
}
