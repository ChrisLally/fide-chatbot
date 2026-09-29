"use client";

import { formatDistanceToNow } from "date-fns";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetcher } from "@/lib/utils";

type EntityCommentRow = {
  id: string;
  entityId: string;
  body: string;
  createdAt: string;
};

const apiBase = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function EntityComments({ entityId }: { entityId: string }) {
  const key = `${apiBase}/api/entity-comments?entityId=${encodeURIComponent(entityId)}`;
  const { data, error, isLoading, mutate } = useSWR<EntityCommentRow[]>(
    key,
    fetcher,
    { revalidateOnFocus: true }
  );
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`${apiBase}/api/entity-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          cause?: string;
        } | null;
        throw new Error(payload?.cause ?? "Could not post comment");
      }
      const created = (await response.json()) as EntityCommentRow;
      setDraft("");
      await mutate((current) => [...(current ?? []), created], {
        revalidate: true,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not post");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    if (deletingId) {
      return;
    }
    setDeletingId(id);
    setSubmitError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/entity-comments?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          cause?: string;
        } | null;
        throw new Error(payload?.cause ?? "Could not delete comment");
      }
      await mutate(
        (current) => (current ?? []).filter((comment) => comment.id !== id),
        { revalidate: true }
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setDeletingId(null);
    }
  }

  const comments = data ?? [];

  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          Comments
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {isLoading ? "…" : `${comments.length}`}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {error ? (
          <p className="text-xs text-destructive">Could not load comments.</p>
        ) : null}
        {!isLoading && !error && comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No comments yet. Be the first.
          </p>
        ) : null}
        {comments.map((comment) => (
          <article
            className="border-b border-border/40 pb-3 last:border-0 last:pb-0"
            key={comment.id}
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Anonymous</span>
                <span aria-hidden="true">·</span>
                <time dateTime={comment.createdAt}>
                  {formatDistanceToNow(new Date(comment.createdAt), {
                    addSuffix: true,
                  })}
                </time>
              </div>
              <button
                className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline disabled:opacity-50"
                disabled={deletingId === comment.id}
                onClick={() => onDelete(comment.id)}
                type="button"
              >
                {deletingId === comment.id ? "Deleting…" : "Delete"}
              </button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {comment.body}
            </p>
          </article>
        ))}
      </div>

      <form className="mt-4 space-y-2" onSubmit={onSubmit}>
        <Textarea
          className="min-h-[72px] resize-y text-sm"
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment…"
          value={draft}
        />
        <div className="flex items-center justify-between gap-2">
          {submitError ? (
            <p className="text-xs text-destructive">{submitError}</p>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Posts as Anonymous
            </span>
          )}
          <Button
            disabled={submitting || !draft.trim()}
            size="sm"
            type="submit"
          >
            {submitting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </form>
    </section>
  );
}
