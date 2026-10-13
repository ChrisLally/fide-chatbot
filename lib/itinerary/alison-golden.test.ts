import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The golden itinerary fixture is the reference for the Alison Test-1 brief.
const golden = readFileSync(new URL("./alison-golden.ts", import.meta.url), "utf8");

describe("alison golden fixture", () => {
  it("names Lady Elliot Island", () => {
    assert.match(golden, /Lady Elliot/);
  });

  it("does not stack Cairns and Port Douglas as two overnight stops", () => {
    assert.match(golden, /Port Douglas/);
    assert.doesNotMatch(golden.replace(/\s+/g, ""), /placeName:"Cairns"/);
  });

  it("encodes the light-aircraft access to Lady Elliot Island", () => {
    assert.match(golden.toLowerCase(), /light aircraft/);
  });
});
