import { geolocation, ipAddress } from "@vercel/functions";
import type { MCPClient } from "@ai-sdk/mcp";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { patchItinerary } from "@/lib/ai/tools/patch-itinerary";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { isProductionEnvironment, isTestEnvironment } from "@/lib/constants";
import { loadFideMcpTools } from "@/lib/fide/mcp-client";
import { isFideMcpConfigured } from "@/lib/fide/mcp-config";
import { wrapFideToolsWithBinder } from "@/lib/fide/wrap-fide-tools";
import { createTurnEntityBinder } from "@/lib/itinerary/entity-binder";
import {
  itineraryWithRankings,
  lastItineraryArtifactId,
  lastUserTextFromMessages,
  publishJevScores,
} from "@/lib/itinerary/jev";
import { parseClientItinerary, serializeClientItinerary } from "@/lib/itinerary/schema";
import {
  createStreamId,
  deleteChatById,
  ensureGuestUser,
  getChatById,
  getDocumentById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveDocument,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

const maxChatSteps = 18;
const toolLimitFallbackText =
  "I gathered more data than I can finish processing in one response. Ask me to continue and I’ll pick up from here.";

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    // Guest JWTs can outlive PGlite rows after a wipe/migrate — recreate.
    if (session.user.type === "guest") {
      await ensureGuestUser({
        id: session.user.id,
        email: session.user.email,
      });
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    const modelMessages = await convertToModelMessages(uiMessages);
    const lastUserText = lastUserTextFromMessages(uiMessages);

    const fideMcpEnabled = isFideMcpConfigured() && !isTestEnvironment;
    const toolsEnabled = supportsTools && !(isReasoningModel && !supportsTools);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        let mcpClient: MCPClient | undefined;
        let fideTools: ToolSet = {};
        const entityBinder = createTurnEntityBinder();

        if (!isTestEnvironment) {
          const artifactId = lastItineraryArtifactId(uiMessages);
          if (artifactId) {
            void (async () => {
              try {
                const document = await getDocumentById({ id: artifactId });
                if (document?.kind !== "itinerary" || !document.content) {
                  return;
                }
                const parsed = parseClientItinerary(document.content, {
                  allowUnbound: true,
                });
                if (!parsed.ok) {
                  return;
                }
                const scores = await publishJevScores(
                  dataStream,
                  parsed.data,
                  lastUserText
                );
                if (!scores) {
                  return;
                }
                const ranked = serializeClientItinerary(
                  itineraryWithRankings(parsed.data, scores)
                );
                await saveDocument({
                  id: document.id,
                  title: document.title,
                  kind: "itinerary",
                  content: ranked,
                  userId: document.userId,
                });
                dataStream.write({
                  type: "data-itineraryDelta",
                  data: ranked,
                  transient: true,
                });
              } catch {
                /* rankings are advisory */
              }
            })();
          }
        }

        if (fideMcpEnabled && toolsEnabled) {
          try {
            const loaded = await loadFideMcpTools();
            if (loaded) {
              mcpClient = loaded.client;
              fideTools = wrapFideToolsWithBinder(loaded.tools, entityBinder);
            }
          } catch (error) {
            console.error("Fide MCP connection failed:", error);
          }
        }

        const builtInTools = {
          getWeather,
          createDocument: createDocument({
            session,
            dataStream,
            modelId: chatModel,
            entityBinder,
          }),
          patchItinerary: patchItinerary({
            session,
            dataStream,
            entityBinder,
            lastUserText,
          }),
          requestSuggestions: requestSuggestions({
            session,
            dataStream,
            modelId: chatModel,
          }),
        };

        const tools = {
          ...fideTools,
          ...builtInTools,
        };

        const activeTools = toolsEnabled
          ? (Object.keys(tools) as Array<keyof typeof tools & string>)
          : undefined;

        let completedSteps = 0;
        let finalStepText = "";
        let finalStepToolCalls = 0;
        let finalFinishReason: string | undefined;

        const result = streamText({
          model: getLanguageModel(chatModel),
          system: systemPrompt({
            requestHints,
            supportsTools,
            supportsFideMcp: fideMcpEnabled && Object.keys(fideTools).length > 0,
          }),
          messages: modelMessages,
          stopWhen: stepCountIs(maxChatSteps),
          activeTools,
          tools,
          onStepEnd: (step) => {
            completedSteps += 1;
            finalStepText = step.text;
            finalStepToolCalls = step.toolCalls.length;
            finalFinishReason = step.finishReason;
          },
          onFinish: async () => {
            await mcpClient?.close().catch(() => undefined);
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        for await (const chunk of result.toUIMessageStream<ChatMessage>({
          sendReasoning: isReasoningModel,
        })) {
          dataStream.write(chunk);
        }

        if (
          completedSteps >= maxChatSteps &&
          finalFinishReason === "tool-calls" &&
          finalStepToolCalls > 0 &&
          finalStepText.trim().length === 0
        ) {
          const textId = generateId();
          dataStream.write({ type: "start-step" });
          dataStream.write({ type: "text-start", id: textId });
          dataStream.write({
            type: "text-delta",
            id: textId,
            delta: toolLimitFallbackText,
          });
          dataStream.write({ type: "text-end", id: textId });
          dataStream.write({ type: "finish-step" });
        }

        if (titlePromise) {
          try {
            const title = await titlePromise;
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          } catch (_) {
            /* non-fatal */
          }
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
