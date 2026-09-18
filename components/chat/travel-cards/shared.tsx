import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "luxury" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        tone === "success" &&
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        tone === "warning" &&
          "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tone === "luxury" &&
          "bg-amber-500/20 text-amber-900 ring-1 ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-200",
        tone === "info" &&
          "bg-sky-500/15 text-sky-700 dark:text-sky-300",
        tone === "neutral" && "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

export function toneForPriceTier(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("$$$$") || normalized.includes("luxury"))
    return "luxury" as const;
  if (normalized.includes("$$$")) return "info" as const;
  if (normalized.includes("$$")) return "neutral" as const;
  return "neutral" as const;
}

export function toneForRating(value: string) {
  const num = Number.parseFloat(value);
  if (!Number.isNaN(num) && num >= 4.5) return "luxury" as const;
  if (!Number.isNaN(num) && num >= 4.0) return "success" as const;
  return "neutral" as const;
}

export function CardShell({
  eyebrow,
  title,
  subtitle,
  children,
  accent = "catalina",
  onOpen,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  accent?: "catalina" | "gold" | "slate";
  onOpen?: () => void;
}) {
  const accentClass =
    accent === "gold"
      ? "from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/30"
      : accent === "slate"
        ? "from-slate-500/10 via-slate-500/5 to-transparent border-border/60"
        : "from-sky-500/10 via-blue-500/5 to-transparent border-sky-500/20";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-[var(--shadow-card)]",
        accentClass
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </div>
            <div className="mt-1 text-base font-semibold tracking-tight">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {subtitle}
              </div>
            ) : null}
          </div>
          {onOpen ? (
            <button
              aria-label={`Open ${title} in context`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
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
          className="rounded-lg border border-border/50 bg-background/60 px-3 py-2"
          key={field.label}
        >
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {field.label}
          </dt>
          <dd className="mt-0.5 text-sm font-medium">
            {field.onOpen ? (
              <button
                className="inline-flex max-w-full items-center gap-1 text-left text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                onClick={field.onOpen}
                type="button"
              >
                <span className="truncate">{field.value}</span>
                <svg
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
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
          className="rounded-md bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/60"
          key={tag}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
