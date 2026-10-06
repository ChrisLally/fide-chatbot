/**
 * Eval: run Taylor on a trip prompt, log tool calls, validate itinerary Fide ids.
 *
 * Usage:
 *   pnpm eval:stage --stops [prompt...]   # default — createDocument spine only
 *   pnpm eval:stage --stays [prompt...]   # + simulated Approve Stops → hotels
 *   pnpm eval:stage --days [prompt...]    # + Approve Stays → day blocks
 *   pnpm eval:itinerary …                 # alias of eval:stage
 *
 * Not Playwright — Bedrock + Fide MCP only.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  generateText,
  stepCountIs,
  tool,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import {
  artifactsPrompt,
  itineraryPrompt,
  regularPrompt,
  worldModelPrompt,
} from "../lib/ai/prompts";
import { DEFAULT_CHAT_MODEL } from "../lib/ai/models";
import {
  createTurnEntityBinder,
} from "../lib/itinerary/entity-binder";
import { wrapFideToolsWithBinder } from "../lib/fide/wrap-fide-tools";
import {
  fideIdHex,
  serializeClientItinerary,
  shortEntityId,
  type ClientItinerary,
} from "../lib/itinerary/schema";
import {
  applyItineraryPatches,
  itineraryPatchSchema,
  materializeStops,
  proposeStopsSchema,
} from "../lib/itinerary/patch";
import { buildItineraryToolStatus } from "../lib/itinerary/agent-status";
import { loadPlacePoliciesFromWorldModel } from "../lib/itinerary/wm-place-policy";

import { approveCurrentStage, ensureWorkflow } from "../lib/itinerary/stages";

config({ path: resolve(process.cwd(), ".env") });

type EvalStage = "stops" | "stays" | "days";

const argv = process.argv.slice(2);
const STAGE_FLAGS = new Set(["--stops", "--route", "--stays", "--days"]);
const stageFlag = argv.find((a) => STAGE_FLAGS.has(a));
const EVAL_STAGE: EvalStage =
  stageFlag === "--days" ? "days" : stageFlag === "--stays" ? "stays" : "stops";
const THROUGH_STAYS = EVAL_STAGE === "stays" || EVAL_STAGE === "days";
const THROUGH_DAYS = EVAL_STAGE === "days";
const USER_PROMPT =
  argv.filter((a) => !STAGE_FLAGS.has(a)).join(" ").trim() ||
  "make an itinerary for 4 day trip in australia. you choose from and to where and such";

const WORLD_MODEL = process.env.FIDE_WORLD_MODEL_KEY?.trim() || "catalina-world-model";
const MAX_STEPS = THROUGH_DAYS ? 36 : THROUGH_STAYS ? 28 : 16;

type TraceEvent = {
  step: number;
  tool: string;
  input?: unknown;
  outputPreview?: string;
  ok: boolean;
};

function loadMcpConnection() {
  const apiKey = process.env.FIDE_API_KEY;
  const runnerId = process.env.FIDE_RUNNER_PUBLIC_ID;
  const workspaceId = process.env.FIDE_WORKSPACE_PUBLIC_ID;
  const gatewayUrl = (process.env.FIDE_GATEWAY_URL ?? "https://test.fide.work").replace(
    /\/$/,
    ""
  );
  if (!apiKey || !runnerId || !workspaceId) {
    throw new Error("Missing FIDE_API_KEY / FIDE_RUNNER_PUBLIC_ID / FIDE_WORKSPACE_PUBLIC_ID");
  }
  return {
    url: `${gatewayUrl}/mcp`,
    headers: {
      "x-api-key": apiKey,
      "x-fide-runner-public-id": runnerId,
      "x-fide-workspace-public-id": workspaceId,
    },
  };
}

function preview(value: unknown, max = 400): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 0) ?? "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function extractMcpText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return preview(result, 2000);
  }
  return content
    .map((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: string }).type === "text" &&
      typeof (part as { text?: string }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .join("")
    .trim();
}

function assertFideIds(itinerary: ClientItinerary): string[] {
  const problems: string[] = [];
  itinerary.stops.forEach((stop, i) => {
    if (!fideIdHex(stop.placeId)) {
      problems.push(`stops[${i}].placeId not a Fide id: ${stop.placeId}`);
    }
    if (stop.hotelId && !fideIdHex(stop.hotelId)) {
      problems.push(`stops[${i}].hotelId not a Fide id: ${stop.hotelId}`);
    }
  });
  itinerary.days.forEach((day, di) => {
    (day.blocks ?? []).forEach((block, bi) => {
      if (!fideIdHex(block.entityId)) {
        problems.push(
          `days[${di}].blocks[${bi}].entityId not a Fide id: ${block.entityId}`
        );
      }
    });
  });
  return problems;
}

function printUiPreview(itinerary: ClientItinerary) {
  console.log("\n── What the UI should show ──");
  console.log(`Header: ${itinerary.title}`);
  console.log(`Badge: Client itinerary · ${itinerary.durationDays} days`);
  if (itinerary.summary) {
    console.log(`Summary: ${itinerary.summary}`);
  }
  console.log("");

  itinerary.stops.forEach((stop, index) => {
    const days = itinerary.days
      .filter((d) => d.stopIndex === index)
      .sort((a, b) => a.dayNumber - b.dayNumber);
    console.log(`Stop ${index + 1}: ${stop.placeName}  [${shortEntityId(stop.placeId)}]`);
    console.log(`  nights: ${stop.nights}${stop.hotelName ? ` · hotel: ${stop.hotelName}` : ""}`);
    for (const day of days) {
      console.log(`  Day ${day.dayNumber}: ${day.title}`);
      for (const block of day.blocks ?? []) {
        console.log(
          `    ${block.when.padEnd(10)} ${block.entityName}  [${shortEntityId(block.entityId)}]`
        );
      }
      if (day.transitNote) {
        console.log(`    transit: ${day.transitNote}`);
      }
    }
    console.log("");
  });

  console.log(
    "Clicking a chip opens the in-panel peek (itinerary stays open) and loads detail via fideId."
  );
}

async function main() {
  console.log(`eval:stage=${EVAL_STAGE}  worldModel=${WORLD_MODEL}  maxSteps=${MAX_STEPS}`);
  console.log(`prompt: ${USER_PROMPT.slice(0, 200)}${USER_PROMPT.length > 200 ? "…" : ""}`);
  console.log("── Eval itinerary ──");
  console.log(`Prompt: ${USER_PROMPT}`);
  console.log(`Model:  ${DEFAULT_CHAT_MODEL}`);
  console.log(`WM:     ${WORLD_MODEL}\n`);

  const connection = loadMcpConnection();
  const mcp = await createMCPClient({
    transport: {
      type: "http",
      url: connection.url,
      headers: connection.headers,
    },
  });

  const bedrock = createAmazonBedrock({ region: process.env.AWS_REGION });
  const model = bedrock(DEFAULT_CHAT_MODEL);

  const trace: TraceEvent[] = [];
  const entityBinder = createTurnEntityBinder();
  let stepCounter = 0;
  let captured: ClientItinerary | null = null;
  let capturedRaw = "";

  const allowed = ["list_world_models", "list_views", "get_view", "run_view"] as const;
  const rawTools = await mcp.tools();
  let fideTools: ToolSet = {};

  for (const name of allowed) {
    const base = rawTools[name];
    if (!base) continue;

    fideTools[name] = {
      ...base,
      execute: async (input: unknown, options: unknown) => {
        stepCounter += 1;
        const step = stepCounter;
        try {
          const execute = (
            base as {
              execute?: (i: unknown, o: unknown) => Promise<unknown>;
            }
          ).execute;
          if (!execute) {
            throw new Error(`Tool ${name} has no execute`);
          }
          const result = await execute(input, options);
          const text = extractMcpText(result);
          trace.push({
            step,
            tool: name,
            input,
            outputPreview: preview(text, 280),
            ok: true,
          });
          console.log(`✓ [${step}] ${name} ${preview(input, 120)}`);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          trace.push({
            step,
            tool: name,
            input,
            outputPreview: message,
            ok: false,
          });
          console.log(`✗ [${step}] ${name} ${message}`);
          throw error;
        }
      },
    } as ToolSet[string];
  }

  fideTools = wrapFideToolsWithBinder(fideTools, entityBinder);

  fideTools.createDocument = tool({
    description:
      "Create ONE itinerary artifact for this chat (kind: itinerary). Pass top-level stops with placeId (did:fide:0x… from places-search) + nights only — no hotels, no activities. After create, STOP and wait for Approve Stops.",
    inputSchema: z.object({
      title: z.string(),
      kind: z.literal("itinerary"),
      stops: proposeStopsSchema.optional(),
      transfers: proposeStopsSchema.shape.transfers,
    }),
    execute: async ({ title, kind, stops, transfers }) => {
      const route = stops ? { stops, transfers } : undefined;
      stepCounter += 1;
      const step = stepCounter;
      if (!route?.stops?.length) {
        const message =
          "createDocument requires stops [{ placeId, nights }]";
        console.log(`✗ [${step}] createDocument ${message}`);
        trace.push({
          step,
          tool: "createDocument",
          input: { title, kind },
          outputPreview: message,
          ok: false,
        });
        return { error: message };
      }
      const placePolicies = await loadPlacePoliciesFromWorldModel(
        route.stops.map((s) => s.placeId)
      );
      const result = materializeStops(title, route, entityBinder, {
        placePolicies,
      });
      if (!result.ok) {
        console.log(`✗ [${step}] createDocument ${result.error}`);
        trace.push({
          step,
          tool: "createDocument",
          input: { title, kind, route },
          outputPreview: result.error,
          ok: false,
        });
        return { error: result.error };
      }
      captured = result.itinerary;
      capturedRaw = serializeClientItinerary(result.itinerary);
      console.log(
        `✓ [${step}] createDocument title=${title} stops=${result.itinerary.stops.length} days=${result.itinerary.days.length}`
      );
      trace.push({
        step,
        tool: "createDocument",
        input: { title, kind, route },
        outputPreview: preview(capturedRaw, 280),
        ok: true,
      });
      return {
        id: "eval-itinerary",
        title,
        kind,
        stage: "stops",
        content:
          "Stops itinerary is visible. STOP. Wait for Approve Stops. Do not createDocument again. Do not patchItinerary hotels or days until that approve.",
      };
    },
  });

  fideTools.patchItinerary = tool({
    description:
      "Apply a batch of typed itinerary ops (`patches: [...]`, even for one). Never call in parallel.",
    inputSchema: z.object({
      id: z.string(),
      patches: z.array(itineraryPatchSchema).min(1),
    }),
    execute: async ({ id, patches }) => {
      stepCounter += 1;
      const step = stepCounter;
      if (!captured) {
        const message = "No itinerary yet — createDocument first.";
        console.log(`✗ [${step}] patchItinerary ${message}`);
        trace.push({
          step,
          tool: "patchItinerary",
          input: { id, patches },
          outputPreview: message,
          ok: false,
        });
        return { error: message };
      }
      const placePolicies = await loadPlacePoliciesFromWorldModel(
        captured.stops.map((s) => s.placeId)
      );
      const result = applyItineraryPatches(captured, patches, entityBinder, {
        placePolicies,
      });
      if (!result.ok) {
        console.log(`✗ [${step}] patchItinerary ${result.error}`);
        trace.push({
          step,
          tool: "patchItinerary",
          input: { id, patches },
          outputPreview: result.error,
          ok: false,
        });
        return {
          error: result.error,
          status: buildItineraryToolStatus(captured, placePolicies),
        };
      }
      captured = result.itinerary;
      capturedRaw = serializeClientItinerary(result.itinerary);
      const ops = patches.map((p) => p.op).join(",");
      console.log(`✓ [${step}] patchItinerary ${ops}`);
      const status = buildItineraryToolStatus(captured, placePolicies);
      trace.push({
        step,
        tool: "patchItinerary",
        input: { id, patches },
        outputPreview: preview({ ops, approve: status.approveButtonClickable }, 160),
        ok: true,
      });
      return {
        id,
        ops: patches.map((p) => p.op),
        status,
        content: `Itinerary patched (${ops}).`,
      };
    },
  });

  const system = [
    regularPrompt,
    artifactsPrompt,
    itineraryPrompt,
    worldModelPrompt,
    `Prefer world model key \`${WORLD_MODEL}\`.`,
  ].join("\n\n");

  try {
    const result = await generateText({
      model,
      system,
      prompt: USER_PROMPT,
      tools: fideTools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    console.log("\n── Assistant text ──");
    console.log(result.text.trim() || "(empty — tool-only turn)");

    console.log("\n── Allowlist ──");
    console.log(`entities: ${entityBinder.list().length}`);
    for (const entity of entityBinder.list().slice(0, 30)) {
      console.log(`  [${entity.kind}] ${entity.name} → ${shortEntityId(entity.fideId)}`);
    }

    console.log("\n── Tool trace ──");
    for (const event of trace) {
      console.log(
        `${event.ok ? "✓" : "✗"} #${event.step} ${event.tool}`
      );
      if (event.input) {
        console.log(`    in:  ${preview(event.input, 160)}`);
      }
      if (event.outputPreview) {
        console.log(`    out: ${event.outputPreview.replace(/\n/g, " ")}`);
      }
    }

    if (!captured) {
      console.error("\nFAIL: createDocument did not produce an itinerary.");
      process.exitCode = 1;
      return;
    }

    if (THROUGH_STAYS) {
      captured = approveCurrentStage(captured);
      console.log("\n── Simulated Approve Stops → stays stage ──");
      console.log(`workflow: ${JSON.stringify(ensureWorkflow(captured))}`);
      const staysResult = await generateText({
        model,
        system,
        prompt: [
          "The human clicked Approve Stops. Workflow stage is now stays.",
          "For overnight stops, run inventory/hotels-by-city per city slug, then ONE patchItinerary with patches: [{op:setStopHotel,stopId,hotelId}, …] for every stop.",
          "Lady Elliot Island is a resort island — if hotels-by-city returns no rows, skip that stop (no hotel required).",
          "Do not ask clarifying questions. Do not start the days stage. Stop when every non-island stop has a hotelId.",
          `Current itinerary JSON:\n${serializeClientItinerary(captured)}`,
        ].join("\n"),
        tools: fideTools,
        stopWhen: stepCountIs(MAX_STEPS),
      });
      console.log("\n── Stays assistant text ──");
      console.log(staysResult.text.trim() || "(empty — tool-only turn)");
    }

    if (THROUGH_DAYS) {
      captured = approveCurrentStage(captured);
      console.log("\n── Simulated Approve Stays → days stage ──");
      console.log(`workflow: ${JSON.stringify(ensureWorkflow(captured))}`);
      const daysResult = await generateText({
        model,
        system,
        prompt: [
          "The human clicked Approve Stays. Workflow stage is now days.",
          "Fill day blocks for each overnight day using inventory/activities-by-city / attractions-by-city (city slug).",
          "patchItinerary with a patches array of setDayBlocks ops (by dayId). Keep the departure morning airport-light.",
          "Do not ask clarifying questions. Stop when overnight days have named activities with Fide ids where inventory allows.",
          `Current itinerary JSON:\n${serializeClientItinerary(captured)}`,
        ].join("\n"),
        tools: fideTools,
        stopWhen: stepCountIs(MAX_STEPS),
      });
      console.log("\n── Days assistant text ──");
      console.log(daysResult.text.trim() || "(empty — tool-only turn)");
    }

    const problems = assertFideIds(captured);
    const hotelGaps: string[] = [];
    if (THROUGH_STAYS) {
      captured.stops.forEach((stop, i) => {
        const lei = /lady\s*elliot/i.test(stop.placeName);
        if (!lei && !stop.hotelId) {
          hotelGaps.push(`stops[${i}] (${stop.placeName}) — no hotel (ok if city has no hotel inventory)`);
        }
      });
    }

    console.log("\n── Itinerary JSON (bound) ──");
    console.log(JSON.stringify(captured, null, 2));

    printUiPreview(captured);

    console.log(`\n── Assertions (stage=${EVAL_STAGE}) ──`);
    if (THROUGH_STAYS) {
      const withHotels = captured.stops.filter((s) => s.hotelId).length;
      console.log(
        `stays: ${withHotels}/${captured.stops.length} stops have hotels`
      );
      for (const gap of hotelGaps) {
        console.log(`WARN: ${gap}`);
      }
      if (withHotels < 3) {
        problems.push("Expected hotels on major city stops (sydney/melbourne/…)");
      } else {
        console.log("PASS: stays stage named hotels bound with Fide ids.");
      }
      if (
        captured.stops.some(
          (s) => /lady\s*elliot/i.test(s.placeName) && !s.hotelId
        )
      ) {
        console.log(
          "PASS: Lady Elliot left without hotel row (resort island / no inventory)."
        );
      }
    }
    if (THROUGH_DAYS) {
      const overnightDays = captured.days.filter(
        (d) => !/depart/i.test(d.title ?? "")
      );
      const withBlocks = overnightDays.filter(
        (d) => (d.blocks?.length ?? 0) > 0
      ).length;
      console.log(
        `days: ${withBlocks}/${overnightDays.length} overnight days have blocks`
      );
      if (withBlocks < Math.min(2, overnightDays.length)) {
        problems.push("Expected activity blocks on at least two overnight days.");
      } else {
        console.log("PASS: days stage has activity blocks on overnight days.");
      }
      const wf = ensureWorkflow(captured);
      if (wf.stage !== "days" && wf.stage !== "complete") {
        problems.push(`Expected workflow stage days|complete after stays approve, got ${wf.stage}`);
      }
    }
    if (problems.length === 0) {
      console.log("PASS: all placeId / entityId / hotelId values are Fide ids (0x…).");
      console.log(`PASS: eval stage ${EVAL_STAGE} complete.`);
    } else {
      console.log("FAIL:");
      for (const p of problems) {
        console.log(`  - ${p}`);
      }
      process.exitCode = 1;
    }

    if (process.env.EVAL_WRITE_RAW === "1") {
      const { writeFileSync } = await import("node:fs");
      writeFileSync("scripts/.eval-last-itinerary.json", capturedRaw);
      console.log("Wrote scripts/.eval-last-itinerary.json");
    }
  } finally {
    await mcp.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
