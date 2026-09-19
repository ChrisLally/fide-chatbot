import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { documentHandlersByArtifactKind } from "@/lib/artifacts/server";
import { getDocumentById } from "@/lib/db/queries";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
import type { ChatMessage } from "@/lib/types";

type UpdateDocumentProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
  entityBinder?: TurnEntityBinder;
};

export const updateDocument = ({
  session,
  dataStream,
  modelId,
  entityBinder,
}: UpdateDocumentProps) =>
  tool({
    description:
      "Full rewrite of an existing non-itinerary artifact. Do NOT use for itineraries — call patchItinerary instead.",
    inputSchema: z.object({
      id: z.string().describe("The ID of the artifact to rewrite"),
      description: z
        .string()
        .default("Improve the content")
        .describe("The description of changes that need to be made"),
    }),
    execute: async ({ id, description }) => {
      const document = await getDocumentById({ id });

      if (!document) {
        return {
          error: "Document not found",
        };
      }

      if (document.userId !== session.user?.id) {
        return { error: "Forbidden" };
      }

      if (document.kind === "itinerary") {
        return {
          error:
            "updateDocument is disabled for itineraries. Use patchItinerary with one typed op (setStopHotel, proposeDay, setStopNights, …).",
        };
      }

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === document.kind
      );

      if (!documentHandler) {
        throw new Error(`No document handler found for kind: ${document.kind}`);
      }

      try {
        await documentHandler.onUpdateDocument({
          document,
          description,
          dataStream,
          session,
          modelId,
          entityBinder,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update document";
        dataStream.write({ type: "data-finish", data: null, transient: true });
        return {
          error: message,
          hint:
            document.kind === "itinerary"
              ? "Retry updateDocument after run_view inventory; use exact allowlisted names (server binds Fide ids)."
              : undefined,
        };
      }

      dataStream.write({ type: "data-finish", data: null, transient: true });

      return {
        id,
        title: document.title,
        kind: document.kind,
        content:
          document.kind === "code"
            ? "The script has been updated successfully."
            : document.kind === "itinerary"
              ? "The itinerary was updated successfully."
              : "The document has been updated successfully.",
      };
    },
  });
