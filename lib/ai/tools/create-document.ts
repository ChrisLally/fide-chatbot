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
import { proposeRouteSchema } from "@/lib/itinerary/patch";
import { parseClientItinerary } from "@/lib/itinerary/schema";
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
      "Create ONE itinerary artifact for this chat (kind: itinerary). Pass route.stops covering the full requested trip length (placeId + nights). No hotels, no activities, no leftover TBD nights. Always read the returned `status` (stage, approveButtonClickable, errors, stops). If Approve is clickable, STOP and wait; if not, fix before stopping.",
    inputSchema: z.object({
      title: z.string().describe("The title of the itinerary"),
      kind: z
        .enum(creatableArtifactKinds)
        .describe("REQUIRED. Must be 'itinerary'."),
      route: proposeRouteSchema
        .optional()
        .describe(
          "Route slice: stops with placeId (did:fide:0x…) + nights, optional transfers."
        ),
    }),
    execute: async ({ title, kind, route }) => {
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
        throw new Error(`No document handler found for kind: ${kind}`);
      }

      try {
        await documentHandler.onCreateDocument({
          id,
          title,
          dataStream,
          session,
          modelId,
          entityBinder,
          route,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create itinerary";
        dataStream.write({ type: "data-finish", data: null, transient: true });
        return {
          error: message,
          hint: "run_view inventory/places-search, then retry createDocument with route.stops placeId + nights. Do not open a second itinerary. Do not add hotels yet.",
        };
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
          "Route itinerary is visible. Read status if present. Do not createDocument again.",
      };
    },
  });
