import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fideIdHex,
  parseClientItinerary,
  shortEntityId,
  upgradeToFideId,
} from "./schema.ts";
import { fideFingerprint, sha256Hex } from "./sha256.ts";

describe("sha256 / fingerprint", () => {
  it("matches Node crypto for Catalina Sydney IRI", async () => {
    const { createHash } = await import("node:crypto");
    const iri = "https://www.catalinaquest.ai/#place=sydney";
    const node = createHash("sha256").update(iri, "utf8").digest("hex");
    assert.equal(sha256Hex(iri), node);
    assert.equal(fideFingerprint(iri), node.slice(0, 36));
  });
});

describe("fideIdHex / shortEntityId", () => {
  const sydney =
    "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";

  it("extracts 0x… body from did:fide form", () => {
    assert.equal(
      fideIdHex(sydney),
      "0x4020434523b50f52aa55da3e9d53c0355d620069"
    );
  });

  it("accepts bare 0x…", () => {
    assert.equal(
      fideIdHex("0x4020434523b50f52aa55da3e9d53c0355d620069"),
      "0x4020434523b50f52aa55da3e9d53c0355d620069"
    );
  });

  it("rejects Catalina IRIs and bare slugs", () => {
    assert.equal(fideIdHex("https://www.catalinaquest.ai/#place=sydney"), null);
    assert.equal(fideIdHex("melbourne"), null);
  });

  it("shortEntityId shows first 8 of 0x…", () => {
    assert.equal(shortEntityId(sydney), "0x402043…");
    assert.equal(shortEntityId("https://www.catalinaquest.ai/#place=sydney"), "");
  });

  it("subjectFingerprintFromFideId strips type codes", async () => {
    const { subjectFingerprintFromFideId } = await import("./schema.ts");
    assert.equal(
      subjectFingerprintFromFideId(
        "did:fide:0x112012614b43c10e32222424c3994a5b059eee02"
      ),
      "12614b43c10e32222424c3994a5b059eee02"
    );
  });

  it("detects cluster vs member reference types", async () => {
    const {
      isClusterFideId,
      fideIdReferenceType,
      fideIdEntityTypeLabel,
      fideIdReferenceTypeLabel,
      kindFromFideId,
    } = await import("./schema.ts");
    const cluster =
      "did:fide:0x3100e2e1287f82d4e56b2ffffc549e4eac88d6e6";
    const member =
      "did:fide:0x3120e2e1287f82d4e56b2ffffc549e4eac88d6e6";
    assert.equal(fideIdReferenceType(cluster), "00");
    assert.equal(fideIdReferenceType(member), "20");
    assert.equal(isClusterFideId(cluster), true);
    assert.equal(isClusterFideId(member), false);
    assert.equal(kindFromFideId(cluster), "activity");
    assert.equal(fideIdEntityTypeLabel(cluster), "Concept");
    assert.equal(fideIdReferenceTypeLabel(cluster), "Statement");
    assert.equal(fideIdReferenceTypeLabel(member), "NetworkResource");
    assert.equal(kindFromFideId("did:fide:0x1100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), "hotel");
    assert.equal(kindFromFideId("did:fide:0x4000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "destination");
  });
});

describe("upgradeToFideId", () => {
  it("upgrades place IRI to Place NetworkResource fide id", () => {
    const id = upgradeToFideId(
      "https://www.catalinaquest.ai/#place=sydney",
      "destination"
    );
    assert.equal(
      id,
      "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069"
    );
    assert.equal(shortEntityId(id), "0x402043…");
  });

  it("upgrades bare place slug", () => {
    const id = upgradeToFideId("melbourne", "destination");
    assert.match(id, /^did:fide:0x4020[0-9a-f]{36}$/);
    assert.ok(shortEntityId(id).startsWith("0x4020"));
  });

  it("upgrades hotel IRI to Organization code 11", () => {
    const id = upgradeToFideId(
      "https://www.catalinaquest.ai/#hotel=brisbane-hilton-brisbane",
      "hotel"
    );
    assert.match(id, /^did:fide:0x1120/);
  });

  it("leaves existing fide ids alone", () => {
    const id =
      "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069";
    assert.equal(upgradeToFideId(id, "destination"), id);
  });
});

describe("parseClientItinerary upgrades IRIs for UI chips", () => {
  it("normalizes IRI itinerary into fide ids so shortEntityId works", () => {
    const raw = JSON.stringify({
      title: "Blue Mountains & Sydney Escape",
      summary: "test",
      durationDays: 2,
      stops: [
        {
          placeId: "https://www.catalinaquest.ai/#place=sydney",
          placeName: "Sydney",
          nights: 1,
        },
        {
          placeId: "https://www.catalinaquest.ai/#place=blue-mountains",
          placeName: "Blue Mountains",
          nights: 1,
        },
      ],
      days: [
        {
          dayNumber: 1,
          stopIndex: 0,
          title: "Arrival",
          description: "",
          blocks: [
            {
              when: "afternoon",
              entityId:
                "https://www.catalinaquest.ai/#attraction=sydney-sydney-opera-house",
              entityName: "Sydney Opera House",
              entityKind: "attraction",
            },
          ],
        },
      ],
    });

    const parsed = parseClientItinerary(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.equal(
      parsed.data.stops[0].placeId,
      "did:fide:0x4020434523b50f52aa55da3e9d53c0355d620069"
    );
    assert.equal(shortEntityId(parsed.data.stops[0].placeId), "0x402043…");
    assert.equal(shortEntityId(parsed.data.stops[1].placeId), "0x402075…");

    const block = parsed.data.days[0].blocks?.[0];
    assert.ok(block);
    assert.match(block.entityId, /^did:fide:0x3120/);
    assert.ok(shortEntityId(block.entityId).startsWith("0x3120"));
  });
});
