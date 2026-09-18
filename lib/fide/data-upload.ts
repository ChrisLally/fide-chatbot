import path from "node:path";

/** Default inbox under the chatbot working directory. Override with DATA_UPLOAD_DIR. */
export function getDataUploadDir() {
  const configured = process.env.DATA_UPLOAD_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), "data-inbox");
}

export const DATA_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const DATA_UPLOAD_ALLOWED_EXTENSIONS = [
  ".xlsx",
  ".xls",
  ".csv",
  ".md",
  ".txt",
  ".pdf",
  ".json",
] as const;

export const DATA_UPLOAD_ACCEPT = DATA_UPLOAD_ALLOWED_EXTENSIONS.join(",");

export function sanitizeUploadBasename(filename: string) {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base.replace(/^\.+/, "") || "upload.bin";
}

export function extensionOf(filename: string) {
  return path.extname(filename).toLowerCase();
}

export function isAllowedDataUpload(filename: string) {
  return (DATA_UPLOAD_ALLOWED_EXTENSIONS as readonly string[]).includes(
    extensionOf(filename)
  );
}

/** UTC stamp safe for filenames: 20260907T041215Z */
export function uploadTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function buildUploadFilename(originalName: string, date = new Date()) {
  const nonce = Math.random().toString(36).slice(2, 6);
  return `${uploadTimestamp(date)}__${nonce}__${sanitizeUploadBasename(originalName)}`;
}
