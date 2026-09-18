import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { experimental_getRealtimeToolDefinitions } from "ai";
import { auth } from "@/app/(auth)/auth";
import { VOICE_MODELS, type VoiceProvider, realtimeTools } from "@/lib/ai/realtime";
import { ChatbotError } from "@/lib/errors";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:api").toResponse();
  }

  try {
    const url = new URL(request.url);
    const providerParam = url.searchParams.get("provider");
    const body = await request.json().catch(() => ({}));
    const provider: VoiceProvider =
      providerParam === "google" || body.provider === "google"
        ? "google"
        : "xai";

    if (provider === "xai" && !process.env.XAI_API_KEY) {
      return new ChatbotError(
        "bad_request:api",
        "XAI_API_KEY is not configured"
      ).toResponse();
    }

    if (
      provider === "google" &&
      !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
      !process.env.GEMINI_API_KEY
    ) {
      return new ChatbotError(
        "bad_request:api",
        "GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY is not configured"
      ).toResponse();
    }

    const toolDefinitions = await experimental_getRealtimeToolDefinitions({
      tools: realtimeTools,
    });

    const modelInfo = VOICE_MODELS[provider];
    const realtimeProvider = provider === "google" ? google : xai;

    const token = await (realtimeProvider.experimental_realtime as any).getToken({
      model: modelInfo.id,
      sessionConfig: {
        ...body.sessionConfig,
        tools: toolDefinitions,
      },
    });

    return Response.json({
      ...token,
      tools: toolDefinitions,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create realtime token";

    return new ChatbotError("bad_request:api", message).toResponse();
  }
}
