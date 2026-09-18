"use client";

import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import {
  Experimental_AbstractRealtimeSession,
  type Experimental_RealtimeServerEvent,
  type Experimental_RealtimeSessionOptions,
  type Experimental_RealtimeState,
  type Experimental_RealtimeStatus,
  type UIMessage,
} from "ai";
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { realtimeInstructions, VOICE_MODELS, type VoiceProvider } from "@/lib/ai/realtime";
import { cn } from "@/lib/utils";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const statusLabels = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Error",
} as const;

const fideToolNames = new Set([
  "list_world_models",
  "list_views",
  "get_view",
  "run_view",
]);

type RealtimeStateKey = keyof Experimental_RealtimeState;

class VoiceRealtimeSession extends Experimental_AbstractRealtimeSession {
  private callbacks: {
    [K in RealtimeStateKey]: Set<() => void>;
  } = {
    status: new Set(),
    messages: new Set(),
    events: new Set(),
    isCapturing: new Set(),
    isPlaying: new Set(),
  };

  get status(): Experimental_RealtimeStatus {
    return this.state.status;
  }

  get messages(): UIMessage[] {
    return this.state.messages;
  }

  get events(): Experimental_RealtimeServerEvent[] {
    return this.state.events;
  }

  get isCapturing(): boolean {
    return this.state.isCapturing;
  }

  get isPlaying(): boolean {
    return this.state.isPlaying;
  }

  subscribe(key: RealtimeStateKey, onChange: () => void): () => void {
    this.callbacks[key].add(onChange);

    return () => {
      this.callbacks[key].delete(onChange);
    };
  }

  protected setState<K extends RealtimeStateKey>(
    key: K,
    value: Experimental_RealtimeState[K]
  ): void {
    this.state = { ...this.state, [key]: value };
    this.callbacks[key].forEach((callback) => callback());
  }
}

function useVoiceRealtime(options: Experimental_RealtimeSessionOptions) {
  const sessionRef = useRef<VoiceRealtimeSession | null>(null);
  const prevModelRef = useRef(options.model);

  if (!sessionRef.current || prevModelRef.current !== options.model) {
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current.stopAudioCapture();
      sessionRef.current.stopPlayback();
    }
    sessionRef.current = new VoiceRealtimeSession(options);
    prevModelRef.current = options.model;
  }

  const session = sessionRef.current;

  useEffect(() => {
    session.onToolCall = options.onToolCall;
    session.onEvent = options.onEvent;
    session.onError = options.onError;
  }, [options.onToolCall, options.onEvent, options.onError, session]);

  useEffect(() => {
    return () => {
      session.disconnect();
      session.stopAudioCapture();
      session.stopPlayback();
    };
  }, [session]);

  const status = useSyncExternalStore(
    useCallback((cb) => session.subscribe("status", cb), [session]),
    () => session.status,
    () => session.status
  );
  const messages = useSyncExternalStore(
    useCallback((cb) => session.subscribe("messages", cb), [session]),
    () => session.messages,
    () => session.messages
  );
  const isCapturing = useSyncExternalStore(
    useCallback((cb) => session.subscribe("isCapturing", cb), [session]),
    () => session.isCapturing,
    () => session.isCapturing
  );
  const isPlaying = useSyncExternalStore(
    useCallback((cb) => session.subscribe("isPlaying", cb), [session]),
    () => session.isPlaying,
    () => session.isPlaying
  );

  return {
    status,
    messages,
    isCapturing,
    isPlaying,
    connect: session.connect.bind(session),
    disconnect: session.disconnect.bind(session),
    sendTextMessage: session.sendTextMessage.bind(session),
    startAudioCapture: session.startAudioCapture.bind(session),
    stopAudioCapture: session.stopAudioCapture.bind(session),
    stopPlayback: session.stopPlayback.bind(session),
  };
}

