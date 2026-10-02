import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { customProvider, type LanguageModel } from "ai";
import { isTestEnvironment } from "../constants";
import { BEDROCK_CHAT_MODEL, titleModel } from "./models";

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
});

/** Azure LiteLLM (OpenAI-compatible). Prefer when base URL + key are set. */
function createLiteLLM() {
  const baseURL = process.env.LITELLM_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.LITELLM_API_KEY?.trim();
  if (!baseURL || !apiKey) {
    return null;
  }
  return createOpenAI({
    apiKey,
    baseURL: `${baseURL}/v1`,
    // LiteLLM accepts Bearer (via apiKey) and x-api-key; send both.
    headers: {
      "x-api-key": apiKey,
    },
  });
}

const litellm = createLiteLLM();

export function isLiteLLMEnabled(): boolean {
  return litellm !== null;
}

/** When false, LiteLLM errors are not retried on Bedrock. Default: on. */
export function isLiteLLMBedrockFallbackEnabled(): boolean {
  if (!isLiteLLMEnabled()) {
    return false;
  }
  const flag = process.env.LITELLM_FALLBACK_BEDROCK?.trim().toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false") {
    return false;
  }
  return true;
}

/** First UI chunk must arrive within this window or we treat LiteLLM as stuck. */
export function litellmFirstByteTimeoutMs(): number {
  const raw = process.env.LITELLM_FIRST_BYTE_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 5_000) {
    return parsed;
  }
  return 25_000;
}

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel: mockTitleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": mockTitleModel,
        },
      });
    })()
  : null;

export function getBedrockLanguageModel(
  modelId: string = BEDROCK_CHAT_MODEL
): LanguageModel {
  return bedrock(modelId);
}

export function getLanguageModel(modelId: string): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  if (modelId.startsWith("gemini")) {
    return google(modelId);
  }

  if (modelId.startsWith("grok")) {
    return xai(modelId);
  }

  if (litellm) {
    return litellm.chat(modelId);
  }

  return bedrock(modelId);
}

/**
 * Ordered chat attempts: LiteLLM (when configured) then Bedrock Haiku.
 * Callers that already streamed UI chunks must not retry.
 */
export function getChatModelAttempts(modelId: string): Array<{
  label: "litellm" | "bedrock" | "primary";
  model: LanguageModel;
}> {
  if (isTestEnvironment && myProvider) {
    return [
      { label: "primary", model: myProvider.languageModel(modelId) },
    ];
  }

  if (modelId.startsWith("gemini") || modelId.startsWith("grok")) {
    return [{ label: "primary", model: getLanguageModel(modelId) }];
  }

  if (litellm && isLiteLLMBedrockFallbackEnabled()) {
    return [
      { label: "litellm", model: litellm.chat(modelId) },
      { label: "bedrock", model: getBedrockLanguageModel() },
    ];
  }

  return [{ label: "primary", model: getLanguageModel(modelId) }];
}

export function getTitleModel(): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  if (litellm) {
    return litellm.chat(titleModel.id);
  }

  return bedrock(titleModel.id);
}

export function getTitleModelAttempts(): Array<{
  label: "litellm" | "bedrock" | "primary";
  model: LanguageModel;
}> {
  if (isTestEnvironment && myProvider) {
    return [
      { label: "primary", model: myProvider.languageModel("title-model") },
    ];
  }
  if (litellm && isLiteLLMBedrockFallbackEnabled()) {
    return [
      { label: "litellm", model: litellm.chat(titleModel.id) },
      { label: "bedrock", model: getBedrockLanguageModel() },
    ];
  }
  return [{ label: "primary", model: getTitleModel() }];
}
