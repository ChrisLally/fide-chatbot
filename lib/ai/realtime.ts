import { tool } from "ai";
import { z } from "zod";

export const XAI_VOICE_MODEL =
  process.env.NEXT_PUBLIC_XAI_VOICE_MODEL ??
  process.env.XAI_VOICE_MODEL ??
  "grok-voice-latest";

export const realtimeTools = {
  getWeather: tool({
    description:
      "Get the current weather at a location. Provide a city name.",
    inputSchema: z.object({
      city: z
        .string()
        .describe("City name (e.g., 'San Francisco', 'New York')"),
    }),
  }),
};
