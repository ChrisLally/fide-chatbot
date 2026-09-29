import { getEntityCommentsByEntityIds } from "@/lib/db/queries";
import { normalizeDid } from "@/lib/itinerary/schema";

const FIDE_ID_RE = /did:fide:0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{40}/g;

export type EntityCommentSnippet = {
  id: string;
  entityId: string;
  body: string;
  createdAt: string;
};

function extractText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (!result || typeof result !== "object") {
    return String(result ?? "");
  }
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: string }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("\n");
  }
  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

/** Collect canonical did:fide:0x… ids from any tool/API payload. */
export function extractFideEntityIds(payload: unknown): string[] {
  const text = extractText(payload);
  const ids = new Set<string>();
  for (const match of text.matchAll(FIDE_ID_RE)) {
    ids.add(normalizeDid(match[0]));
  }
  return [...ids];
}

export function formatEntityCommentsAppendix(
  commentsByEntityId: Record<string, EntityCommentSnippet[]>
): string {
  const entries = Object.entries(commentsByEntityId).filter(
    ([, comments]) => comments.length > 0
  );
  if (entries.length === 0) {
    return "";
  }

  const lines = ["", "---", "## Entity comments (advisor notes)"];
  for (const [entityId, comments] of entries) {
    lines.push("", `### ${entityId}`);
    for (const comment of comments) {
      const when = comment.createdAt
        ? new Date(comment.createdAt).toISOString()
        : "";
      lines.push(`- (${when}) ${comment.body}`);
    }
  }
  return lines.join("\n");
}

/**
 * Load local EntityComment rows for every fide id present in `payload`.
 * Keys are canonical did:fide:0x… forms.
 */
export async function loadCommentsForPayload(
  payload: unknown
): Promise<Record<string, EntityCommentSnippet[]>> {
  const entityIds = extractFideEntityIds(payload);
  if (entityIds.length === 0) {
    return {};
  }

  // Match both canonical did and bare hex if older rows stored either form.
  const lookupIds = new Set<string>();
  for (const id of entityIds) {
    lookupIds.add(id);
    const bare = id.replace(/^did:fide:/i, "");
    if (bare !== id) {
      lookupIds.add(bare);
    }
  }

  try {
    const rows = await getEntityCommentsByEntityIds({
      entityIds: [...lookupIds],
    });
    const byId: Record<string, EntityCommentSnippet[]> = {};
    for (const row of rows) {
      const key = normalizeDid(row.entityId);
      const snippet: EntityCommentSnippet = {
        id: row.id,
        entityId: key,
        body: row.body,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : String(row.createdAt),
      };
      (byId[key] ??= []).push(snippet);
    }
    return byId;
  } catch (error) {
    console.error("loadCommentsForPayload failed", error);
    return {};
  }
}

/** Append a comments appendix onto an MCP-style tool result (fail-open). */
export async function enrichPayloadWithEntityComments(
  payload: unknown
): Promise<unknown> {
  const commentsByEntityId = await loadCommentsForPayload(payload);
  const appendix = formatEntityCommentsAppendix(commentsByEntityId);
  if (!appendix) {
    return payload;
  }

  if (typeof payload === "string") {
    return `${payload}${appendix}`;
  }

  if (payload && typeof payload === "object") {
    const record = payload as { content?: unknown };
    if (Array.isArray(record.content)) {
      return {
        ...record,
        content: [
          ...record.content,
          { type: "text", text: appendix },
        ],
        entityComments: commentsByEntityId,
      };
    }
    return {
      ...record,
      entityComments: commentsByEntityId,
      commentsAppendix: appendix,
    };
  }

  return payload;
}
