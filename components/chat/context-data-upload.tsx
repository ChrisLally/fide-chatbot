"use client";

import { LoaderIcon, UploadIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const DATA_UPLOAD_ACCEPT = ".xlsx,.xls,.csv,.md,.txt,.pdf,.json";
const apiBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function ContextDataUpload({ className }: { className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const resetDialog = useCallback(() => {
    setPasteText("");
    setFiles([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const canSubmit = files.length > 0 || pasteText.trim().length > 0;

  const onSubmit = useCallback(async () => {
    if (!canSubmit || isUploading) {
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let lastName = "";

    try {
      for (const file of files) {
        const body = new FormData();
        body.append("file", file);

        const response = await fetch(`${apiBase}/api/data/upload`, {
          method: "POST",
          body,
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          originalName?: string;
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error || `Failed to upload ${file.name}`);
        }

        successCount += 1;
        lastName = payload?.originalName || file.name;
      }

      const text = pasteText.trim();
      if (text) {
        const response = await fetch(`${apiBase}/api/data/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: pasteText, filename: "paste.txt" }),
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          originalName?: string;
        } | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to save pasted text");
        }

        successCount += 1;
        lastName = payload?.originalName || "paste.txt";
      }

      if (successCount === 1) {
        toast.success(`Received ${lastName}. It will be added to the graph soon.`);
      } else {
        toast.success(
          `Received ${successCount} items. They will be added to the graph soon.`
        );
      }

      resetDialog();
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload data"
      );
    } finally {
      setIsUploading(false);
    }
  }, [canSubmit, files, isUploading, pasteText, resetDialog]);

  return (
    <div className={cn("mt-2", className)}>
      <button
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isUploading}
        onClick={() => {
          resetDialog();
          setOpen(true);
        }}
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
        Attach a file and/or paste text. Allowed: xlsx, csv, md, txt, pdf, json.
        Uploaded data will be added to the graph soon.
      </p>

      <Dialog
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            resetDialog();
          }
        }}
        open={open}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload data</DialogTitle>
            <DialogDescription>
              Attach a file, paste text, or both. Pastes are saved as .txt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="context-data-file">File (optional)</Label>
              <Input
                accept={DATA_UPLOAD_ACCEPT}
                disabled={isUploading}
                id="context-data-file"
                multiple
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                }}
                ref={inputRef}
                type="file"
              />
              {files.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {files.map((file) => file.name).join(", ")}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="context-data-paste">Paste (optional)</Label>
              <Textarea
                className="min-h-[120px] resize-y"
                disabled={isUploading}
                id="context-data-paste"
                onChange={(event) => setPasteText(event.target.value)}
                placeholder="Paste text, notes, CSV rows…"
                value={pasteText}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              disabled={isUploading || !canSubmit}
              onClick={() => void onSubmit()}
              type="button"
            >
              {isUploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
