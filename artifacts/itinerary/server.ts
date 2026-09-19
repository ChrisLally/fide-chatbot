import { streamText } from "ai";
import {
  itineraryPrompt,
  updateDocumentPrompt,
} from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/artifacts/server";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
import {
  clientItinerarySchema,
  hasUnresolvedEntityIds,
  parseClientItinerary,
  serializeClientItinerary,
  stripJsonFences,
  type ClientItinerary,
} from "@/lib/itinerary/schema";
import { verifyItineraryStage } from "@/lib/itinerary/stage-verifier";
import {
  ensureWorkflow,
  mergeStageUpdate,
  projectToStage,
  STAGE_LABELS,
  stubDaysForStops,
  type ItineraryStage,
} from "@/lib/itinerary/stages";
import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";

const MAX_ITINERARY_ATTEMPTS = 3;

function publishDraft(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  draft: string
) {
  dataStream.write({
    type: "data-itineraryDelta",
    data: stripJsonFences(draft),
    transient: true,
  });
}

function stageSystemAddon(stage: ItineraryStage): string {
  if (stage === "route") {
    return `ACTIVE STAGE = route. Output stops + nights + transfers (arrival / between / departure). days may be stubs with empty blocks. NO hotels. NO activity blocks. Set workflow.stage to "route".`;
  }
  if (stage === "stays") {
    return `ACTIVE STAGE = stays. Keep places/nights fixed. Add hotelName/hotelId per stop. Do not rewrite the route. Set workflow.stage to "stays".`;
  }
  if (stage === "days") {
    return `ACTIVE STAGE = days. Keep stops and hotels fixed. Fill day titles/descriptions/blocks only. Set workflow.stage to "days".`;
  }
  return `ACTIVE STAGE = complete. Only make the requested edits.`;
}

async function streamItineraryJson({
  modelId,
  system,
  prompt,
  dataStream,
}: {
  modelId: string;
  system: string;
  prompt: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}): Promise<string> {
  let draftContent = "";

  const { fullStream } = streamText({
    model: getLanguageModel(modelId),
    system,
    prompt,
  });

  for await (const delta of fullStream) {
    if (delta.type === "text-delta") {
      draftContent += delta.text;
      publishDraft(dataStream, draftContent);
    }
  }

  return stripJsonFences(draftContent);
}

function finalizeItinerary(
  itinerary: ClientItinerary,
  stage: ItineraryStage,
  previous?: ClientItinerary
): ClientItinerary {
  let next =
    previous && stage !== "route"
      ? mergeStageUpdate(previous, itinerary)
      : projectToStage(itinerary, stage === "complete" ? "complete" : stage);

  if (next.days.length === 0) {
    next = { ...next, days: stubDaysForStops(next.stops) };
  }

  next = {
    ...next,
    workflow: {
      stage,
      approved: previous
        ? ensureWorkflow(previous).approved
        : stage === "route"
          ? {}
          : ensureWorkflow(next).approved,
    },
  };

  return next;
}

