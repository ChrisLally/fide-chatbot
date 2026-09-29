import { z } from "zod";
import {
  createEntityComment,
  deleteEntityComment,
  getEntityCommentsByEntityId,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const postSchema = z.object({
  entityId: z.string().min(1).max(512),
  body: z.string().trim().min(1).max(4000),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId")?.trim();

  if (!entityId) {
    return new ChatbotError(
      "bad_request:api",
      "Parameter entityId is required."
    ).toResponse();
  }

  try {
    const comments = await getEntityCommentsByEntityId({ entityId });
    return Response.json(comments, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError(
      "bad_request:database",
      "Failed to load comments"
    ).toResponse();
  }
}

export async function POST(request: Request) {
  let entityId: string;
  let body: string;

  try {
    const parsed = postSchema.parse(await request.json());
    entityId = parsed.entityId.trim();
    body = parsed.body;
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Parameters entityId and body are required."
    ).toResponse();
  }

  try {
    const comment = await createEntityComment({ entityId, body });
    return Response.json(comment, { status: 201 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError(
      "bad_request:database",
      "Failed to create comment"
    ).toResponse();
  }
}

export async function DELETE(request: Request) {
  let id: string;

  try {
    const { searchParams } = new URL(request.url);
    const fromQuery = searchParams.get("id");
    if (fromQuery) {
      id = deleteSchema.parse({ id: fromQuery }).id;
    } else {
      id = deleteSchema.parse(await request.json()).id;
    }
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Parameter id is required."
    ).toResponse();
  }

  try {
    const deleted = await deleteEntityComment({ id });
    if (!deleted) {
      return Response.json(
        { code: "not_found:api", cause: "Comment not found." },
        { status: 404 }
      );
    }
    return Response.json({ id: deleted.id }, { status: 200 });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }
    return new ChatbotError(
      "bad_request:database",
      "Failed to delete comment"
    ).toResponse();
  }
}
