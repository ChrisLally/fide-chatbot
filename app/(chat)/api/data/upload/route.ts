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

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.name?.trim()) {
      return NextResponse.json({ error: "Missing filename" }, { status: 400 });
    }

    if (!isAllowedDataUpload(file.name)) {
      return NextResponse.json(
        {
          error: `Unsupported file type. Allowed: ${DATA_UPLOAD_ALLOWED_EXTENSIONS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (file.size > DATA_UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { error: "File size should be less than 50MB" },
        { status: 400 }
      );
    }

    const inboxDir = getDataUploadDir();
    await mkdir(inboxDir, { recursive: true });

    const storedName = buildUploadFilename(file.name);
    const destination = path.join(inboxDir, storedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destination, buffer, { flag: "wx" });

    return NextResponse.json({
      ok: true,
      filename: storedName,
      originalName: file.name,
      size: file.size,
      // Staging only — not ingested into the world model yet.
      status: "received",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
