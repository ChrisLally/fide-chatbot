import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureArtifactIds } from "../ids";
import {
  applyItineraryPatches,
  materializeStops,
  type PatchDiagnostic,
} from "../patch";
import { approveCurrentStage } from "../stages";
import { assertBriefCount, REPLAY_BRIEFS, type ReplayBrief } from "./briefs";

export type BriefMetrics = {
  id: string;
  title: string;
  createOk: boolean;
  createError?: string;
  staysOk: boolean;
  staysError?: string;
  daysOk: boolean;
  daysError?: string;
  patchFailures: number;
  omittedEntities: number;
  retries: number;
  approveReachedWithoutHumanFixes: boolean;
  diagnostics: PatchDiagnostic[];
};

export type HarnessReport = {
  ranAt: string;
  briefCount: number;
  patchFailureRate: number;
  omittedEntityRate: number;
  avgRetries: number;
  approveReachedWithoutHumanFixesRate: number;
  absoluteFloors: {
    inventIdAccepts: number;
    silentPartialApplies: number;
    note: string;
  };
  briefs: BriefMetrics[];
};

function runBrief(brief: ReplayBrief): BriefMetrics {
  const metrics: BriefMetrics = {
    id: brief.id,
    title: brief.title,
    createOk: false,
    staysOk: false,
    daysOk: false,
    patchFailures: 0,
    omittedEntities: 0,
    retries: 0,
    approveReachedWithoutHumanFixes: false,
    diagnostics: [],
  };

  const created = materializeStops(brief.title, {
    durationDays: brief.durationDays,
    stops: brief.stops.map((s) => ({
      placeId: s.placeId,
      placeName: s.placeName,
      nights: s.nights,
    })),
  });

  if (!created.ok) {
    metrics.createError = created.error;
    metrics.patchFailures += 1;
    metrics.diagnostics.push(...(created.diagnostics ?? []));
    return metrics;
  }
  metrics.createOk = true;
  let doc = ensureArtifactIds(created.itinerary);

  // Simulate Approve Stops
  doc = approveCurrentStage(doc, { by: "human" });

  const hotelPatches = doc.stops.map((stop, i) => ({
    op: "setStopHotel" as const,
    stopId: stop.stopId!,
    hotelId: brief.stops[i]?.hotelId ?? brief.stops[0]!.hotelId!,
    hotelName: brief.stops[i]?.hotelName ?? "Hotel",
  }));

  let stays = applyItineraryPatches(doc, hotelPatches);
  if (!stays.ok) {
    metrics.retries += 1;
    stays = applyItineraryPatches(doc, hotelPatches);
  }
  if (!stays.ok) {
    metrics.staysError = stays.error;
    metrics.patchFailures += 1;
    metrics.diagnostics.push(...(stays.diagnostics ?? []));
    return metrics;
  }
  metrics.staysOk = true;
  doc = stays.itinerary;

  // Ensure days stage
  if (doc.workflow?.stage === "stays") {
    doc = approveCurrentStage(doc, { by: "human" });
  }

  if (brief.activityId && doc.days[0]?.dayId) {
    const days = applyItineraryPatches(doc, [
      {
        op: "setDayBlocks",
        dayId: doc.days[0].dayId,
        blocks: [
          {
            when: "morning",
            entityId: brief.activityId,
            entityKind: "activity",
            entityName: "Activity",
          },
        ],
      },
    ]);
    if (!days.ok) {
      metrics.daysError = days.error;
      metrics.patchFailures += 1;
      metrics.diagnostics.push(...(days.diagnostics ?? []));
      return metrics;
    }
    metrics.daysOk = true;
    doc = days.itinerary;
  } else {
    metrics.daysOk = true;
  }

  metrics.approveReachedWithoutHumanFixes =
    metrics.createOk && metrics.staysOk && metrics.daysOk && metrics.retries === 0;
  return metrics;
}

export function runReplayHarness(): HarnessReport {
  assertBriefCount();
  const briefs = REPLAY_BRIEFS.map(runBrief);
  const n = briefs.length;
  const patchFailures = briefs.reduce((s, b) => s + b.patchFailures, 0);
  const omitted = briefs.reduce((s, b) => s + b.omittedEntities, 0);
  const retries = briefs.reduce((s, b) => s + b.retries, 0);
  const approveOk = briefs.filter((b) => b.approveReachedWithoutHumanFixes).length;

  return {
    ranAt: new Date().toISOString(),
    briefCount: n,
    patchFailureRate: patchFailures / n,
    omittedEntityRate: omitted / n,
    avgRetries: retries / n,
    approveReachedWithoutHumanFixesRate: approveOk / n,
    absoluteFloors: {
      inventIdAccepts: 0,
      silentPartialApplies: 0,
      note: "Filled after Phase 0 deterministic harness run. Tune after live LLM eval.",
    },
    briefs,
  };
}

export function writeBaselineReport(report: HarnessReport, outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain || process.argv[1]?.endsWith("harness.ts")) {
  const report = runReplayHarness();
  const out = join(
    dirname(fileURLToPath(import.meta.url)),
    "baseline-results.json"
  );
  writeBaselineReport(report, out);
  console.log(
    JSON.stringify(
      {
        briefCount: report.briefCount,
        patchFailureRate: report.patchFailureRate,
        approveReachedWithoutHumanFixesRate:
          report.approveReachedWithoutHumanFixesRate,
        out,
      },
      null,
      2
    )
  );
}
