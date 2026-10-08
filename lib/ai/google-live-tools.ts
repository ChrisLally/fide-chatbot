/**
 * Vertex Live function declarations — mirrors `realtimeTools` in realtime.ts.
 * Kept as plain JSON Schema for the raw WebSocket setup payload.
 */

export type VertexLiveFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const GOOGLE_LIVE_FUNCTION_DECLARATIONS: VertexLiveFunctionDeclaration[] =
  [
    {
      name: "getWeather",
      description: "Get the current weather at a location. Provide a city name.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "City name (e.g., 'San Francisco', 'New York')",
          },
        },
        required: ["city"],
      },
    },
    {
      name: "list_world_models",
      description:
        "List Fide world models on the user's workspace runner. Use this first for Catalina Quest data questions.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_views",
      description:
        "List agent-facing views for a Fide world model. Use after list_world_models.",
      parameters: {
        type: "object",
        properties: {
          worldModelKey: {
            type: "string",
            description: "The world model key",
          },
        },
        required: ["worldModelKey"],
      },
    },
    {
      name: "get_view",
      description:
        "Get a Fide view definition, including parameters and shape. Use before run_view when parameters are unclear.",
      parameters: {
        type: "object",
        properties: {
          worldModelKey: {
            type: "string",
            description: "The world model key",
          },
          viewKey: {
            type: "string",
            description: "The view key",
          },
        },
        required: ["worldModelKey", "viewKey"],
      },
    },
    {
      name: "run_view",
      description:
        "Execute a Fide view and return formatted text output. Use this to fetch the information you base answers on.",
      parameters: {
        type: "object",
        properties: {
          worldModelKey: {
            type: "string",
            description: "The world model key",
          },
          viewKey: {
            type: "string",
            description: "The view key",
          },
          params: {
            type: "object",
            description: "Optional view parameters",
            additionalProperties: {
              oneOf: [{ type: "string" }, { type: "number" }],
            },
          },
          output: {
            type: "string",
            enum: ["text"],
            description: "Output format",
          },
        },
        required: ["worldModelKey", "viewKey"],
      },
    },
  ];

export const GOOGLE_LIVE_TOOLS_SETUP = [
  {
    function_declarations: GOOGLE_LIVE_FUNCTION_DECLARATIONS,
  },
];

export const FIDE_LIVE_TOOL_NAMES = new Set([
  "list_world_models",
  "list_views",
  "get_view",
  "run_view",
]);
