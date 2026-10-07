import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  creatableArtifactKinds,
  documentHandlersByArtifactKind,
} from "@/lib/artifacts/server";
import { getDocumentById } from "@/lib/db/queries";
import { buildItineraryToolStatus } from "@/lib/itinerary/agent-status";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
import { proposeStopsSchema } from "@/lib/itinerary/patch";
import { parseClientItinerary } from "@/lib/itinerary/schema";
import {
  itineraryToolErrorFromUnknown,
  ItineraryToolError,
} from "@/lib/itinerary/tool-error";
import { loadPlacePoliciesFromWorldModel } from "@/lib/itinerary/wm-place-policy";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type CreateDocumentProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
  entityBinder?: TurnEntityBinder;
};

export const createDocument = ({
  session,
  dataStream,
  modelId,
  entityBinder,
}: CreateDocumentProps) =>
  tool({
    description:
      "Create ONE itinerary artifact for this chat (kind: itinerary). Pass top-level stops covering the full requested trip length (placeId + nights) plus optional transfers. No hotels, no activities, no leftover TBD nights. Always read the returned `status` (stage, approveButtonClickable, errors, stops, fixes). On failure read `code` + `hint` and retry once — never invent a second itinerary. If Approve Stops is clickable, STOP this turn and wait for the human — do not look up hotels or patch days yet, even if they asked for a full trip.",
    inputSchema: z.object({
      title: z.string().describe("The title of the itinerary"),
      kind: z
        .enum(creatableArtifactKinds)
        .describe("REQUIRED. Must be 'itinerary'."),
      stops: proposeStopsSchema.shape.stops
        .optional()
        .describe(
          "Overnight stops: placeId (did:fide:0x…) + nights. Required in practice."
        ),
      transfers: proposeStopsSchema.shape.transfers.describe(
        "Optional arrival / between / departure legs with transportOptionIri from transport-corridor."
      ),
      summary: proposeStopsSchema.shape.summary,
      startDate: proposeStopsSchema.shape.startDate,
      durationDays: proposeStopsSchema.shape.durationDays,
    }),
    execute: async ({ title, kind, stops, transfers, summary, startDate, durationDays }) => {
      const id = generateUUID();

      dataStream.write({
        type: "data-kind",
        data: kind,
        transient: true,
      });

      dataStream.write({
        type: "data-id",
        data: id,
        transient: true,
      });

      dataStream.write({
        type: "data-title",
        data: title,
        transient: true,
      });

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === kind
      );

      if (!documentHandler) {
        return new ItineraryToolError({
          code: "UNKNOWN_KIND",
          message: `No document handler found for kind: ${kind}`,
          hint: "kind must be 'itinerary'.",
        }).toToolResult();
      }

      const proposeStops =
        stops && stops.length > 0
          ? { title, summary, startDate, durationDays, stops, transfers }
          : undefined;

      try {
        await documentHandler.onCreateDocument({
          id,
          title,
          dataStream,
          session,
          modelId,
          entityBinder,
          stops: proposeStops,
        });
      } catch (error) {
        dataStream.write({ type: "data-finish", data: null, transient: true });
        return itineraryToolErrorFromUnknown(error);
      }

      dataStream.write({ type: "data-finish", data: null, transient: true });

      const saved = await getDocumentById({ id });
      const parsed = parseClientItinerary(saved?.content ?? "");
      let status = undefined;
      if (parsed.ok) {
        const placePolicies = await loadPlacePoliciesFromWorldModel(
          parsed.data.stops.map((stop) => stop.placeId)
        );
        status = buildItineraryToolStatus(parsed.data, placePolicies);
      }

      return {
        id,
        title,
        kind,
        status,
        content:
          status?.nextAction ??
          "Stops itinerary is visible. STOP — wait for Approve Stops. Do not add hotels or days. Do not createDocument again.",
      };
    },
  });
