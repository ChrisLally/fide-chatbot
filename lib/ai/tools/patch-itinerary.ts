import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById, saveDocument } from "@/lib/db/queries";
import { buildItineraryToolStatus } from "@/lib/itinerary/agent-status";
import { withArtifactLock } from "@/lib/itinerary/artifact-lock";
import {
  applyItineraryPatches,
  itineraryPatchSchema,
} from "@/lib/itinerary/patch";
import { loadPlacePoliciesFromWorldModel } from "@/lib/itinerary/wm-place-policy";
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
      "Apply a batch of typed itinerary ops in one call (`patches: [...]`, even for a single op). Ops run atomically on one document snapshot. Require baseVersion from status.version. Hotels only after Approve Stops; day blocks only after stays. Address stops/days by stopId/dayId. Pass did:fide:0x… ids. Always read returned `status` before your next message.",
    inputSchema: z.object({
      id: z.string().describe("The itinerary artifact id"),
      baseVersion: z
        .number()
        .int()
        .min(1)
        .describe("Current status.version — reject with VERSION_CONFLICT if stale"),
      patches: z
        .array(itineraryPatchSchema)
        .min(1)
        .describe(
          "Ordered ops to apply in one atomic transaction. Example stays: [{op:setStopHotel,stopId:\"s1\",hotelId},…]"
        ),
    }),
    execute: async ({ id, baseVersion, patches }) => {
      return withArtifactLock(id, async () => {
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

        const placeIds = [
          ...parsed.data.stops.map((stop) => stop.placeId),
          ...patches.flatMap((patch) =>
            "placeId" in patch && typeof patch.placeId === "string"
              ? [patch.placeId]
              : []
          ),
        ];
        const placePolicies = await loadPlacePoliciesFromWorldModel(placeIds);
        const currentVersion = parsed.data.version ?? 1;

        if (baseVersion !== currentVersion) {
          return {
            error: `VERSION_CONFLICT: document is at version ${currentVersion}, you sent baseVersion ${baseVersion}. Re-read status and re-evaluate intent — do not blind-resubmit.`,
            code: "VERSION_CONFLICT",
            status: buildItineraryToolStatus(parsed.data, placePolicies),
          };
        }

        const result = applyItineraryPatches(
          parsed.data,
          patches,
          entityBinder,
          { placePolicies }
        );
        if (!result.ok) {
          return {
            error: result.error,
            diagnostics: result.diagnostics,
            hint: "Copy did:fide:0x… from run_view and retry. Use one patches array — do not call patchItinerary in parallel. Address by stopId/dayId.",
            status: buildItineraryToolStatus(parsed.data, placePolicies),
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

        const status = buildItineraryToolStatus(next, placePolicies);

        return {
          id,
          title: result.itinerary.title,
          kind: "itinerary" as const,
          ops: patches.map((patch) => patch.op),
          status,
          content: `Itinerary patched (${patches.length} op(s): ${patches.map((p) => p.op).join(", ")}). Read status.nextAction / status.version. Do not resend the full JSON.`,
        };
      });
    },
  });
