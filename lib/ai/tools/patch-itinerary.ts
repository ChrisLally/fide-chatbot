import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById, saveDocument } from "@/lib/db/queries";
import {
  applyItineraryPatch,
  itineraryPatchSchema,
} from "@/lib/itinerary/patch";
import { parseClientItinerary, serializeClientItinerary } from "@/lib/itinerary/schema";
import type { TurnEntityBinder } from "@/lib/itinerary/entity-binder";
import type { ChatMessage } from "@/lib/types";

type PatchItineraryProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  entityBinder?: TurnEntityBinder;
};

export const patchItinerary = ({
  session,
  dataStream,
  entityBinder,
}: PatchItineraryProps) =>
  tool({
    description:
      "Apply a typed patch to an existing itinerary. Pass Fide ids (did:fide:0x…) from run_view for hotels, places, and day blocks — not titles. One op per call.",
    inputSchema: z.object({
      id: z.string().describe("The itinerary artifact id"),
      patch: itineraryPatchSchema,
    }),
    execute: async ({ id, patch }) => {
      const document = await getDocumentById({ id });
      if (!document) {
        return { error: "Document not found" };
      }
      if (document.userId !== session.user?.id) {
        return { error: "Forbidden" };
      }
      if (document.kind !== "itinerary") {
        return {
          error: "patchItinerary only works on itinerary artifacts.",
        };
      }

      const parsed = parseClientItinerary(document.content ?? "");
      if (!parsed.ok) {
        return { error: `Cannot patch invalid itinerary JSON: ${parsed.error}` };
      }

      const result = applyItineraryPatch(parsed.data, patch, entityBinder);
      if (!result.ok) {
        return {
          error: result.error,
          omitted: result.omitted,
          hint: "Copy did:fide:0x… from run_view and retry this op. Do not send titles as ids.",
        };
      }

      const content = serializeClientItinerary(result.itinerary);
      await saveDocument({
        id: document.id,
        title: result.itinerary.title || document.title,
        kind: "itinerary",
        content,
        userId: document.userId,
      });

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });
      dataStream.write({
        type: "data-itineraryDelta",
        data: content,
        transient: true,
      });
      dataStream.write({ type: "data-finish", data: null, transient: true });

      return {
        id,
        title: result.itinerary.title,
        kind: "itinerary" as const,
        op: patch.op,
        omitted: result.omitted,
        content: `Itinerary patched (${patch.op}). Do not resend the full JSON.`,
      };
    },
  });
