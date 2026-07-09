"use client";

import { xai } from "@ai-sdk/xai";
import { experimental_useRealtime } from "@ai-sdk/react";
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XAI_VOICE_MODEL } from "@/lib/ai/realtime";
import { cn } from "@/lib/utils";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const statusLabels = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Error",
} as const;

export function RealtimeVoiceTest() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const realtime = experimental_useRealtime({
    model: xai.experimental_realtime(XAI_VOICE_MODEL),
    api: {
      token: `${basePath}/api/realtime/setup`,
    },
    sessionConfig: {
      instructions:
        "You are a helpful voice assistant. Be concise and conversational.",
      inputAudioTranscription: {},
      turnDetection: { type: "server-vad" },
    },
    onToolCall: async ({ toolCall }) => {
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
    },
    onError: (nextError) => {
      setError(nextError.message);
    },
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
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Voice AI test</h1>
          <Badge variant="outline">{XAI_VOICE_MODEL}</Badge>
          <Badge
            variant={realtime.status === "connected" ? "default" : "secondary"}
          >
            {statusLabels[realtime.status]}
          </Badge>
          {realtime.isCapturing ? <Badge variant="outline">Mic on</Badge> : null}
          {realtime.isPlaying ? <Badge variant="outline">Speaking</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Experimental xAI Grok realtime voice via the AI SDK. Connect, enable
          your microphone, and talk. You can also send text messages.
        </p>
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
