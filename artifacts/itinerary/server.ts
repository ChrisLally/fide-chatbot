import { createDocumentHandler } from "@/lib/artifacts/server";
import { materializeStops } from "@/lib/itinerary/patch";
import { loadPlacePoliciesFromWorldModel } from "@/lib/itinerary/wm-place-policy";
import { serializeClientItinerary, stripJsonFences } from "@/lib/itinerary/schema";
import { ItineraryToolError } from "@/lib/itinerary/tool-error";
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
  onCreateDocument: async ({ title, dataStream, entityBinder, stops }) => {
    if (!stops?.stops?.length) {
      throw new ItineraryToolError({
        code: "STOPS_REQUIRED",
        message:
          "createDocument requires stops [{ placeId, nights }]. Do not generate a second itinerary.",
        hint: "run_view inventory/places-search, then retry createDocument with stops [{ placeId, nights }].",
      });
    }
    const placePolicies = await loadPlacePoliciesFromWorldModel(
      stops.stops.map((stop) => stop.placeId)
    );
    const result = materializeStops(title, stops, entityBinder, {
      placePolicies,
    });
    if (!result.ok) {
      const code = result.diagnostics[0]?.code ?? "MATERIALIZE_FAILED";
      throw new ItineraryToolError({
        code,
        message: result.error,
        hint:
          code === "TRANSFER_INDEX_OOR"
            ? "Fix transfer fromStopIndex/toStopIndex against the stops array (-1 = arrival, stops.length = departure), then retry once."
            : code === "VERIFIER_BLOCK"
              ? "Fix stay min/max or incompatible overnight bases (e.g. Cairns+Port Douglas), then retry createDocument once."
              : "Fix the coded error and retry createDocument once. Do not open a second itinerary.",
        diagnostics: result.diagnostics,
      });
    }
    const serialized = serializeClientItinerary(result.itinerary);
    publishDraft(dataStream, serialized);
    return serialized;
  },
  onUpdateDocument: async () => {
    throw new ItineraryToolError({
      code: "UPDATE_DISABLED",
      message:
        "updateDocument is disabled for itineraries. Use patchItinerary with patches: [{ op, … }].",
      hint: "Call patchItinerary with baseVersion from status.version.",
    });
  },
});
