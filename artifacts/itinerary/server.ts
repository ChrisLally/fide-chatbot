import { createDocumentHandler } from "@/lib/artifacts/server";
import { materializeRoute } from "@/lib/itinerary/patch";
import { itineraryWithRankings, publishJevScores } from "@/lib/itinerary/jev";
import { serializeClientItinerary, stripJsonFences } from "@/lib/itinerary/schema";
import type { UIMessageStreamWriter } from "ai";
import type { ChatMessage } from "@/lib/types";

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

export const itineraryDocumentHandler = createDocumentHandler<"itinerary">({
  kind: "itinerary",
  onCreateDocument: async ({ title, dataStream, entityBinder, route }) => {
    if (!route?.stops?.length) {
      throw new Error(
        "createDocument requires route.stops [{ placeId, nights }]. Do not generate a second itinerary. run_view places-search first."
      );
    }
    const result = materializeRoute(title, route, entityBinder);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const serialized = serializeClientItinerary(result.itinerary);
    publishDraft(dataStream, serialized);
    const scores = await publishJevScores(
      dataStream,
      result.itinerary,
      result.itinerary.summary
    );
    if (!scores) {
      return serialized;
    }
    const ranked = serializeClientItinerary(
      itineraryWithRankings(result.itinerary, scores)
    );
    publishDraft(dataStream, ranked);
    return ranked;
  },
  onUpdateDocument: async () => {
    throw new Error(
      "updateDocument is disabled for itineraries. Use patchItinerary with a single typed op."
    );
  },
});
