import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { customProvider, type LanguageModel } from "ai";
import { isTestEnvironment } from "../constants";
import { BEDROCK_CHAT_MODEL, titleModel } from "./models";

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
});

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

  return bedrock(modelId);
}

export function getTitleModel(): LanguageModel {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  return bedrock(titleModel.id);
}
