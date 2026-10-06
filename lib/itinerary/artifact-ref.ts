/** Client-safe helpers to recover the latest itinerary artifact from chat messages. */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export type ItineraryArtifactRef = {
  id: string;
  title?: string;
  kind: "itinerary";
};

/** Latest createDocument / patchItinerary artifact from tool parts. */
export function lastItineraryArtifactRef(
  messages: Array<{ parts?: unknown[] }>
): ItineraryArtifactRef | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i]?.parts ?? []) {
      const record = asRecord(part);
      if (!record) {
        continue;
      }
      const type = String(record.type ?? "");
      const toolName = String(record.toolName ?? record.tool ?? "");
      const output = asRecord(record.output) ?? asRecord(record.result);
      if (!output) {
        continue;
      }
      const id = output.id;
      if (typeof id !== "string" || id.length < 8) {
        continue;
      }
      const kind = output.kind;
      if (
        kind === "itinerary" ||
        type.includes("createDocument") ||
        type.includes("patchItinerary") ||
        toolName === "createDocument" ||
        toolName === "patchItinerary"
      ) {
        const title =
          typeof output.title === "string" && output.title.trim()
            ? output.title.trim()
            : undefined;
        return { id, title, kind: "itinerary" };
      }
    }
  }
  return undefined;
}

/** Latest createDocument / patchItinerary artifact id from tool parts. */
export function lastItineraryArtifactId(
  messages: Array<{ parts?: unknown[] }>
): string | undefined {
  return lastItineraryArtifactRef(messages)?.id;
}
