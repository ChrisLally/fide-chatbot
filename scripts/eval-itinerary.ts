/**
 * Eval: run Taylor on a trip prompt, log tool calls, validate itinerary Fide ids.
 *
 * Usage: pnpm eval:itinerary
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
  applyItineraryPatch,
  itineraryPatchSchema,
  materializeRoute,
  proposeRouteSchema,
} from "../lib/itinerary/patch";

config({ path: resolve(process.cwd(), ".env") });

const USER_PROMPT =
  process.argv.slice(2).join(" ").trim() ||
  "make an itinerary for 4 day trip in australia. you choose from and to where and such";

const WORLD_MODEL = process.env.FIDE_WORLD_MODEL_KEY?.trim() || "catalina-world-model";
const MAX_STEPS = 16;

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
      "Create ONE itinerary artifact for this chat (kind: itinerary). Pass route.stops with placeId (did:fide:0x… from places-search) + nights only — no hotels, no activities. After create, STOP and wait for Approve Route.",
    inputSchema: z.object({
      title: z.string(),
      kind: z.literal("itinerary"),
      route: proposeRouteSchema.optional(),
    }),
    execute: async ({ title, kind, route }) => {
      stepCounter += 1;
      const step = stepCounter;
      if (!route?.stops?.length) {
        const message =
          "createDocument requires route.stops [{ placeId, nights }]";
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
      const result = materializeRoute(title, route, entityBinder);
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
        stage: "route",
        content:
          "Route itinerary is visible. STOP. Wait for Approve Route. Do not createDocument again. Do not patchItinerary hotels or days until that approve.",
      };
    },
  });

  fideTools.patchItinerary = tool({
    description:
      "Apply one typed patch to the existing itinerary. Hotels only after Approve Route. Day blocks only after Approve Stays.",
    inputSchema: z.object({
      id: z.string(),
      patch: itineraryPatchSchema,
    }),
    execute: async ({ id, patch }) => {
      stepCounter += 1;
      const step = stepCounter;
      if (!captured) {
        const message = "No itinerary yet — createDocument first.";
        console.log(`✗ [${step}] patchItinerary ${message}`);
        trace.push({
          step,
          tool: "patchItinerary",
          input: { id, patch },
          outputPreview: message,
          ok: false,
        });
        return { error: message };
      }
      const result = applyItineraryPatch(captured, patch, entityBinder);
      if (!result.ok) {
        console.log(`✗ [${step}] patchItinerary ${result.error}`);
        trace.push({
          step,
          tool: "patchItinerary",
          input: { id, patch },
          outputPreview: result.error,
          ok: false,
        });
        return { error: result.error };
      }
      captured = result.itinerary;
      capturedRaw = serializeClientItinerary(result.itinerary);
      console.log(`✓ [${step}] patchItinerary ${patch.op}`);
      trace.push({
        step,
        tool: "patchItinerary",
        input: { id, patch },
        outputPreview: preview({ op: patch.op }, 160),
        ok: true,
      });
      return {
        id,
        op: patch.op,
        content: `Itinerary patched (${patch.op}).`,
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

    const problems = assertFideIds(captured);
    console.log("\n── Itinerary JSON (bound) ──");
    console.log(JSON.stringify(captured, null, 2));

    printUiPreview(captured);

    console.log("\n── Assertions ──");
    if (problems.length === 0) {
      console.log("PASS: all placeId / entityId / hotelId values are Fide ids (0x…).");
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
