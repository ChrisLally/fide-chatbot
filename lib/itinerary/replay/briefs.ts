/**
 * ~30 realistic Catalina-shaped briefs for the replay harness.
 * Each brief is a structured spine the harness materializes + patches —
 * not live LLM calls (baseline is deterministic against apply APIs).
 */

export type ReplayBrief = {
  id: string;
  title: string;
  /** Free-text client brief (for logging / future LLM eval). */
  prompt: string;
  durationDays: number;
  stops: Array<{
    placeName: string;
    /** Hex type 40 place DID — synthetic but kind-valid for unit runs. */
    placeId: string;
    nights: number;
    hotelId?: string;
    hotelName?: string;
  }>;
  /** Optional day-block entity for first overnight day. */
  activityId?: string;
};

function place(n: number): string {
  const hex = n.toString(16).padStart(40, "0");
  return `did:fide:0x40${hex.slice(0, 38)}`;
}

function hotel(n: number): string {
  const hex = n.toString(16).padStart(40, "0");
  return `did:fide:0x11${hex.slice(0, 38)}`;
}

function activity(n: number): string {
  const hex = n.toString(16).padStart(40, "0");
  return `did:fide:0x31${hex.slice(0, 38)}`;
}

/** Real Catalina-ish place DIDs from alison golden where available. */
const SYDNEY = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
const BLUE = "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb";
const LEI = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";
const ADINA = "did:fide:0x112099ee71c0bbe3b30b275b32bbf65c900ef17a";

export const REPLAY_BRIEFS: ReplayBrief[] = [
  {
    id: "b01-alison-lite",
    title: "Sydney + Lady Elliot lite",
    prompt: "7 nights: Sydney 3, Lady Elliot 4. Diving focus.",
    durationDays: 8,
    stops: [
      { placeName: "Sydney", placeId: SYDNEY, nights: 3, hotelId: ADINA, hotelName: "Adina" },
      { placeName: "Lady Elliot Island", placeId: LEI, nights: 4, hotelId: hotel(2), hotelName: "LEI Resort" },
    ],
    activityId: activity(1),
  },
  {
    id: "b02-sydney-blue",
    title: "Sydney & Blue Mountains",
    prompt: "5 nights Sydney 3 + Blue Mountains 2.",
    durationDays: 6,
    stops: [
      { placeName: "Sydney", placeId: SYDNEY, nights: 3, hotelId: ADINA, hotelName: "Adina" },
      { placeName: "Blue Mountains", placeId: BLUE, nights: 2, hotelId: hotel(3), hotelName: "Echoes" },
    ],
    activityId: activity(2),
  },
  {
    id: "b03-single-sydney",
    title: "Sydney only",
    prompt: "4 nights Sydney city break.",
    durationDays: 5,
    stops: [{ placeName: "Sydney", placeId: SYDNEY, nights: 4, hotelId: ADINA, hotelName: "Adina" }],
    activityId: activity(3),
  },
  {
    id: "b04-two-city-short",
    title: "Two city short",
    prompt: "Sydney 2 + Blue Mountains 2.",
    durationDays: 5,
    stops: [
      { placeName: "Sydney", placeId: SYDNEY, nights: 2, hotelId: ADINA, hotelName: "Adina" },
      { placeName: "Blue Mountains", placeId: BLUE, nights: 2, hotelId: hotel(4), hotelName: "Hydro" },
    ],
  },
  {
    id: "b05-lei-only",
    title: "Lady Elliot only",
    prompt: "4 nights LEI diving.",
    durationDays: 5,
    stops: [{ placeName: "Lady Elliot Island", placeId: LEI, nights: 4, hotelId: hotel(5), hotelName: "LEI" }],
    activityId: activity(5),
  },
  ...Array.from({ length: 25 }, (_, i) => {
    const n = i + 6;
    const a = place(100 + n);
    const b = place(200 + n);
    const nightsA = 2 + (n % 3);
    const nightsB = 2 + ((n + 1) % 3);
    return {
      id: `b${String(n).padStart(2, "0")}-synth-${n}`,
      title: `Synth trip ${n}`,
      prompt: `${nightsA + nightsB + 1}-day trip: PlaceA ${nightsA}n + PlaceB ${nightsB}n.`,
      durationDays: nightsA + nightsB + 1,
      stops: [
        {
          placeName: `PlaceA${n}`,
          placeId: a,
          nights: nightsA,
          hotelId: hotel(100 + n),
          hotelName: `HotelA${n}`,
        },
        {
          placeName: `PlaceB${n}`,
          placeId: b,
          nights: nightsB,
          hotelId: hotel(200 + n),
          hotelName: `HotelB${n}`,
        },
      ],
      activityId: activity(100 + n),
    } satisfies ReplayBrief;
  }),
];

export function assertBriefCount(): void {
  if (REPLAY_BRIEFS.length < 30) {
    throw new Error(`Expected ≥30 briefs, got ${REPLAY_BRIEFS.length}`);
  }
}
