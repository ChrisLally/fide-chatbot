import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { createFideMcpClient } from "@/lib/fide/mcp-client";
import { ChatbotError } from "@/lib/errors";

const allowedToolNames = [
  "list_world_models",
  "list_views",
  "get_view",
  "run_view",
] as const;

const toolCallSchema = z.object({
  toolName: z.enum(allowedToolNames),
  args: z.record(z.unknown()).optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:api").toResponse();
  }

  let input: z.infer<typeof toolCallSchema>;

  try {
    input = toolCallSchema.parse(await request.json());
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const client = await createFideMcpClient();

  if (!client) {
    return new ChatbotError(
      "bad_request:api",
      "Fide MCP is not configured"
    ).toResponse();
  }

  try {
    const result = await client.callTool({
      name: input.toolName,
      arguments: input.args ?? {},
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Fide MCP tool call failed";

    return new ChatbotError("bad_request:api", message).toResponse();
  } finally {
    await client.close().catch(() => undefined);
  }
}
