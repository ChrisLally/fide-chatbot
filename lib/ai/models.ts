/** Amazon Bedrock chat model (Taylor). Override with BEDROCK_CHAT_MODEL. */
export const BEDROCK_CHAT_MODEL =
  process.env.BEDROCK_CHAT_MODEL?.trim() ||
  "global.anthropic.claude-haiku-4-5-20251001-v1:0";

export const DEFAULT_CHAT_MODEL = BEDROCK_CHAT_MODEL;

export const titleModel = {
  id: BEDROCK_CHAT_MODEL,
  name: "Taylor 2.0",
  provider: "amazon-bedrock",
  description: "Amazon Bedrock chat model",
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

export const chatModels: ChatModel[] = [
  {
    id: BEDROCK_CHAT_MODEL,
    name: "Taylor 2.0",
    provider: "amazon-bedrock",
    description: "Amazon Bedrock — tools + vision",
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
