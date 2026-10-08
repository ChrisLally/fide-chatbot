/**
 * Vertex / Agent Platform Live credentials for the browser voice test.
 * Browser connects with a regional WebSocket + `?key=` (no @google/genai project auth).
 * Required env vars — no fallbacks.
 */

import { GOOGLE_LIVE_TOOLS_SETUP } from "@/lib/ai/google-live-tools";

export type GoogleLiveCredentials = {
  /** Regional Live WebSocket URL including `?key=` (browser-safe; no custom headers). */
  wsUrl: string;
  /** Full Vertex model resource name. */
  modelResource: string;
  model: string;
  project: string;
  location: string;
  tools: typeof GOOGLE_LIVE_TOOLS_SETUP;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function getGoogleLiveCredentials(): GoogleLiveCredentials {
  const apiKey = requireEnv("GOOGLE_VERTEX_API_KEY");
  const project = requireEnv("GOOGLE_CLOUD_PROJECT");
  const location = requireEnv("GOOGLE_CLOUD_LOCATION");
  const model = requireEnv("GOOGLE_VOICE_MODEL");

  const modelResource = `projects/${project}/locations/${location}/publishers/google/models/${model}`;
  const wsUrl =
    `wss://${location}-aiplatform.googleapis.com/ws/` +
    `google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  return {
    wsUrl,
    modelResource,
    model,
    project,
    location,
    tools: GOOGLE_LIVE_TOOLS_SETUP,
  };
}
