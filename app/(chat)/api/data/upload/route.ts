import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  buildUploadFilename,
  DATA_UPLOAD_ALLOWED_EXTENSIONS,
  DATA_UPLOAD_MAX_BYTES,
  getDataUploadDir,
  isAllowedDataUpload,
} from "@/lib/fide/data-upload";

const DISCORD_ATTACH_MAX_BYTES = 20 * 1024 * 1024;

async function notifyDiscordDataUpload({
  originalName,
  storedName,
  size,
  kind,
  textPreview,
  bytes,
}: {
  originalName: string;
  storedName: string;
  size: number;
  kind: "file" | "paste";
  textPreview?: string;
  bytes: Buffer;
}) {
  const webhookUrl = process.env.DISCORD_DATA_UPLOAD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return;
  }

  try {
    const fields = [
      { name: "Original name", value: originalName.slice(0, 256) },
      { name: "Stored as", value: storedName.slice(0, 256) },
      { name: "Size", value: `${size.toLocaleString()} bytes` },
      { name: "Kind", value: kind },
    ];

    const description =
      kind === "paste" && textPreview
        ? textPreview.slice(0, 1500)
        : "New data received in the Catalina inbox.";

    const payload = {
      embeds: [
        {
          title: "New data upload",
          description,
          color: 0x2563eb,
          timestamp: new Date().toISOString(),
          fields,
          footer: { text: "Taylor data inbox" },
        },
      ],
    };

    const outbound = new FormData();
    outbound.append("payload_json", JSON.stringify(payload));

    if (size > 0 && size <= DISCORD_ATTACH_MAX_BYTES) {
      outbound.append(
        "files[0]",
        new Blob([new Uint8Array(bytes)], {
          type: "application/octet-stream",
        }),
        originalName || storedName
      );
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      body: outbound,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(
        "Discord data-upload webhook failed",
        response.status,
        detail
      );
    }
  } catch (error) {
    console.error("Discord data-upload notify failed", error);
  }
}

async function saveInboxBytes({
  originalName,
  bytes,
  kind,
  textPreview,
}: {
  originalName: string;
  bytes: Buffer;
  kind: "file" | "paste";
  textPreview?: string;
}) {
  if (!isAllowedDataUpload(originalName)) {
    return NextResponse.json(
      {
        error: `Unsupported file type. Allowed: ${DATA_UPLOAD_ALLOWED_EXTENSIONS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (bytes.length <= 0) {
    return NextResponse.json({ error: "Empty content" }, { status: 400 });
  }

  if (bytes.length > DATA_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      { error: "File size should be less than 50MB" },
      { status: 400 }
    );
  }

  const inboxDir = getDataUploadDir();
  await mkdir(inboxDir, { recursive: true });

  const storedName = buildUploadFilename(originalName);
  const destination = path.join(inboxDir, storedName);
  await writeFile(destination, bytes, { flag: "wx" });

  // Fire-and-forget Discord notice — never block or fail the upload on it.
  void notifyDiscordDataUpload({
    originalName,
    storedName,
    size: bytes.length,
    kind,
    textPreview,
    bytes,
  });

  return NextResponse.json({
    ok: true,
    filename: storedName,
    originalName,
    size: bytes.length,
    // Staging only — not ingested into the world model yet.
    status: "received",
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        text?: unknown;
        filename?: unknown;
      };
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) {
        return NextResponse.json(
          { error: "Paste some text to save" },
          { status: 400 }
        );
      }

      const requestedName =
        typeof body.filename === "string" && body.filename.trim()
          ? body.filename.trim()
          : "paste.txt";
      const originalName = requestedName.toLowerCase().endsWith(".txt")
        ? requestedName
        : `${requestedName}.txt`;

      return await saveInboxBytes({
        originalName,
        bytes: Buffer.from(text, "utf8"),
        kind: "paste",
        textPreview: text,
      });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.name?.trim()) {
      return NextResponse.json({ error: "Missing filename" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return await saveInboxBytes({
      originalName: file.name,
      bytes: buffer,
      kind: "file",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
