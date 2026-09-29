import { NextResponse } from "next/server";

export const MAX_FEEDBACK_FILE_BYTES = 20 * 1024 * 1024;

const ALLOWED_FILE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

function extensionLooksAllowed(name: string) {
  return /\.(png|jpe?g|gif|webp|pdf)$/i.test(name);
}

export async function POST(request: Request) {
  const webhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "Feedback webhook is not configured" },
      { status: 503 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    console.error("feedback formData parse failed", error);
    return NextResponse.json(
      {
        error:
          "Upload too large or incomplete. Keep images under 20MB and try again.",
      },
      { status: 413 }
    );
  }

  try {
    const title =
      typeof formData.get("title") === "string"
        ? String(formData.get("title")).trim()
        : "";
    const description =
      typeof formData.get("description") === "string"
        ? String(formData.get("description")).trim()
        : "";
    const pageUrlRaw =
      typeof formData.get("pageUrl") === "string"
        ? String(formData.get("pageUrl")).trim()
        : "";
    const pageUrl =
      pageUrlRaw.length > 0 && pageUrlRaw.length <= 2000 ? pageUrlRaw : "";
    const file = formData.get("file");

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }
    if (title.length > 200) {
      return NextResponse.json(
        { error: "Title must be 200 characters or less" },
        { status: 400 }
      );
    }
    if (description.length > 4000) {
      return NextResponse.json(
        { error: "Description must be 4000 characters or less" },
        { status: 400 }
      );
    }

    const payload = {
      embeds: [
        {
          title,
          description,
          color: 0x0f766e,
          timestamp: new Date().toISOString(),
          footer: { text: "Taylor feedback" },
          ...(pageUrl
            ? {
                fields: [
                  {
                    name: "Page URL",
                    value: pageUrl,
                  },
                ],
              }
            : {}),
        },
      ],
    };

    const outbound = new FormData();
    outbound.append("payload_json", JSON.stringify(payload));

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FEEDBACK_FILE_BYTES) {
        return NextResponse.json(
          { error: "File must be under 20MB" },
          { status: 400 }
        );
      }
      const typeOk =
        !file.type ||
        ALLOWED_FILE_TYPES.has(file.type) ||
        extensionLooksAllowed(file.name);
      if (!typeOk) {
        return NextResponse.json(
          { error: "Only images (png, jpg, gif, webp) or PDF are allowed" },
          { status: 400 }
        );
      }

      // Pass the File through directly — Discord expects multipart files[n].
      outbound.append("files[0]", file, file.name || "attachment");
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      body: outbound,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Discord feedback webhook failed", response.status, detail);
      return NextResponse.json(
        { error: "Could not send feedback to Discord" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("feedback submit failed", error);
    return NextResponse.json(
      { error: "Could not send feedback" },
      { status: 500 }
    );
  }
}
