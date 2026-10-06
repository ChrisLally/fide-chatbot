/**
 * Structured itinerary tool failure — never collapse to opaque chat Oops.
 * Aligns with patch diagnostics: { error, code, hint, diagnostics? }.
 */
export class ItineraryToolError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly diagnostics?: Array<{
    opIndex: number;
    code: string;
    message: string;
    candidates?: string[];
  }>;

  constructor(args: {
    code: string;
    message: string;
    hint: string;
    diagnostics?: ItineraryToolError["diagnostics"];
  }) {
    super(args.message);
    this.name = "ItineraryToolError";
    this.code = args.code;
    this.hint = args.hint;
    this.diagnostics = args.diagnostics;
  }

  toToolResult() {
    return {
      error: this.message,
      code: this.code,
      hint: this.hint,
      ...(this.diagnostics?.length ? { diagnostics: this.diagnostics } : {}),
    };
  }
}

export function itineraryToolErrorFromUnknown(error: unknown): {
  error: string;
  code: string;
  hint: string;
  diagnostics?: ItineraryToolError["diagnostics"];
} {
  if (error instanceof ItineraryToolError) {
    return error.toToolResult();
  }
  const message =
    error instanceof Error ? error.message : "Failed to create itinerary";
  const codeMatch = /^([A-Z][A-Z0-9_]+):\s*(.*)$/.exec(message);
  if (codeMatch) {
    return {
      error: codeMatch[2] || message,
      code: codeMatch[1],
      hint: "Fix the coded error and retry once. Do not open a second itinerary.",
    };
  }
  return {
    error: message,
    code: "CREATE_FAILED",
    hint: "run_view inventory/places-search, then retry createDocument with stops [{ placeId, nights }]. Do not open a second itinerary. Do not add hotels yet.",
  };
}
