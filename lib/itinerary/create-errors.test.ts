import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { materializeStops } from "./patch.ts";
import { itineraryToolErrorFromUnknown, ItineraryToolError } from "./tool-error.ts";

const sydney = "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";

describe("create/materialize coded errors", () => {
  it("returns TRANSFER_INDEX_OOR for bad transfer indices", () => {
    const result = materializeStops("Trip", {
      stops: [{ placeId: sydney, placeName: "Sydney", nights: 2 }],
      transfers: [{ fromStopIndex: 5, toStopIndex: 6 }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, "TRANSFER_INDEX_OOR");
  });

  it("surfaces ItineraryToolError as code+hint tool result", () => {
    const err = new ItineraryToolError({
      code: "VERIFIER_BLOCK",
      message: "Cairns + Port Douglas incompatible",
      hint: "Pick one reef gateway overnight.",
    });
    const payload = itineraryToolErrorFromUnknown(err);
    assert.equal(payload.code, "VERIFIER_BLOCK");
    assert.ok(payload.hint.includes("reef"));
    assert.equal(payload.error, "Cairns + Port Douglas incompatible");
  });
});
