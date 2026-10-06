import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupePlaceDescriptionAdvisorNote } from "./place-payload-dedupe.ts";

describe("place-payload-dedupe", () => {
  it("strips advisor_note when byte-identical to description", () => {
    const next = dedupePlaceDescriptionAdvisorNote({
      rows: [
        {
          place: "Sydney",
          description: "Harbour city gateway.",
          advisor_note: "Harbour city gateway.",
          stay_min_nights: "2",
        },
      ],
    }) as { rows: Array<Record<string, unknown>> };

    assert.equal(next.rows[0]?.description, "Harbour city gateway.");
    assert.equal("advisor_note" in (next.rows[0] ?? {}), false);
    assert.equal(next.rows[0]?.stay_min_nights, "2");
  });

  it("keeps unique advisor_note facts", () => {
    const next = dedupePlaceDescriptionAdvisorNote({
      description: "Harbour city.",
      advisor_note: "Budget boutique hotels from ~$400/night near Circular Quay.",
    }) as Record<string, unknown>;

    assert.equal(
      next.advisor_note,
      "Budget boutique hotels from ~$400/night near Circular Quay."
    );
  });
});
