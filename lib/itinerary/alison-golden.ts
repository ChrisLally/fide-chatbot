import type { ClientItinerary } from "./schema";

/** Graph-only Alison Test 1 shape — every stop/block is a world-model Fide id (0x…). */
export const alisonGoldenItinerary: ClientItinerary = {
  title: "Australia diving & nature — Lady Elliot + Port Douglas",
  summary:
    "18-day Catalina-shaped draft: Sydney opener, Lady Elliot reef base (light aircraft), Port Douglas / Daintree (not Cairns stack), Brisbane departure.",
  durationDays: 18,
  transfers: [
    {
      fromStopIndex: -1,
      toStopIndex: 0,
      fromPlaceName: "International arrival",
      toPlaceName: "Sydney",
      mode: "flight",
      label: "Arrive Sydney",
      note: "Collect bags; city transfer — no rental car Day 1.",
    },
    {
      fromStopIndex: 0,
      toStopIndex: 1,
      fromPlaceName: "Sydney",
      toPlaceName: "Blue Mountains",
      mode: "drive",
      durationHours: 1.5,
      label: "Sydney → Blue Mountains",
    },
    {
      fromStopIndex: 1,
      toStopIndex: 2,
      fromPlaceName: "Blue Mountains",
      toPlaceName: "Lady Elliot Island",
      mode: "light-aircraft",
      durationHours: 1.6,
      label: "Via Brisbane/Redcliffe gateway → LEI",
      note: "Light aircraft only — not drive/ferry/jet.",
    },
    {
      fromStopIndex: 2,
      toStopIndex: 3,
      fromPlaceName: "Lady Elliot Island",
      toPlaceName: "Port Douglas",
      mode: "light-aircraft + flight",
      label: "LEI → BNE corridor → Port Douglas gateway",
    },
    {
      fromStopIndex: 3,
      toStopIndex: 4,
      fromPlaceName: "Port Douglas",
      toPlaceName: "Brisbane",
      mode: "flight",
      durationHours: 2.5,
      label: "Domestic flight south",
    },
    {
      fromStopIndex: 4,
      toStopIndex: 5,
      fromPlaceName: "Brisbane",
      toPlaceName: "International departure",
      mode: "flight",
      label: "Depart Australia",
    },
  ],
  stops: [
    {
      placeId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
      placeName: "Sydney",
      nights: 3,
    },
    {
      placeId: "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb",
      placeName: "Blue Mountains",
      nights: 2,
    },
    {
      placeId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
      placeName: "Lady Elliot Island",
      nights: 4,
    },
    {
      placeId: "did:fide:0x402087f50a79a57069a5b6d7de74aee49f948353",
      placeName: "Port Douglas",
      nights: 5,
    },
    {
      placeId: "did:fide:0x402037d07239aa7a99e60ae0d9c31f02dc8d26a6",
      placeName: "Brisbane",
      nights: 2,
    },
  ],
  days: [
    {
      dayNumber: 1,
      stopIndex: 0,
      title: "Arrive Sydney",
      description: "Settle in; light harbour walk only.",
      blocks: [
        {
          when: "afternoon",
          entityId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
          entityName: "Sydney",
          entityKind: "destination",
          note: "Harbour foreshore stroll after arrival",
        },
      ],
    },
    {
      dayNumber: 2,
      stopIndex: 0,
      title: "Sydney icons (pick two)",
      description: "Cap at two headline experiences — no kitchen-sink day.",
      blocks: [
        {
          when: "morning",
          entityId:
            "did:fide:0x3120b1adca8b4d76b4a1616779887e8943b1c32e",
          entityName: "Sydney Opera House",
          entityKind: "attraction",
        },
        {
          when: "afternoon",
          entityId:
            "did:fide:0x3120dbd63b4471a5f08e0257529ef3b850f329cd",
          entityName: "Opera House guided tour",
          entityKind: "activity",
        },
      ],
    },
    {
      dayNumber: 3,
      stopIndex: 0,
      title: "Sydney to Blue Mountains",
      description: "Pick up car when leaving the city, or take a dedicated transfer.",
      transitNote: "Drive or rail to Blue Mountains; overnight in the mountains.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb",
          entityName: "Blue Mountains",
          entityKind: "destination",
          note: "Transfer day toward overnight base",
        },
      ],
    },
    {
      dayNumber: 4,
      stopIndex: 1,
      title: "Blue Mountains walks",
      description: "6–8 mile nature walk day; geology / escarpment focus.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb",
          entityName: "Blue Mountains",
          entityKind: "destination",
          note: "Escarpment / lookout walks from the overnight base",
        },
      ],
    },
    {
      dayNumber: 5,
      stopIndex: 1,
      title: "Return to Sydney / fly north",
      description: "Drop car; evening or next-morning flight toward Brisbane gateway.",
      transitNote: "Domestic flight toward Lady Elliot light-aircraft departure city.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
          entityName: "Sydney",
          entityKind: "destination",
          note: "Return via Sydney for northbound connection",
        },
      ],
    },
    {
      dayNumber: 6,
      stopIndex: 2,
      title: "Light aircraft to Lady Elliot",
      description:
        "Unpaved coral airstrip — scenic light aircraft only (Brisbane/Redcliffe, Hervey Bay, Bundaberg, or Gold Coast).",
      transitNote: "Never drive, ferry, or commercial jet to Lady Elliot.",
      blocks: [
        {
          when: "afternoon",
          entityId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
          entityName: "Lady Elliot Island",
          entityKind: "destination",
          note: "Arrival + house reef orientation",
        },
      ],
    },
    {
      dayNumber: 7,
      stopIndex: 2,
      title: "Lady Elliot diving day",
      description: "Certified divers — no refresher/cert upsell.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
          entityName: "Lady Elliot Island",
          entityKind: "destination",
          note: "Guided reef dive(s) from the island",
        },
      ],
    },
    {
      dayNumber: 8,
      stopIndex: 2,
      title: "Lady Elliot second reef day",
      description: "Optional second dive/snorkel; keep pacing light.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
          entityName: "Lady Elliot Island",
          entityKind: "destination",
          note: "Second reef day — keep light",
        },
      ],
    },
    {
      dayNumber: 9,
      stopIndex: 2,
      title: "Island nature / departure prep",
      description: "Birding, turtle season walks, or relaxed reef time.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5",
          entityName: "Lady Elliot Island",
          entityKind: "destination",
          note: "Island nature / birding",
        },
      ],
    },
    {
      dayNumber: 10,
      stopIndex: 3,
      title: "Fly to Port Douglas gateway",
      description:
        "Light aircraft off island → connect to Port Douglas (not Cairns CBD as reef base).",
      transitNote:
        "Prefer scenic transfer Cairns Airport → Port Douglas; do not stack Cairns + PD stays.",
      blocks: [
        {
          when: "afternoon",
          entityId:
            "https://www.catalinaquest.ai/#activity=port-douglas-cairns-to-port-douglas-airport-shared-transfer",
          entityName: "Cairns Airport → Port Douglas shared transfer",
          entityKind: "activity",
        },
      ],
    },
    {
      dayNumber: 11,
      stopIndex: 3,
      title: "Outer reef dive from Port Douglas",
      description: "One serious reef day for certified divers.",
      blocks: [
        {
          when: "afternoon",
          entityId:
            "https://www.catalinaquest.ai/#activity=port-douglas-silversonic-great-barrier-reef-dive-and-snorkel",
          entityName: "Silversonic Great Barrier Reef Dive & Snorkel",
          entityKind: "activity",
          note: "Outer reef dive day — certified divers only",
        },
      ],
    },
    {
      dayNumber: 12,
      stopIndex: 3,
      title: "Daintree day",
      description: "Real Daintree from PD — not a DIY Mossman double-count.",
      transitNote: "Day trip from Port Douglas — return same evening.",
      blocks: [
        {
          when: "morning",
          entityId:
            "https://www.catalinaquest.ai/#activity=port-douglas-river-drift-experience-in-the-daintree",
          entityName: "River Drift Experience in the Daintree",
          entityKind: "activity",
        },
      ],
    },
    {
      dayNumber: 13,
      stopIndex: 3,
      title: "Optional gentler reef / sailing",
      description:
        "At most one more water day — do not stack liveaboard + Agincourt + more.",
      blocks: [
        {
          when: "morning",
          entityId:
            "https://www.catalinaquest.ai/#activity=port-douglas-low-isles-glass-bottom-boat-and-snorkeling-tour",
          entityName: "Low Isles Glass Bottom Boat & Snorkeling",
          entityKind: "activity",
        },
      ],
    },
    {
      dayNumber: 14,
      stopIndex: 3,
      title: "Port Douglas free / culture",
      description: "Cafés, heritage, or Aboriginal fishing experience.",
      blocks: [
        {
          when: "morning",
          entityId:
            "https://www.catalinaquest.ai/#activity=port-douglas-traditional-aboriginal-fishing-with-lunch",
          entityName: "Traditional Aboriginal Fishing with Lunch",
          entityKind: "activity",
        },
        {
          when: "evening",
          entityId:
            "https://www.catalinaquest.ai/#activity=port-douglas-sunset-sailing-cruise-on-luxury-catamaran",
          entityName: "Sunset Sailing Cruise on Luxury Catamaran",
          entityKind: "activity",
        },
      ],
    },
    {
      dayNumber: 15,
      stopIndex: 3,
      title: "Port Douglas buffer",
      description: "Soft day before southbound travel — no all-day endurance drive.",
      blocks: [
        {
          when: "flexible",
          entityId: "did:fide:0x402087f50a79a57069a5b6d7de74aee49f948353",
          entityName: "Port Douglas",
          entityKind: "destination",
          note: "Beach / spa / short coastal walk",
        },
      ],
    },
    {
      dayNumber: 16,
      stopIndex: 4,
      title: "Fly to Brisbane",
      description: "Domestic flight — not a 7–8h Townsville→Brisbane drive.",
      transitNote: "No Townsville / Magnetic Island default.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x402037d07239aa7a99e60ae0d9c31f02dc8d26a6",
          entityName: "Brisbane",
          entityKind: "destination",
          note: "Arrive Brisbane",
        },
      ],
    },
    {
      dayNumber: 17,
      stopIndex: 4,
      title: "Brisbane soft day",
      description: "One museum or riverside outing — keep departure morning free.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x402037d07239aa7a99e60ae0d9c31f02dc8d26a6",
          entityName: "Brisbane",
          entityKind: "destination",
          note: "South Bank / gallery — one headline only",
        },
      ],
    },
    {
      dayNumber: 18,
      stopIndex: 4,
      title: "Departure",
      description: "Airport-realistic morning only.",
      transitNote: "Transfer to BNE; no stacked attractions on departure morning.",
      blocks: [
        {
          when: "morning",
          entityId: "did:fide:0x402037d07239aa7a99e60ae0d9c31f02dc8d26a6",
          entityName: "Brisbane",
          entityKind: "destination",
          note: "Airport transfer only",
        },
      ],
    },
  ],
  workflow: {
    stage: "complete",
    approved: {
      route: "golden",
      stays: "golden",
      days: "golden",
    },
  },
};

