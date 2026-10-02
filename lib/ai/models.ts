const litellmConfigured = Boolean(
  process.env.LITELLM_BASE_URL?.trim() && process.env.LITELLM_API_KEY?.trim()
);

/** Always available for LiteLLM → Bedrock fallback. */
export const BEDROCK_CHAT_MODEL =
  "global.anthropic.claude-haiku-4-5-20251001-v1:0";

/** LiteLLM model id when gateway is configured; otherwise Bedrock Haiku. */
export const DEFAULT_CHAT_MODEL = litellmConfigured
  ? process.env.LITELLM_MODEL?.trim() || "claude-sonnet-5"
  : BEDROCK_CHAT_MODEL;

export const titleModel = litellmConfigured
  ? {
      id: DEFAULT_CHAT_MODEL,
      name: "Taylor 2.0",
      provider: "litellm",
      description: "Chat model via Azure LiteLLM gateway",
    }
  : {
      id: BEDROCK_CHAT_MODEL,
      name: "Taylor 2.0",
      provider: "amazon-bedrock",
      description: "Fast model for title generation",
    };

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  capabilities: ModelCapabilities;
};

export const chatModels: ChatModel[] = litellmConfigured
  ? [
      {
        id: DEFAULT_CHAT_MODEL,
        name: "Taylor 2.0",
        provider: "litellm",
        description: "Azure LiteLLM gateway (OpenAI-compatible)",
        capabilities: { tools: true, vision: true, reasoning: false },
      },
    ]
  : [
      {
        id: BEDROCK_CHAT_MODEL,
        name: "Taylor 2.0",
        provider: "amazon-bedrock",
        description: "Fast, capable model with tool use",
        capabilities: { tools: true, vision: true, reasoning: false },
      },
    ];

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  return Object.fromEntries(
    chatModels.map((model) => [model.id, model.capabilities])
  );
}

export const isDemo = process.env.IS_DEMO === "1";

export type GatewayModelWithCapabilities = ChatModel;

export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  return chatModels;
}

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
