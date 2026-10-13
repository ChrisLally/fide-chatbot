/**
 * Read-only export of one chat from the PGlite database: messages, tool calls, and
 * the itinerary documents those tool calls touched.
 *
 * Usage (stop the dev server first: PGlite allows one process per data folder):
 *   pnpm tsx scripts/export-chat.ts <chatId> [--data-dir <dir>] [--full] [--out <file>]
 *
 * --data-dir  PGlite folder (default: PGLITE_DATA_DIR or ./.pglite)
 * --full      do not truncate long tool inputs and outputs
 * --out       write the transcript to a file instead of stdout
 */

import { PGlite } from "@electric-sql/pglite";
import { writeFileSync } from "node:fs";
import path from "node:path";

type Args = {
  chatId: string;
  dataDir: string;
  full: boolean;
  out?: string;
};

type MessageRow = {
  id: string;
  role: string;
  parts: unknown;
  createdAt: string;
};

type DocumentRow = {
  id: string;
  createdAt: string;
  title: string;
  content: string | null;
  kind: string;
};

const TRUNCATE_AT = 1500;

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".pglite");
  let full = false;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--data-dir") {
      dataDir = argv[++i] ?? "";
    } else if (arg === "--full") {
      full = true;
    } else if (arg === "--out") {
      out = argv[++i];
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  const [chatId] = positional;
  if (!chatId || positional.length > 1) {
    throw new Error("Usage: export-chat.ts <chatId> [--data-dir <dir>] [--full] [--out <file>]");
  }
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) {
    throw new Error(`Chat id must be a UUID, got: ${chatId}`);
  }
  return { chatId, dataDir: path.resolve(dataDir), full, out };
}

function truncate(text: string, full: boolean): string {
  if (full || text.length <= TRUNCATE_AT) {
    return text;
  }
  return `${text.slice(0, TRUNCATE_AT)}… [truncated ${text.length - TRUNCATE_AT} chars; use --full]`;
}

function asJson(value: unknown, full: boolean): string {
  if (value === undefined) {
    return "(none)";
  }
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return truncate(text ?? "(none)", full);
}

/** Tool parts are "tool-<name>" (static) or "dynamic-tool" with toolName (AI SDK UI messages). */
function toolNameOf(part: Record<string, unknown>): string | null {
  const type = typeof part.type === "string" ? part.type : "";
  if (type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  if (type.startsWith("tool-")) {
    return type.slice("tool-".length);
  }
  return null;
}

/** Document ids a chat's itinerary tools touched (createDocument output, patchItinerary input). */
function documentIdsFromPart(part: Record<string, unknown>, toolName: string): string[] {
  const ids: string[] = [];
  const output = part.output as Record<string, unknown> | undefined;
  const input = part.input as Record<string, unknown> | undefined;
  if (toolName === "createDocument" && output && typeof output.id === "string") {
    ids.push(output.id);
  }
  if (input && typeof input.id === "string") {
    ids.push(input.id);
  }
  return ids;
}

function renderPart(part: Record<string, unknown>, full: boolean): string[] {
  const lines: string[] = [];
  const toolName = toolNameOf(part);

  if (part.type === "text" && typeof part.text === "string") {
    lines.push(part.text);
  } else if (part.type === "reasoning" && typeof part.text === "string") {
    lines.push("> _reasoning_", ...part.text.split("\n").map((l) => `> ${l}`));
  } else if (toolName) {
    const state = typeof part.state === "string" ? part.state : "unknown";
    const callId = typeof part.toolCallId === "string" ? part.toolCallId : "";
    lines.push(`**Tool call: \`${toolName}\`** (state: ${state}${callId ? `, id: ${callId}` : ""})`);
    lines.push("", "Input:", "```json", asJson(part.input, full), "```");
    if (part.output !== undefined) {
      lines.push("", "Output:", "```json", asJson(part.output, full), "```");
    }
    if (typeof part.errorText === "string") {
      lines.push("", `Error: ${part.errorText}`);
    }
  } else if (typeof part.type === "string" && part.type.startsWith("data-")) {
    lines.push(`_${part.type}_: ${asJson(part.data, full)}`);
  } else if (part.type === "step-start") {
    lines.push("---");
  } else {
    lines.push(`_${String(part.type)}_: ${asJson(part, full)}`);
  }
  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new PGlite(args.dataDir);
  await client.waitReady;

  try {
    const chats = await client.query<{ id: string; title: string; createdAt: string; userId: string; visibility: string }>(
      `SELECT "id", "title", "createdAt", "userId", "visibility" FROM "Chat" WHERE "id" = $1`,
      [args.chatId]
    );
    const chat = chats.rows[0];
    if (!chat) {
      throw new Error(`No chat with id ${args.chatId} in ${args.dataDir}`);
    }

    const messages = await client.query<MessageRow>(
      `SELECT "id", "role", "parts", "createdAt" FROM "Message_v2" WHERE "chatId" = $1 ORDER BY "createdAt", "id"`,
      [args.chatId]
    );

    const out: string[] = [];
    out.push(`# ${chat.title}`, "");
    out.push(`- Chat id: \`${chat.id}\``);
    out.push(`- Created: ${chat.createdAt}`);
    out.push(`- Visibility: ${chat.visibility}`);
    out.push(`- Messages: ${messages.rows.length}`, "");

    const documentIds = new Set<string>();

    for (const message of messages.rows) {
      out.push(`## ${message.role} (${message.createdAt})`, "");
      const parts = Array.isArray(message.parts) ? (message.parts as Record<string, unknown>[]) : [];
      if (parts.length === 0) {
        out.push("_(no parts)_", "");
        continue;
      }
      for (const part of parts) {
        out.push(...renderPart(part, args.full), "");
        const toolName = toolNameOf(part);
        if (toolName) {
          for (const id of documentIdsFromPart(part, toolName)) {
            documentIds.add(id);
          }
        }
      }
    }

    if (documentIds.size > 0) {
      out.push("# Itinerary documents", "");
      for (const id of documentIds) {
        const docs = await client.query<DocumentRow>(
          `SELECT "id", "createdAt", "title", "content", "text" AS "kind" FROM "Document" WHERE "id" = $1 ORDER BY "createdAt"`,
          [id]
        );
        if (docs.rows.length === 0) {
          out.push(`## ${id}`, "_(not found in Document table)_", "");
          continue;
        }
        const latest = docs.rows[docs.rows.length - 1];
        out.push(
          `## ${latest.title} (${latest.kind}) — \`${id}\``,
          `Versions saved: ${docs.rows.length}. Showing latest (${latest.createdAt}).`,
          "",
          "```json",
          asJson(parseMaybeJson(latest.content), args.full),
          "```",
          ""
        );
      }
    }

    const text = out.join("\n");
    if (args.out) {
      writeFileSync(args.out, text);
      console.log(`wrote ${args.out} (${text.length} chars)`);
    } else {
      console.log(text);
    }
  } finally {
    await client.close();
  }
}

function parseMaybeJson(value: string | null): unknown {
  if (!value) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
