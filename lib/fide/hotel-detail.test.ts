import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRooms, splitList } from "./hotel-detail.ts";

describe("splitList", () => {
  it("trims items and drops empty ones", () => {
    assert.deepEqual(splitList(" a |  | b | ", " | "), ["a", "b"]);
  });

  it("returns nothing for an empty column", () => {
    assert.deepEqual(splitList("", "\n"), []);
  });
});

describe("parseRooms", () => {
  it("reads name and description per line", () => {
    assert.deepEqual(parseRooms("Suite Five :: Quiet, river views.\nDeluxe King :: Two guests."), [
      { name: "Suite Five", description: "Quiet, river views." },
      { name: "Deluxe King", description: "Two guests." },
    ]);
  });

  it("keeps later separators inside the description", () => {
    assert.deepEqual(parseRooms("Studio :: Kitchen :: balcony"), [
      { name: "Studio", description: "Kitchen :: balcony" },
    ]);
  });

  it("allows a room with no description", () => {
    assert.deepEqual(parseRooms("Premier Room"), [{ name: "Premier Room", description: "" }]);
  });

  it("returns no rooms for an empty column", () => {
    assert.deepEqual(parseRooms(""), []);
  });
});
