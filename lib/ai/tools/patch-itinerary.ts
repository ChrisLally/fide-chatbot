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
import { itineraryWithRankings, publishJevScores } from "@/lib/itinerary/jev";
import type { ChatMessage } from "@/lib/types";

type PatchItineraryProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  entityBinder?: TurnEntityBinder;
  lastUserText?: string;
};

export const patchItinerary = ({
  session,
  dataStream,
  entityBinder,
  lastUserText = "",
}: PatchItineraryProps) =>
  tool({
    description:
      "Apply one typed patch to the existing itinerary. Hotels only after Approve Route (stage stays). Day blocks only after Approve Stays (stage days). Pass did:fide:0x… ids, not titles. Never call this to finish the whole trip in one turn.",
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

      const scores = await publishJevScores(
        dataStream,
        result.itinerary,
        lastUserText
      );
      const next = scores
        ? itineraryWithRankings(result.itinerary, scores)
        : result.itinerary;
      const content = serializeClientItinerary(next);
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
        stop:
          patch.op === "setStopHotel" || patch.op === "proposeStay"
            ? {
                stopIndex: patch.stopIndex,
                hotelId: result.itinerary.stops[patch.stopIndex]?.hotelId,
                hotelName: result.itinerary.stops[patch.stopIndex]?.hotelName,
              }
            : undefined,
        content: `Itinerary patched (${patch.op}). Do not resend the full JSON.`,
      };
    },
  });