async function generateValidItineraryJson({
  modelId,
  baseSystem,
  prompt,
  dataStream,
  entityBinder,
  stage,
  previous,
}: {
  modelId: string;
  baseSystem: string;
  prompt: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  entityBinder?: TurnEntityBinder;
  stage: ItineraryStage;
  previous?: ClientItinerary;
}): Promise<string> {
  let lastError = "unknown validation error";
  let lastDraft = "";

  const allowlistBlock = entityBinder?.contextForPrompt() ?? "";
  const enrichedBase = [
    baseSystem,
    stageSystemAddon(stage),
    allowlistBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  for (let attempt = 1; attempt <= MAX_ITINERARY_ATTEMPTS; attempt++) {
    const system =
      attempt === 1
        ? `${enrichedBase}\n\nOutput ONLY valid JSON for ClientItinerary. No markdown fences, no commentary.
Use exact allowlisted place/hotel/activity names. You may omit placeId/entityId (server binds Fide ids) or leave them blank — never invent ids.`
        : `${enrichedBase}

Previous attempt failed validation:
${lastError}

Fix the JSON and output ONLY valid ClientItinerary JSON for stage ${stage}.
No markdown fences, no commentary.`;

    const attemptPrompt =
      attempt === 1
        ? prompt
        : `${prompt}

Repair the previous invalid draft into valid ClientItinerary JSON for stage ${stage}.
Invalid draft was:
${lastDraft.slice(0, 6000)}`;

    lastDraft = await streamItineraryJson({
      modelId,
      system,
      prompt: attemptPrompt,
      dataStream,
    });

    const parsed = parseClientItinerary(lastDraft, {
      allowUnbound: Boolean(entityBinder),
    });
    if (!parsed.ok) {
      lastError = parsed.error;
      continue;
    }

    let candidate = parsed.data;
    if (entityBinder) {
      const { itinerary, omitted } = entityBinder.bind(parsed.data);
      if (itinerary.stops.length === 0) {
        lastError =
          omitted.length > 0
            ? `No allowlisted stops after bind (omitted: ${omitted.join("; ")}). run_view places-search / hotels-by-city first.`
            : "No allowlisted stops after bind — run_view inventory before createDocument.";
        continue;
      }
      if (stage !== "route" && hasUnresolvedEntityIds(itinerary)) {
        // Route may have empty blocks; stays/days need bound entities when present
        const hotelMissing = itinerary.stops.some(
          (s) => s.hotelName && !s.hotelId
        );
        if (hotelMissing || stage === "days") {
          lastError = `Bind left unresolved ids (omitted: ${omitted.join("; ") || "none"}). Use exact allowlisted names.`;
          continue;
        }
      }
      candidate = itinerary;
    }

    candidate = finalizeItinerary(candidate, stage, previous);

    // Route stage: unresolved empty blocks OK; places must be fide
    if (hasUnresolvedEntityIds({
      ...candidate,
      days: candidate.days.map((d) => ({ ...d, blocks: [] })),
      stops: candidate.stops.map((s) => ({
        placeId: s.placeId,
        placeName: s.placeName,
        nights: s.nights,
      })),
    })) {
      lastError = "Stop places must bind to Fide ids.";
      continue;
    }

    const strict = clientItinerarySchema.safeParse(candidate);
    if (!strict.success) {
      lastError = strict.error.message;
      continue;
    }

    const verified = verifyItineraryStage(strict.data, stage);
    if (!verified.ok && stage === "route") {
      // Soft: keep draft but attach warnings in summary only for hard errors on create
      lastError = verified.errors.join("; ");
      // Allow through with errors only if not Cairns+PD etc — actually fail so model repairs
      continue;
    }

    const serialized = serializeClientItinerary(strict.data);
    publishDraft(dataStream, serialized);
    return serialized;
  }

  throw new Error(
    `Itinerary JSON failed validation after ${MAX_ITINERARY_ATTEMPTS} attempts (${STAGE_LABELS[stage]}): ${lastError}`
  );
}

export const itineraryDocumentHandler = createDocumentHandler<"itinerary">({
  kind: "itinerary",
  onCreateDocument: async ({ title, dataStream, modelId, entityBinder }) => {
    return generateValidItineraryJson({
      modelId,
      baseSystem: itineraryPrompt,
      prompt: `${title}\n\nCreate the ROUTE stage only (stops + nights + transport transfers between them).`,
      dataStream,
      entityBinder,
      stage: "route",
    });
  },
  onUpdateDocument: async ({
    document,
    description,
    dataStream,
    modelId,
    entityBinder,
  }) => {
    const previousParsed = parseClientItinerary(document.content ?? "");
    const previous = previousParsed.ok ? previousParsed.data : undefined;
    const stage = previous ? ensureWorkflow(previous).stage : "route";

    return generateValidItineraryJson({
      modelId,
      baseSystem: updateDocumentPrompt(document.content, "itinerary"),
      prompt: description,
      dataStream,
      entityBinder,
      stage: stage === "complete" ? "complete" : stage,
      previous,
    });
  },
});