export function RealtimeVoiceTest() {
  const [selectedProvider, setSelectedProvider] = useState<VoiceProvider>("xai");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const activeModelInfo = VOICE_MODELS[selectedProvider];

  const model = useMemo(() => {
    if (selectedProvider === "google") {
      return (google.experimental_realtime as any)(activeModelInfo.id);
    }
    return xai.experimental_realtime(activeModelInfo.id);
  }, [selectedProvider, activeModelInfo.id]);

  const sessionConfig = useMemo(
    () => ({
      instructions: realtimeInstructions,
      inputAudioTranscription: {},
      turnDetection: { type: "server-vad" as const },
    }),
    []
  );

  const handleToolCall = useCallback<
    NonNullable<Experimental_RealtimeSessionOptions["onToolCall"]>
  >(async ({ toolCall }) => {
    if (toolCall.toolName === "getWeather") {
      const response = await fetch(`${basePath}/api/realtime/weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toolCall.args),
      });

      if (!response.ok) {
        throw new Error("Weather lookup failed");
      }

      return response.json();
    }

    if (fideToolNames.has(toolCall.toolName)) {
      const response = await fetch(`${basePath}/api/realtime/fide-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: toolCall.toolName,
          args: toolCall.args,
        }),
      });

      if (!response.ok) {
        throw new Error("Fide MCP tool call failed");
      }

      return response.json();
    }
  }, []);

  const handleRealtimeError = useCallback((nextError: Error) => {
    setError(nextError.message);
  }, []);

  const realtime = useVoiceRealtime({
    model,
    api: {
      token: `${basePath}/api/realtime/setup?provider=${selectedProvider}`,
    },
    sessionConfig,
    onToolCall: handleToolCall,
    onError: handleRealtimeError,
  });

  const stopMediaStream = useCallback(() => {
    if (!mediaStreamRef.current) {
      return;
    }

    for (const track of mediaStreamRef.current.getTracks()) {
      track.stop();
    }

    mediaStreamRef.current = null;
  }, []);

  const handleConnect = async () => {
    setError(null);

    try {
      await realtime.connect();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect"
      );
    }
  };

  const handleDisconnect = () => {
    realtime.stopAudioCapture();
    stopMediaStream();
    realtime.disconnect();
  };

  const handleMicToggle = async () => {
    if (realtime.isCapturing) {
      realtime.stopAudioCapture();
      stopMediaStream();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      realtime.startAudioCapture(stream);
      setError(null);
    } catch (micError) {
      setError(
        micError instanceof Error ? micError.message : "Microphone access denied"
      );
    }
  };

  const handleSendText = () => {
    const trimmed = text.trim();

    if (!trimmed || realtime.status !== "connected") {
      return;
    }

    realtime.sendTextMessage(trimmed);
    setText("");
  };

  const isConnected = realtime.status === "connected";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Voice AI test</h1>
          <Badge variant="outline">{activeModelInfo.name} ({activeModelInfo.id})</Badge>
          <Badge
            variant={realtime.status === "connected" ? "default" : "secondary"}
          >
            {statusLabels[realtime.status]}
          </Badge>
          {realtime.isCapturing ? <Badge variant="outline">Mic on</Badge> : null}
          {realtime.isPlaying ? <Badge variant="outline">Speaking</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Realtime voice via the AI SDK. Switch between xAI Grok Voice and Google Gemini Live below.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs font-medium text-muted-foreground">Voice Engine:</span>
          {(["xai", "google"] as VoiceProvider[]).map((prov) => (
            <Button
              key={prov}
              disabled={isConnected || realtime.status === "connecting"}
              onClick={() => setSelectedProvider(prov)}
              size="sm"
              variant={selectedProvider === prov ? "default" : "outline"}
            >
              {VOICE_MODELS[prov].providerName} ({VOICE_MODELS[prov].name})
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={realtime.status === "connecting" || isConnected}
          onClick={handleConnect}
          type="button"
        >
          <PhoneIcon />
          Connect
        </Button>
        <Button
          disabled={!isConnected && realtime.status !== "error"}
          onClick={handleDisconnect}
          type="button"
          variant="outline"
        >
          <PhoneOffIcon />
          Disconnect
        </Button>
        <Button
          disabled={!isConnected}
          onClick={handleMicToggle}
          type="button"
          variant={realtime.isCapturing ? "destructive" : "secondary"}
        >
          {realtime.isCapturing ? <MicOffIcon /> : <MicIcon />}
          {realtime.isCapturing ? "Stop mic" : "Start mic"}
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          disabled={!isConnected}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSendText();
            }
          }}
          placeholder="Send a text message…"
          value={text}
        />
        <Button disabled={!isConnected || !text.trim()} onClick={handleSendText} type="button">
          Send
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="flex min-h-80 flex-1 flex-col gap-3 rounded-xl border border-border/50 bg-muted/20 p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Transcript</h2>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {realtime.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Messages will appear here after you connect.
            </p>
          ) : (
            realtime.messages.map((message) => (
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "ml-8 bg-primary/10"
                    : "mr-8 bg-background"
                )}
                key={message.id}
              >
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {message.role}
                </div>
                <div className="space-y-1">
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return <p key={`${message.id}-${index}`}>{part.text}</p>;
                    }

                    return null;
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
