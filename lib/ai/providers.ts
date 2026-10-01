import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

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

export function getLanguageModel(modelId: string) {
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

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  if (litellm) {
    return litellm.chat(titleModel.id);
  }

  return bedrock(titleModel.id);
}
