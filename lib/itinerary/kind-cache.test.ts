import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearFideKindCache,
  fideFingerprintOf,
  fideIdsIn,
  knownFideKind,
  rememberFideKind,
  uncachedFideIds,
} from "./kind-cache.ts";

const TAIL = "f8d7d887bf79cfbce86593bd0e76764fcaff";
const HOTEL_OLD = `did:fide:0x1120${TAIL}`;
const HOTEL_NEW = `did:fide:0x3120${TAIL}`;
const PLACE = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";

describe("fideFingerprintOf", () => {
  it("reads the same fingerprint under the old and new hotel prefix", () => {
    assert.equal(fideFingerprintOf(HOTEL_OLD), TAIL);
    assert.equal(fideFingerprintOf(HOTEL_NEW), TAIL);
  });

  it("accepts a bare 0x id and lowercases the result", () => {
    assert.equal(fideFingerprintOf(`0x3120${TAIL.toUpperCase()}`), TAIL);
  });

  it("returns null for values that are not Fide ids", () => {
    assert.equal(fideFingerprintOf("https://www.catalinaquest.ai/#hotel=sydney-capella-sydney"), null);
    assert.equal(fideFingerprintOf("did:fide:0x31"), null);
    assert.equal(fideFingerprintOf(""), null);
  });
});

describe("kind cache", () => {
  beforeEach(() => clearFideKindCache());

  it("returns the kind remembered for an id under either prefix", () => {
    rememberFideKind(HOTEL_OLD, "hotel");
    assert.equal(knownFideKind(HOTEL_NEW), "hotel");
  });

  it("has no kind for an id it has not seen", () => {
    assert.equal(knownFideKind(PLACE), null);
  });

  it("does not let one entity's kind leak to another", () => {
    rememberFideKind(HOTEL_NEW, "hotel");
    assert.equal(knownFideKind(PLACE), null);
  });

  it("lists only uncached ids, once each", () => {
    rememberFideKind(PLACE, "destination");
    assert.deepEqual(uncachedFideIds([PLACE, HOTEL_OLD, HOTEL_NEW, "https://example.com/x"]), [HOTEL_OLD]);
  });

  it("forgets everything when cleared", () => {
    rememberFideKind(PLACE, "destination");
    clearFideKindCache();
    assert.equal(knownFideKind(PLACE), null);
  });
});

describe("fideIdsIn", () => {
  it("finds every did:fide string in a nested payload", () => {
    const payload = {
      patches: [{ op: "setStopHotel", hotelId: HOTEL_NEW }, { op: "setStopNights", nights: 2 }],
      stops: [{ placeId: PLACE, name: "Sydney" }],
    };
    assert.deepEqual(fideIdsIn(payload).sort(), [HOTEL_NEW, PLACE].sort());
  });

  it("ignores plain text and numbers", () => {
    assert.deepEqual(fideIdsIn(["Sydney", 3, null]), []);
  });
});
