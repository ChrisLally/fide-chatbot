"use client";

import { LoaderIcon, UploadIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const DATA_UPLOAD_ACCEPT = ".xlsx,.xls,.csv,.md,.txt,.pdf,.json";

export function ContextDataUpload({ className }: { className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) {
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let lastName = "";

    try {
      for (const file of list) {
        const body = new FormData();
        body.append("file", file);

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/data/upload`,
          {
            method: "POST",
            body,
          }
        );

        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          filename?: string;
          originalName?: string;
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error || `Failed to upload ${file.name}`);
        }

        successCount += 1;
        lastName = payload?.originalName || file.name;
      }

      if (successCount === 1) {
        toast.success(`Received ${lastName}. It will be added to the graph soon.`);
      } else {
        toast.success(
          `Received ${successCount} files. They will be added to the graph soon.`
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload data file"
      );
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }, []);

  return (
    <div className={cn("mt-2", className)}>
      <input
        accept={DATA_UPLOAD_ACCEPT}
        className="hidden"
        disabled={isUploading}
        multiple
        onChange={(event) => {
          if (event.target.files) {
            void uploadFiles(event.target.files);
          }
        }}
        ref={inputRef}
        type="file"
      />
      <button
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {isUploading ? (
          <LoaderIcon className="size-4 animate-spin" />
        ) : (
          <UploadIcon className="size-4" />
        )}
        {isUploading ? "Uploading…" : "Upload data"}
      </button>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Allowed: xlsx, csv, md, txt, pdf, json. Uploaded data will be added to
        the graph soon.
      </p>
    </div>
  );
}
