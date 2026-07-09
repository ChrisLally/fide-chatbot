import { tool } from "ai";
import { z } from "zod";
import { regularPrompt, worldModelPrompt } from "./prompts";

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
  list_world_models: tool({
    description:
      "List Fide world models on the user's workspace runner. Use this first for Catalina Quest data questions.",
    inputSchema: z.object({}),
  }),
  list_views: tool({
    description:
      "List agent-facing views for a Fide world model. Use after list_world_models.",
    inputSchema: z.object({
      worldModelKey: z.string().describe("The world model key"),
    }),
  }),
  get_view: tool({
    description:
      "Get a Fide view definition, including parameters and shape. Use before run_view when parameters are unclear.",
    inputSchema: z.object({
      worldModelKey: z.string().describe("The world model key"),
      viewKey: z.string().describe("The view key"),
    }),
  }),
  run_view: tool({
    description:
      "Execute a Fide view and return formatted text output. Use this to fetch the information you base answers on.",
    inputSchema: z.object({
      worldModelKey: z.string().describe("The world model key"),
      viewKey: z.string().describe("The view key"),
      params: z
        .record(z.union([z.string(), z.number()]))
        .optional()
        .describe("Optional view parameters"),
      output: z.enum(["text"]).optional().describe("Output format"),
    }),
  }),
};

export const realtimeInstructions = `${regularPrompt}

${worldModelPrompt}

You are speaking with the user by voice. Keep answers concise, conversational, and easy to follow aloud.`;
