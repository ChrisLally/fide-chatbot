"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-2 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

type ViewMode = "text" | "json";

function tryParseJsonString(value: string): unknown {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function indentText(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n");
}

export function formatToolValueAsText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    const parsed = tryParseJsonString(value);
    if (parsed !== value) {
      return formatToolValueAsText(parsed, depth);
    }

    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "(empty list)";
    }

    return value
      .map((item, index) => {
        const formatted = formatToolValueAsText(item, depth + 1);
        if (formatted.includes("\n")) {
          return `${index + 1}.\n${indentText(formatted)}`;
        }
        return `${index + 1}. ${formatted}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    if (
      "content" in value &&
      Array.isArray((value as { content: unknown }).content)
    ) {
      const content = (
        value as { content: Array<{ type?: string; text?: string }> }
      ).content;

      return content
        .map((part) => {
          if (part.type === "text" && typeof part.text === "string") {
            return formatToolValueAsText(part.text, depth);
          }

          return formatToolValueAsText(part, depth + 1);
        })
        .filter(Boolean)
        .join("\n\n");
    }

    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "(empty object)";
    }

    return entries
      .map(([key, nestedValue]) => {
        const formatted = formatToolValueAsText(nestedValue, depth + 1);
        if (formatted.includes("\n")) {
          return `${key}:\n${indentText(formatted)}`;
        }
        return `${key}: ${formatted}`;
      })
      .join("\n");
  }

  return String(value);
}

function ToolViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex items-center rounded-md border p-0.5">
      <button
        className={cn(
          "rounded px-2 py-0.5 text-xs transition-colors",
          mode === "text"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => onChange("text")}
        type="button"
      >
        Text
      </button>
      <button
        className={cn(
          "rounded px-2 py-0.5 text-xs transition-colors",
          mode === "json"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => onChange("json")}
        type="button"
      >
        JSON
      </button>
    </div>
  );
}

function ToolDataSection({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  const [mode, setMode] = useState<ViewMode>("text");
  const textValue = formatToolValueAsText(value);

  return (
    <div className="space-y-2 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {label}
        </h4>
        <ToolViewModeToggle mode={mode} onChange={setMode} />
      </div>
      <div className="rounded-md bg-muted/50 p-3">
        {mode === "json" ? (
          <CodeBlock code={JSON.stringify(value, null, 2)} language="json" />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-foreground text-sm leading-relaxed">
            {textValue}
          </pre>
        )}
      </div>
    </div>
  );
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("overflow-hidden", className)} {...props}>
    <ToolDataSection label="Parameters" value={input} />
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  if (errorText) {
    return (
      <div className={cn("space-y-2", className)} {...props}>
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Error
        </h4>
        <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
          {errorText}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden", className)} {...props}>
      <ToolDataSection label="Result" value={output} />
    </div>
  );
};
