"use client";

import { MessageCircleIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
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

const apiBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function FeedbackFab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function clearFileInput() {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    clearFileInput();
    setError(null);
    setSent(false);
  }

  function openDialog() {
    resetForm();
    setPageUrl(window.location.href);
    setOpen(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    if (file && file.size > MAX_FILE_BYTES) {
      setError("File must be under 20MB. Try a smaller screenshot.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSent(false);

    try {
      const currentUrl = window.location.href;
      const body = new FormData();
      body.append("title", title.trim());
      body.append("description", description.trim());
      body.append("pageUrl", currentUrl || pageUrl);
      if (file) {
        body.append("file", file);
      }

      const response = await fetch(`${apiBase}/api/feedback`, {
        method: "POST",
        body,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Could not send feedback");
      }

      setSent(true);
      setTitle("");
      setDescription("");
      clearFileInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        aria-label="Send feedback"
        className="fixed right-4 bottom-4 z-[60] inline-flex size-12 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-lg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={openDialog}
        type="button"
      >
        <MessageCircleIcon className="size-5" />
      </button>

      <Dialog
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setPageUrl(window.location.href);
          } else {
            resetForm();
          }
        }}
        open={open}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Tell us what worked, what didn’t, or attach a screenshot.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={onSubmit}>
            <input name="pageUrl" readOnly type="hidden" value={pageUrl} />
            <div className="space-y-2">
              <Label htmlFor="feedback-title">Title</Label>
              <Input
                id="feedback-title"
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short summary"
                required
                value={title}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-description">Description</Label>
              <Textarea
                className="min-h-[120px] resize-y"
                id="feedback-description"
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What happened? What did you expect?"
                required
                value={description}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback-file">Image / file (optional)</Label>
              <Input
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                id="feedback-file"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  if (next && next.size > MAX_FILE_BYTES) {
                    clearFileInput();
                    setError(
                      "File must be under 20MB. Try a smaller screenshot."
                    );
                    return;
                  }
                  setError(null);
                  setFile(next);
                }}
                ref={fileInputRef}
                type="file"
              />
              {file ? (
                <p className="text-[11px] text-muted-foreground">
                  {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  PNG, JPG, GIF, WebP, or PDF · max 20MB
                </p>
              )}
            </div>

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
            {sent ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Thanks — feedback sent.
              </p>
            ) : null}

            <DialogFooter>
              <Button
                disabled={submitting || !title.trim() || !description.trim()}
                type="submit"
              >
                {submitting ? "Sending…" : "Send feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
