import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyItineraryPatch, materializeStops } from "./patch.ts";
import { sample } from "./patch-fixtures.ts";
import { guestSchema } from "./schema.ts";
import { verifyItineraryStage } from "./stage-verifier.ts";

const SYDNEY = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";

describe("guests are optional", () => {
  const hotel = {
    op: "setStopHotel" as const,
    stopId: "s1",
    hotelId: "did:fide:0x3120f8d7d887bf79cfbce86593bd0e76764fcaff",
  };
  const atStays = (itinerary: typeof sample) => ({
    ...itinerary,
    guests: undefined,
    workflow: {
      stage: "stays" as const,
      approved: { stops: { at: "2026-10-13T00:00:00Z", by: "human" as const } },
    },
  });

  it("sets a hotel with no guests on the trip", () => {
    const result = applyItineraryPatch(atStays(sample), hotel);
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : JSON.stringify(result.diagnostics)
    );
  });

  it("does not block approving stays or stops without guests", () => {
    const gate = verifyItineraryStage(
      { ...sample, guests: undefined },
      "stays",
      { forApprove: true }
    );
    assert.ok(!gate.errors.some((e) => e.toLowerCase().includes("guest")));
  });

  it("creates stops without guests", () => {
    const result = materializeStops("Trip", {
      stops: [
        {
          placeId: "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069",
          placeName: "Sydney",
          nights: 3,
        },
      ],
    });
    assert.equal(result.ok, true);
  });

  it("setGuests replaces the guest list", () => {
    const result = applyItineraryPatch(sample, {
      op: "setGuests",
      guests: [{ name: "Ana", info: "relaxed" }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.guests?.length, 1);
    assert.equal(result.itinerary.guests?.[0]?.name, "Ana");
  });
});

describe("guests by id", () => {
  const withTwo = {
    ...sample,
    guests: [
      { guestId: "g1", name: "Ben", info: "50 years old" },
      { guestId: "g2", name: "Bob", info: "22, his son" },
    ],
  };

  it("addGuest gives the next guestId", () => {
    const result = applyItineraryPatch(withTwo, {
      op: "addGuest",
      guest: { name: "Ann" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.guests?.[2]?.guestId, "g3");
  });

  it("updateGuest changes one guest by id and keeps the rest", () => {
    const result = applyItineraryPatch(withTwo, {
      op: "updateGuest",
      guestId: "g2",
      info: "23, his son",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.guests?.[1]?.info, "23, his son");
    assert.equal(result.itinerary.guests?.[1]?.name, "Bob");
    assert.equal(result.itinerary.guests?.[0]?.info, "50 years old");
  });

  it("updateGuest with an empty string clears a field", () => {
    const result = applyItineraryPatch(withTwo, {
      op: "updateGuest",
      guestId: "g1",
      name: "",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.itinerary.guests?.[0]?.name, undefined);
    assert.equal(result.itinerary.guests?.[0]?.info, "50 years old");
  });

  it("updateGuest refuses to leave a guest blank", () => {
    const result = applyItineraryPatch(withTwo, {
      op: "updateGuest",
      guestId: "g1",
      name: "",
      info: "",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "GUEST_EMPTY");
  });

  it("unknown guestId fails and lists the ids that exist", () => {
    const result = applyItineraryPatch(withTwo, {
      op: "removeGuest",
      guestId: "g9",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "GUEST_NOT_FOUND");
    assert.deepEqual(result.diagnostics[0]?.candidates, ["g1", "g2"]);
  });

  it("removeGuest deletes one guest", () => {
    const result = applyItineraryPatch(withTwo, {
      op: "removeGuest",
      guestId: "g1",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.itinerary.guests?.map((g) => g.guestId),
      ["g2"]
    );
  });

  it("setGuests gives ids to guests that have none", () => {
    const result = applyItineraryPatch(sample, {
      op: "setGuests",
      guests: [{ info: "adult" }, { name: "Ana" }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.itinerary.guests?.map((g) => g.guestId),
      ["g1", "g2"]
    );
  });
});

describe("guest fields", () => {
  it("accepts a name with info, or info alone", () => {
    assert.equal(
      guestSchema.safeParse({ name: "Jim", info: "30, relaxed" }).success,
      true
    );
    assert.equal(guestSchema.safeParse({ info: "30" }).success, true);
  });

  it("rejects a blank guest", () => {
    assert.equal(guestSchema.safeParse({}).success, false);
  });

  it("rejects fields outside name and info", () => {
    assert.equal(guestSchema.safeParse({ age: 30, info: "x" }).success, false);
  });
});
