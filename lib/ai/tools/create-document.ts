import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  creatableArtifactKinds,
  documentHandlersByArtifactKind,
} from "@/lib/artifacts/server";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
import { proposeRouteSchema } from "@/lib/itinerary/patch";
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
      "Create a Catalina itinerary artifact (kind: itinerary). Pass route.stops with placeId (did:fide:0x… from places-search) + nights. After create, patchItinerary with hotelId / entityId — never titles.",
    inputSchema: z.object({
      title: z.string().describe("The title of the itinerary"),
      kind: z
        .enum(creatableArtifactKinds)
        .describe("REQUIRED. Must be 'itinerary'."),
      route: proposeRouteSchema
        .optional()
        .describe(
          "Route slice: stops with placeId (did:fide:0x…) + nights, optional transfers.",
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
          hint: "Call run_view on places/hotels/activities first, then createDocument again using exact inventory names (server binds Fide ids).",
        };
      }

      dataStream.write({ type: "data-finish", data: null, transient: true });

      return {
        id,
        title,
        kind,
        content:
          "A structured itinerary was generated, saved, and is now visible. Use patchItinerary for hotels, days, nights, and edits.",
      };
    },
  });
