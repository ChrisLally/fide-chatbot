import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { createFideMcpClient } from "@/lib/fide/mcp-client";
import { ChatbotError } from "@/lib/errors";

const contextQueries = {
  hotels: process.env.FIDE_CONTEXT_QUERY_HOTELS ?? "inventory/hotels-all",
  hotelDetail: process.env.FIDE_CONTEXT_QUERY_HOTEL_DETAIL ?? "inventory/hotel",
  activities:
    process.env.FIDE_CONTEXT_QUERY_ACTIVITIES ?? "inventory/activities-all",
  activityDetail:
    process.env.FIDE_CONTEXT_QUERY_ACTIVITY_DETAIL ?? "inventory/activity",
  attractions:
    process.env.FIDE_CONTEXT_QUERY_ATTRACTIONS ?? "inventory/attractions-all",
  attractionDetail:
    process.env.FIDE_CONTEXT_QUERY_ATTRACTION_DETAIL ?? "inventory/attraction",
  itineraries:
    process.env.FIDE_CONTEXT_QUERY_ITINERARIES ?? "inventory/itineraries-all",
  collections:
    process.env.FIDE_CONTEXT_QUERY_COLLECTIONS ?? "inventory/collections-all",
  collectionDetail:
    process.env.FIDE_CONTEXT_QUERY_COLLECTION_DETAIL ?? "inventory/collection",
  sameAsLinks:
    process.env.FIDE_CONTEXT_QUERY_SAME_AS ?? "inventory/same-as-links",
  itineraryDetail:
    process.env.FIDE_CONTEXT_QUERY_ITINERARY_DETAIL ?? "inventory/itinerary",
  destinations:
    process.env.FIDE_CONTEXT_QUERY_DESTINATIONS ?? "inventory/places",
  destinationDetail:
    process.env.FIDE_CONTEXT_QUERY_DESTINATION_DETAIL ??
    "inventory/place",
  transportation:
    process.env.FIDE_CONTEXT_QUERY_TRANSPORTATION ?? "inventory/transport-all",
  transportationDetail:
    process.env.FIDE_CONTEXT_QUERY_TRANSPORTATION_DETAIL ??
    "inventory/transport-option",
} as const;

const contextQuerySchema = z.object({
  query: z.enum(Object.keys(contextQueries) as [keyof typeof contextQueries]),
  params: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
  worldModelKey: z.string().optional(),
});

function parseMcpJsonText(result: unknown): unknown {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return result;
  }

  const text = content
    .map((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .join("")
    .trim();

  if (!text) {
    return result;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function resolveWorldModelKey(client: Awaited<ReturnType<typeof createFideMcpClient>>) {
  if (!client) {
    return null;
  }

  const configured = process.env.FIDE_WORLD_MODEL_KEY?.trim();
  if (configured) {
    return configured;
  }

  const result = await client.callTool({ name: "list_world_models" });
  const parsed = parseMcpJsonText(result);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  const catalina =
    parsed.find((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const key =
        (entry as { worldModelKey?: unknown }).worldModelKey ??
        (entry as { key?: unknown }).key;
      return (
        typeof key === "string" &&
        key.toLowerCase().includes("catalina")
      );
    }) ?? parsed[0];

  if (!catalina || typeof catalina !== "object") {
    return null;
  }

  const key =
    (catalina as { worldModelKey?: unknown }).worldModelKey ??
    (catalina as { key?: unknown }).key;

  return typeof key === "string" ? key : null;
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:api").toResponse();
  }

  let input: z.infer<typeof contextQuerySchema>;

  try {
    input = contextQuerySchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const client = await createFideMcpClient();

  if (!client) {
    return new ChatbotError(
      "bad_request:api",
      "Fide MCP is not configured"
    ).toResponse();
  }

  try {
    const worldModelKey =
      input.worldModelKey ?? (await resolveWorldModelKey(client));

    if (!worldModelKey) {
      return new ChatbotError(
        "bad_request:api",
        "No Fide world model is available"
      ).toResponse();
    }

    const queryKey = contextQueries[input.query];
    const result = await client.callTool({
      name: "run_query",
      arguments: {
        worldModelKey,
        queryKey,
        ...(input.params ? { params: input.params } : {}),
      },
    });

    return Response.json({
      ok: true,
      query: input.query,
      queryKey,
      worldModelKey,
      result: parseMcpJsonText(result),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Context query failed";

    return new ChatbotError("bad_request:api", message).toResponse();
  } finally {
    await client.close().catch(() => undefined);
  }
}
