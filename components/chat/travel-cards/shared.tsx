import type { ReactNode } from "react";
import { FideIdChip } from "@/components/chat/fide-id-chip";
import { cn } from "@/lib/utils";

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "luxury" | "info";
}) {
  // Keep tone prop for callers; all tones render the same quiet chip.
  void tone;
  return (
    <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

export function toneForPriceTier(_value: string) {
  return "neutral" as const;
}

export function toneForRating(_value: string) {
  return "neutral" as const;
}

export function CardShell({
  eyebrow,
  title,
  subtitle,
  entityId,
  children,
  accent = "catalina",
  onOpen,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** When set, shows a click-to-expand Fide id under the title. */
  entityId?: string;
  children: ReactNode;
  accent?: "catalina" | "gold" | "slate";
  onOpen?: () => void;
}) {
  void accent;

  return (
    <div className="rounded-lg border border-border/70 bg-background p-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </div>
            <div className="mt-1 text-base font-semibold tracking-tight text-foreground">
              {title}
            </div>
            {entityId ? (
              <div className="mt-1">
                <FideIdChip id={entityId} />
              </div>
            ) : null}
            {subtitle ? (
              <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          {onOpen ? (
            <button
              aria-label={`Open ${title} in context`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onOpen}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                viewBox="0 0 24 24"
              >
                <path
                  d="M9 5l7 7-7 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function FieldGrid({
  fields,
}: {
  fields: Array<{
    label: string;
    value: string;
    onOpen?: () => void;
  }>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          className="rounded-md border border-border/50 px-3 py-2"
          key={field.label}
        >
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {field.label}
          </dt>
          <dd className="mt-0.5 text-sm text-foreground">
            {field.onOpen ? (
              <button
                className="inline-flex max-w-full items-center gap-1 text-left underline-offset-2 hover:underline"
                onClick={field.onOpen}
                type="button"
              >
                <span className="truncate">{field.value}</span>
                <svg
                  aria-hidden="true"
                  className="size-3.5 shrink-0 opacity-60"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9 5l7 7-7 7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : (
              field.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, 5).map((tag) => (
        <span
          className="rounded-md border border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground"
          key={tag}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
