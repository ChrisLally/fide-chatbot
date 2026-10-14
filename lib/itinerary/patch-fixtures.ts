import { createTurnEntityBinder } from "./entity-binder";
import { ensureArtifactIds } from "./ids";
import { registerAllFixtureKinds } from "./kind-fixtures";
import type { PlacePolicyMap } from "./place-policy";
import type { ClientItinerary } from "./schema";

// Shared fixtures for the itinerary patch tests (patch-ops and materialize-and-stays).
registerAllFixtureKinds();

/** Guest info that satisfies the stops gate. */
export const TEST_GUESTS = [{ info: "adult, relaxed pace" }];

export const sydney = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
export const lei = "did:fide:0x40203015b9c8855721dfb39bd6c6ed8bf8b147d5";
export const adina = "did:fide:0x312099ee71c0bbe3b30b275b32bbf65c900ef17a";
export const blue = "did:fide:0x40207505aad72bc6866680f82c90589bf4e7caeb";

export const stayPolicies: PlacePolicyMap = new Map([
  [
    lei,
    {
      fideId: lei,
      placeName: "Lady Elliot Island",
      stayMinNights: 3,
      stayRecommendedNights: 3,
      stayMaxNights: 5,
      incompatibleOvernightFideIds: [],
      overnightRequiresBrief: false,
    },
  ],
  [
    sydney,
    {
      fideId: sydney,
      placeName: "Sydney",
      stayMinNights: 2,
      stayRecommendedNights: 3,
      stayMaxNights: 5,
      incompatibleOvernightFideIds: [],
      overnightRequiresBrief: false,
    },
  ],
]);

export const sample: ClientItinerary = ensureArtifactIds({
  title: "Test",
  summary: "",
  durationDays: 7,
  version: 1,
  schemaVersion: 2,
  guests: TEST_GUESTS,
  stops: [
    { placeId: sydney, placeName: "Sydney", nights: 3 },
    { placeId: lei, placeName: "Lady Elliot Island", nights: 4 },
  ],
  days: [
    {
      dayNumber: 1,
      stopIndex: 0,
      title: "Stay in Sydney",
      description: "",
      blocks: [],
    },
    {
      dayNumber: 2,
      stopIndex: 1,
      title: "Stay in Lady Elliot Island",
      description: "",
      blocks: [],
    },
  ],
  transfers: [],
  workflow: {
    stage: "stays",
    approved: { stops: { at: "x", by: "human" } },
  },
});

export function binderWith(
  ...entities: Array<{
    fideId: string;
    name: string;
    kind: "destination" | "hotel" | "activity" | "attraction";
  }>
) {
  const binder = createTurnEntityBinder();
  binder.addMany(entities);
  return binder;
}
