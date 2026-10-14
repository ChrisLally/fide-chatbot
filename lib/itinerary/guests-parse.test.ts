import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sample } from "./patch-fixtures.ts";
import { parseClientItinerary } from "./schema.ts";

describe("guests survive a read", () => {
  it("parseClientItinerary keeps guests, guestId, and skip note", () => {
    const raw = JSON.stringify({
      ...sample,
      guests: [{ guestId: "g1", name: "Chris", info: "28 years old" }],
    });
    const parsed = parseClientItinerary(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.data.guests, [
      { guestId: "g1", name: "Chris", info: "28 years old" },
    ]);
  });
});
