import { auth } from "@/app/(auth)/auth";
import { getGoogleLiveCredentials } from "@/lib/ai/google-live";
import { ChatbotError } from "@/lib/errors";

/**
 * Authenticated voice-test helper: returns a regional Vertex Live WebSocket URL
 * (`?key=`) for the browser client. Demo-only — the key is in the URL.
 */
export async function POST() {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:api").toResponse();
  }

  try {
    return Response.json(getGoogleLiveCredentials());
  } catch (error) {
    return new ChatbotError(
      "bad_request:api",
      error instanceof Error ? error.message : "Google Live credentials unavailable"
    ).toResponse();
  }
}
