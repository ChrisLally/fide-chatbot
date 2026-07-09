import { xai } from "@ai-sdk/xai";
import { experimental_getRealtimeToolDefinitions } from "ai";
import { auth } from "@/app/(auth)/auth";
import { XAI_VOICE_MODEL, realtimeTools } from "@/lib/ai/realtime";
import { ChatbotError } from "@/lib/errors";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:api").toResponse();
  }

  if (!process.env.XAI_API_KEY) {
    return new ChatbotError(
      "bad_request:api",
      "XAI_API_KEY is not configured"
    ).toResponse();
  }

  try {
    const body = await request.json().catch(() => ({}));
    const toolDefinitions = await experimental_getRealtimeToolDefinitions({
      tools: realtimeTools,
    });

    const token = await xai.experimental_realtime.getToken({
      model: XAI_VOICE_MODEL,
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
