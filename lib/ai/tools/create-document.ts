import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  creatableArtifactKinds,
  documentHandlersByArtifactKind,
} from "@/lib/artifacts/server";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
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
      "Create a structured Catalina client itinerary artifact (JSON canvas). Only kind 'itinerary' is allowed — never text/markdown, code, or sheet. After this tool succeeds, do not call editDocument or updateDocument unless the user explicitly asks for changes.",
    inputSchema: z.object({
      title: z.string().describe("The title of the itinerary"),
      kind: z
        .enum(creatableArtifactKinds)
        .describe("REQUIRED. Must be 'itinerary'."),
    }),
    execute: async ({ title, kind }) => {
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
          "A structured itinerary was generated, saved, and is now visible to the user. Do not call editDocument or updateDocument unless the user explicitly asks for changes.",
      };
    },
  });
