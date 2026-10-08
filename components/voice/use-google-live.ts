"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GoogleLiveCredentials } from "@/lib/ai/google-live";
import { FIDE_LIVE_TOOL_NAMES } from "@/lib/ai/google-live-tools";
import { realtimeInstructions } from "@/lib/ai/realtime";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type GoogleLiveStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type GoogleLiveMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type VertexFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

type VertexLiveServerMessage = {
  setupComplete?: unknown;
  serverContent?: {
    interrupted?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
    turnComplete?: boolean;
  };
  toolCall?: {
    functionCalls?: VertexFunctionCall[];
  };
  tool_call?: {
    function_calls?: VertexFunctionCall[];
  };
  toolCallCancellation?: { ids?: string[] };
  error?: { message?: string };
};

function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i] ?? 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

async function readSocketData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Blob) {
    return data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  throw new Error("Unsupported WebSocket message type");
}

export function useGoogleLive() {
  const [status, setStatus] = useState<GoogleLiveStatus>("disconnected");
  const [messages, setMessages] = useState<GoogleLiveMessage[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const assistantBufferRef = useRef("");
  const handleServerMessageRef = useRef<(message: VertexLiveServerMessage) => void>(
    () => undefined
  );

  const appendMessage = useCallback((role: "user" | "assistant", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: `${role}-${Date.now()}-${prev.length}`, role, text: trimmed },
    ]);
  }, []);

  const runLiveTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "getWeather") {
        const response = await fetch(`${basePath}/api/realtime/weather`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        if (!response.ok) {
          throw new Error("Weather lookup failed");
        }
        return response.json();
      }

      if (FIDE_LIVE_TOOL_NAMES.has(name)) {
        const response = await fetch(`${basePath}/api/realtime/fide-tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolName: name, args }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            cause?: string;
            message?: string;
          };
          throw new Error(
            body.cause || body.message || `Fide tool failed: ${name}`
          );
        }
        return response.json();
      }

      throw new Error(`Unknown tool: ${name}`);
    },
    []
  );

  const handleToolCall = useCallback(
    async (message: VertexLiveServerMessage) => {
      const calls =
        message.toolCall?.functionCalls ?? message.tool_call?.function_calls ?? [];
      if (calls.length === 0) {
        return;
      }

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected while handling tool call");
      }

      const functionResponses: Array<{
        id?: string;
        name: string;
        response: Record<string, unknown>;
      }> = [];

      for (const call of calls) {
        const name = call.name;
        if (!name) {
          continue;
        }
        const args = (call.args ?? {}) as Record<string, unknown>;
        appendMessage("assistant", `[tool] ${name}`);

        try {
          const result = await runLiveTool(name, args);
          functionResponses.push({
            id: call.id,
            name,
            response: { result },
          });
        } catch (toolError) {
          const errText =
            toolError instanceof Error ? toolError.message : "Tool failed";
          functionResponses.push({
            id: call.id,
            name,
            response: { error: errText },
          });
        }
      }

      if (functionResponses.length === 0) {
        return;
      }

      ws.send(
        JSON.stringify({
          tool_response: {
            function_responses: functionResponses,
          },
        })
      );
    },
    [appendMessage, runLiveTool]
  );

  const stopPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // already stopped
      }
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current.clear();

    if (playbackContextRef.current) {
      playbackTimeRef.current = playbackContextRef.current.currentTime;
    } else {
      playbackTimeRef.current = 0;
    }
    setIsPlaying(false);
  }, []);

  const playPcmBase64 = useCallback(async (base64: string, mimeType: string) => {
    const rateMatch = /rate=(\d+)/.exec(mimeType);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24_000;
    const pcm = base64ToInt16(base64);
    if (pcm.length === 0) {
      return;
    }

    if (!playbackContextRef.current) {
      playbackContextRef.current = new AudioContext({ sampleRate });
      playbackTimeRef.current = 0;
    }

    const ctx = playbackContextRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const float32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      float32[i] = (pcm[i] ?? 0) / 0x8000;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    activeSourcesRef.current.add(source);

    const startAt = Math.max(ctx.currentTime, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + audioBuffer.duration;
    setIsPlaying(true);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setIsPlaying(false);
      }
    };
  }, []);

  const handleServerMessage = useCallback(
    (message: VertexLiveServerMessage) => {
      if (message.error?.message) {
        setError(message.error.message);
        setStatus("error");
        return;
      }

      if (message.toolCall || message.tool_call) {
        void handleToolCall(message).catch((toolError) => {
          const text =
            toolError instanceof Error ? toolError.message : "Tool call failed";
          setError(text);
          setStatus("error");
        });
      }

      // Server barge-in: generation is canceled; client must flush local audio queue.
      if (message.serverContent?.interrupted) {
        stopPlayback();
        if (assistantBufferRef.current) {
          appendMessage("assistant", `${assistantBufferRef.current}…`);
          assistantBufferRef.current = "";
        }
        return;
      }

      const inputTx = message.serverContent?.inputTranscription?.text;
      if (inputTx) {
        appendMessage("user", inputTx);
      }

      const outputTx = message.serverContent?.outputTranscription?.text;
      if (outputTx) {
        assistantBufferRef.current += outputTx;
      }

      const parts = message.serverContent?.modelTurn?.parts ?? [];
      for (const part of parts) {
        if (part.text) {
          assistantBufferRef.current += part.text;
        }
        if (part.inlineData?.data) {
          void playPcmBase64(
            part.inlineData.data,
            part.inlineData.mimeType ?? "audio/pcm;rate=24000"
          );
        }
      }

      if (message.serverContent?.turnComplete) {
        if (assistantBufferRef.current) {
          appendMessage("assistant", assistantBufferRef.current);
          assistantBufferRef.current = "";
        }
      }
    },
    [appendMessage, handleToolCall, playPcmBase64, stopPlayback]
  );

  useEffect(() => {
    handleServerMessageRef.current = handleServerMessage;
  }, [handleServerMessage]);

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    if (captureContextRef.current) {
      void captureContextRef.current.close();
      captureContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    setIsCapturing(false);
  }, []);

  const disconnect = useCallback(() => {
    stopCapture();
    stopPlayback();

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    if (playbackContextRef.current) {
      void playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    playbackTimeRef.current = 0;
    setStatus("disconnected");
  }, [stopCapture, stopPlayback]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    setMessages([]);
    assistantBufferRef.current = "";

    if (wsRef.current) {
      disconnect();
    }

    try {
      const response = await fetch(
        `${basePath}/api/realtime/google-live/credentials`,
        { method: "POST" }
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          cause?: string;
          message?: string;
        };
        throw new Error(
          body.cause || body.message || "Failed to load Google Live credentials"
        );
      }

      const credentials = (await response.json()) as GoogleLiveCredentials;
      if (
        !credentials.wsUrl ||
        !credentials.modelResource ||
        !credentials.tools?.length
      ) {
        throw new Error("Invalid Google Live credentials payload");
      }

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(credentials.wsUrl);
        wsRef.current = ws;
        let settled = false;

        const fail = (message: string) => {
          if (settled) {
            return;
          }
          settled = true;
          setError(message);
          setStatus("error");
          reject(new Error(message));
        };

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              setup: {
                model: credentials.modelResource,
                generation_config: {
                  response_modalities: ["AUDIO"],
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: { voice_name: "Zephyr" },
                    },
                  },
                },
                system_instruction: {
                  parts: [{ text: realtimeInstructions }],
                },
                tools: credentials.tools,
                input_audio_transcription: {},
                output_audio_transcription: {},
              },
            })
          );
        };

        ws.onmessage = (event) => {
          void (async () => {
            try {
              const text = await readSocketData(event.data);
              const message = JSON.parse(text) as VertexLiveServerMessage;

              if (message.setupComplete && !settled) {
                settled = true;
                setStatus("connected");
                resolve();
              }

              handleServerMessageRef.current(message);
            } catch (parseError) {
              fail(
                parseError instanceof Error
                  ? parseError.message
                  : "Failed to parse Google Live message"
              );
            }
          })();
        };

        ws.onerror = () => {
          fail("Google Live WebSocket error");
        };

        ws.onclose = (event) => {
          if (!settled) {
            fail(
              event.reason ||
                `Google Live closed before setupComplete (code ${event.code})`
            );
            return;
          }
          setStatus((prev) => (prev === "error" ? prev : "disconnected"));
          wsRef.current = null;
        };
      });
    } catch (connectError) {
      const message =
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect Google Live";
      setError(message);
      setStatus("error");
      throw connectError;
    }
  }, [disconnect]);

  const startCapture = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    mediaStreamRef.current = stream;

    const context = new AudioContext({ sampleRate: 16_000 });
    captureContextRef.current = context;
    if (context.state === "suspended") {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(input);
      socket.send(
        JSON.stringify({
          realtime_input: {
            audio: {
              data: arrayBufferToBase64(pcm),
              mime_type: "audio/pcm;rate=16000",
            },
          },
        })
      );
    };

    // Keep the processor graph alive without echoing mic audio to speakers
    // (feedback makes barge-in / VAD much worse).
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    setIsCapturing(true);
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const ws = wsRef.current;
      if (!trimmed) {
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Not connected");
        setStatus("error");
        return;
      }
      appendMessage("user", trimmed);
      ws.send(
        JSON.stringify({
          client_content: {
            turns: [{ role: "user", parts: [{ text: trimmed }] }],
            turn_complete: true,
          },
        })
      );
    },
    [appendMessage]
  );

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    messages,
    isCapturing,
    isPlaying,
    error,
    setError,
    connect,
    disconnect,
    startCapture,
    stopCapture,
    sendText,
  };
}
