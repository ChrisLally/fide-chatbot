"use client";

import { useState } from "react";
import { CheckIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import {
  type ClientItinerary,
  type ClientItineraryDay,
  type DayBlock,
  type PeekEntityKind,
  dayBlocksForDisplay,
  dayWhenLabel,
  kindFromEntityId,
  parseClientItinerary,
  serializeClientItinerary,
} from "@/lib/itinerary/schema";
import { verifyItineraryStage } from "@/lib/itinerary/stage-verifier";
import { applyItineraryPatch } from "@/lib/itinerary/patch";
import {
  STAGE_HELP,
  STAGE_LABELS,
  approveCurrentStage,
  ensureWorkflow,
  reopenStage,
  syncDaysToNights,
  type ItineraryStage,
} from "@/lib/itinerary/stages";
import {
  stopStartDayNumbers,
  transferSlots,
  type TransferSlot,
} from "@/lib/itinerary/transfers";
import { DocumentSkeleton } from "@/components/chat/document-skeleton";
import {
  ItineraryEntityPeek,
  type PeekTarget,
} from "@/components/chat/itinerary-entity-peek";
import { StatusBadge } from "@/components/chat/travel-cards/shared";

function EntityPill({
  label,
  entityId,
  onOpen,
}: {
  label: string;
  entityId?: string;
  onOpen?: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-foreground">
      {onOpen ? (
        <button
          className="truncate transition-colors hover:underline"
          onClick={onOpen}
          title={entityId || "Peek entity without leaving itinerary"}
          type="button"
        >
          {label}
        </button>
      ) : (
        <span className="truncate" title={entityId || "Not linked to world model"}>
          {label}
        </span>
      )}
    </span>
  );
}

function BlockRow({
  block,
  editable,
  onRemove,
  onPeek,
}: {
  block: DayBlock;
  editable: boolean;
  onRemove?: () => void;
  onPeek: (target: PeekTarget) => void;
}) {
  const kind =
    block.entityKind ||
    (block.entityId ? kindFromEntityId(block.entityId) : null);
  const label =
    block.entityName ||
    block.title ||
    (block.entityId ? block.entityId : "Untitled");
  const canPeek = Boolean(block.entityId && kind);

  return (
    <div className="flex gap-3 rounded-lg border border-border/50 bg-background/70 px-3 py-2.5">
      <div className="w-20 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {dayWhenLabel[block.when]}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <EntityPill
            entityId={block.entityId}
            label={label}
            onOpen={
              canPeek
                ? () =>
                    onPeek({
                      kind: kind as PeekEntityKind,
                      id: block.entityId!,
                      label,
                    })
                : undefined
            }
          />
          {canPeek ? <StatusBadge label="linked" tone="info" /> : null}
        </div>
        {block.note || (block.title && block.entityName && block.title !== block.entityName) ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {block.note || block.title}
          </p>
        ) : null}
      </div>
      {editable && onRemove ? (
        <button
          aria-label={`Remove ${label}`}
          className="self-start rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onRemove}
          type="button"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function DayDivider({ dayNumber }: { dayNumber: number }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator">
      <div className="h-px flex-1 border-t border-dashed border-border/80" />
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Day {dayNumber}
      </span>
      <div className="h-px flex-1 border-t border-dashed border-border/80" />
    </div>
  );
}

function TransportCard({
  slot,
  onPeek,
}: {
  slot: TransferSlot;
  onPeek: (target: PeekTarget) => void;
}) {
  const transfer = slot.transfer;
  const from = transfer?.fromPlaceName?.trim() || slot.fromLabel;
  const to = transfer?.toPlaceName?.trim() || slot.toLabel;
  const mode = transfer?.mode?.trim();
  const hours = transfer?.durationHours;
  const label = transfer?.label?.trim();
  const filled = Boolean(transfer && (mode || hours != null || label || transfer.note));
  const fromId = slot.fromPlaceId;
  const toId = slot.toPlaceId;
  // Only peek routes the agent bound from transport-corridor — never guessed IRIs.
  const routeId = transfer?.routeId?.trim() || undefined;
  const canPeekFrom =
    Boolean(fromId) &&
    from.toLowerCase() !== "arrival" &&
    from.toLowerCase() !== "departure";
  const canPeekTo =
    Boolean(toId) &&
    to.toLowerCase() !== "arrival" &&
    to.toLowerCase() !== "departure";
  // Don't use generic stage words ("Arrival") as the route peek button text.
  const routeButtonLabel =
    label &&
    label.toLowerCase() !== "arrival" &&
    label.toLowerCase() !== "departure"
      ? label
      : "Open transfer route";

  return (
    <div
      className={`rounded-lg border border-dashed px-4 py-3 ${
        filled
          ? "border-border/80 bg-muted/25"
          : "border-border/50 bg-muted/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {mode ? <StatusBadge label={mode} tone="info" /> : null}
        {hours != null ? (
          <StatusBadge
            label={hours === 1 ? "1 hour" : `${hours} hours`}
            tone="neutral"
          />
        ) : null}
        {routeId ? <StatusBadge label="route" tone="info" /> : null}
        {!filled ? <StatusBadge label="TBD" tone="warning" /> : null}
      </div>
      <div className="mt-2 text-sm font-medium tracking-tight text-foreground">
        {canPeekFrom ? (
          <button
            className="transition-colors hover:underline"
            onClick={() =>
              onPeek({ kind: "destination", id: fromId!, label: from })
            }
            title="Peek origin place"
            type="button"
          >
            {from}
          </button>
        ) : (
          <span>{from}</span>
        )}
        <span className="mx-2 text-muted-foreground">→</span>
        {canPeekTo ? (
          <button
            className="transition-colors hover:underline"
            onClick={() =>
              onPeek({ kind: "destination", id: toId!, label: to })
            }
            title="Peek destination place"
            type="button"
          >
            {to}
          </button>
        ) : (
          <span>{to}</span>
        )}
      </div>
      {routeId ? (
        <button
          className="mt-1 text-left text-xs font-medium text-foreground/80 transition-colors hover:underline"
          onClick={() =>
            onPeek({
              kind: "transportation",
              id: routeId,
              label: routeButtonLabel,
            })
          }
          title="Peek transfer route in world model"
          type="button"
        >
          {routeButtonLabel}
        </button>
      ) : label &&
        label.toLowerCase() !== "arrival" &&
        label.toLowerCase() !== "departure" ? (
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      ) : null}
      {transfer?.note ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {transfer.note}
        </p>
      ) : !filled ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Ask Taylor to look up{" "}
          <span className="font-medium">inventory/transport-corridor</span> for
          this leg.
        </p>
      ) : null}
    </div>
  );
}

function DayBlockCard({
  day,
  editable,
  onRemoveDay,
  onRemoveBlock,
  onPeek,
}: {
  day: ClientItineraryDay;
  editable: boolean;
  onRemoveDay: () => void;
  onRemoveBlock: (index: number) => void;
  onPeek: (target: PeekTarget) => void;
}) {
  const blocks = dayBlocksForDisplay(day);

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Day {day.dayNumber}
          </div>
          <div className="mt-0.5 text-sm font-semibold tracking-tight">
            {day.title}
          </div>
        </div>
        {editable ? (
          <button
            aria-label={`Remove day ${day.dayNumber}`}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onRemoveDay}
            type="button"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      {day.description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {day.description}
        </p>
      ) : null}
      {day.transitNote ? (
        <p className="mt-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          {day.transitNote}
        </p>
      ) : null}
      {blocks.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {blocks.map((block, index) => (
            <BlockRow
              block={block}
              editable={editable}
              key={`${day.dayNumber}-${block.when}-${block.entityId || block.entityName || block.title}-${index}`}
              onPeek={onPeek}
              onRemove={
                day.blocks && day.blocks.length > 0
                  ? () => onRemoveBlock(index)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No timed activities yet.
        </p>
      )}
    </div>
  );
}

function StageRail({
  stage,
  editable,
  verifyErrors = [],
  verifyWarnings = [],
  canApprove = true,
  onApprove,
  onReopen,
}: {
  stage: ItineraryStage;
  editable: boolean;
  verifyErrors?: string[];
  verifyWarnings?: string[];
  canApprove?: boolean;
  onApprove: () => void;
  onReopen: (stage: "route" | "stays" | "days") => void;
}) {
  const steps: Array<"route" | "stays" | "days"> = ["route", "stays", "days"];
  const activeIndex =
    stage === "complete" ? 3 : steps.indexOf(stage as "route" | "stays" | "days");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => {
          const done = index < activeIndex || stage === "complete";
          const current = index === activeIndex && stage !== "complete";
          return (
            <button
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
                current
                  ? "bg-foreground text-background"
                  : done
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
              }`}
              key={step}
              onClick={() => {
                if (done && editable) {
                  onReopen(step);
                }
              }}
              title={done ? `Reopen ${STAGE_LABELS[step]}` : STAGE_HELP[step]}
              type="button"
            >
              {index + 1}. {STAGE_LABELS[step]}
              {done ? " ✓" : ""}
            </button>
          );
        })}
        {stage === "complete" ? (
          <StatusBadge label="Complete" tone="success" />
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {stage !== "complete" && editable ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
              disabled={!canApprove}
              onClick={onApprove}
              type="button"
            >
              <CheckIcon className="size-3.5" />
              Approve {STAGE_LABELS[stage]}
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {STAGE_HELP[stage]}
      </p>
      {verifyWarnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {verifyWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {verifyErrors.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
          {verifyErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ItineraryEditor({
  content,
  status,
  isCurrentVersion,
  onSaveContent,
}: {
  content: string;
  status: "streaming" | "idle";
  isCurrentVersion: boolean;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
}) {
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const parsed = parseClientItinerary(content);
  const editable = isCurrentVersion && status !== "streaming";

  if (!parsed.ok) {
    if (status === "streaming" || !content.trim()) {
      return <DocumentSkeleton artifactKind="itinerary" />;
    }
    return (
      <div className="space-y-3 px-4 py-8 text-sm md:px-10">
        <p className="font-medium text-foreground">
          Could not parse itinerary JSON
        </p>
        <p className="text-muted-foreground">
          Usually this means stops/blocks were missing world-model entity ids
          (graph-only contract). Taylor should regenerate with placeId /
          entityId copied from run_view.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive whitespace-pre-wrap">
          {parsed.error}
        </pre>
      </div>
    );
  }

  const itinerary = {
    ...parsed.data,
    days: syncDaysToNights(parsed.data.stops, parsed.data.days),
    durationDays: Math.max(
      parsed.data.durationDays,
      parsed.data.stops.reduce((sum, stop) => sum + stop.nights, 0)
    ),
  };
  const workflow = ensureWorkflow(itinerary);
  const stage = workflow.stage;
  const verify = verifyItineraryStage(itinerary, stage);
  const approveGate = verifyItineraryStage(itinerary, stage, { forApprove: true });

  const routeLocked = Boolean(workflow.approved.route) && stage !== "route";
  const daysEditable = editable && (stage === "days" || stage === "complete");
  const routeEditable = editable && !routeLocked;

  const commit = (next: ClientItinerary) => {
    onSaveContent(serializeClientItinerary(next), true);
  };

  const handleApprove = () => {
    if (!approveGate.ok) {
      toast.error(approveGate.errors[0] ?? "Fix verification errors first");
      return;
    }
    const next = approveCurrentStage(itinerary);
    onSaveContent(serializeClientItinerary(next), false);
    toast.success(`${STAGE_LABELS[stage]} approved`);
  };

  const handleReopen = (target: "route" | "stays" | "days") => {
    const next = reopenStage(itinerary, target);
    onSaveContent(serializeClientItinerary(next), false);
    toast.message(`Reopened ${STAGE_LABELS[target]}`);
  };

  const updateStopNights = (stopIndex: number, delta: number) => {
    if (!routeEditable) {
      return;
    }
    const nextNights = Math.max(1, itinerary.stops[stopIndex].nights + delta);
    const result = applyItineraryPatch(itinerary, {
      op: "setStopNights",
      stopIndex,
      nights: nextNights,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    commit(result.itinerary);
  };

  const removeDay = (dayNumber: number) => {
    if (!daysEditable) {
      return;
    }
    commit({
      ...itinerary,
      days: itinerary.days.filter((day) => day.dayNumber !== dayNumber),
      durationDays: Math.max(
        1,
        itinerary.days.filter((day) => day.dayNumber !== dayNumber).length
      ),
    });
  };

  const removeBlock = (dayNumber: number, blockIndex: number) => {
    if (!daysEditable) {
      return;
    }
    commit({
      ...itinerary,
      days: itinerary.days.map((day) => {
        if (day.dayNumber !== dayNumber || !day.blocks) {
          return day;
        }
        return {
          ...day,
          blocks: day.blocks.filter((_, index) => index !== blockIndex),
        };
      }),
    });
  };

  return (
    <div className="relative flex h-full min-h-[28rem] w-full overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-10 shrink-0 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-8">
          <StageRail
            canApprove={approveGate.ok}
            editable={editable}
            onApprove={handleApprove}
            onReopen={handleReopen}
            stage={stage}
            verifyErrors={verify.errors ?? []}
            verifyWarnings={verify.warnings ?? []}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
            <div className="space-y-3 border-b border-border/50 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label="Client itinerary" tone="info" />
                <StatusBadge
                  label={`${itinerary.durationDays} days`}
                  tone="neutral"
                />
                <StatusBadge
                  label={`Stage: ${STAGE_LABELS[stage]}`}
                  tone="warning"
                />
                {status === "streaming" ? (
                  <StatusBadge label="Streaming" tone="warning" />
                ) : null}
              </div>
              <h2 className="text-xl font-semibold tracking-tight">
                {itinerary.title}
              </h2>
              {itinerary.summary ? (
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {itinerary.summary}
                </p>
              ) : null}
            </div>

            <div className="space-y-4">
            {(() => {
              const slots = transferSlots(itinerary);
              const arrival = slots.find((s) => s.kind === "arrival");
              const departure = slots.find((s) => s.kind === "departure");
              const betweenByFrom = new Map(
                slots
                  .filter((s) => s.kind === "between")
                  .map((s) => [s.fromStopIndex, s])
              );
              const startDays = stopStartDayNumbers(itinerary.stops);

              return (
                <>
                  {itinerary.stops.map((stop, stopIndex) => {
                    const stopDays = itinerary.days
                      .filter((day) => day.stopIndex === stopIndex)
                      .sort((a, b) => a.dayNumber - b.dayNumber);
                    const dayNumber = startDays[stopIndex] ?? 1;
                    const inbound =
                      stopIndex === 0
                        ? arrival
                        : betweenByFrom.get(stopIndex - 1);

                    return (
                      <div className="space-y-4" key={`${stop.placeName}-${stopIndex}`}>
                        <DayDivider dayNumber={dayNumber} />
                        {inbound ? (
                          <TransportCard onPeek={setPeek} slot={inbound} />
                        ) : null}
                        <section className="overflow-hidden rounded-lg border border-border/70 bg-background p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                Stop {stopIndex + 1}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <EntityPill
                                  entityId={stop.placeId}
                                  label={stop.placeName}
                                  onOpen={
                                    stop.placeId
                                      ? () =>
                                          setPeek({
                                            kind: "destination",
                                            id: stop.placeId,
                                            label: stop.placeName,
                                          })
                                      : undefined
                                  }
                                />
                                {stop.hotelName ? (
                                  <EntityPill
                                    entityId={stop.hotelId}
                                    label={stop.hotelName}
                                    onOpen={
                                      stop.hotelId
                                        ? () =>
                                            setPeek({
                                              kind: "hotel",
                                              id: stop.hotelId!,
                                              label: stop.hotelName,
                                            })
                                        : undefined
                                    }
                                  />
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">
                                    No hotel yet
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/70 px-1 py-0.5">
                              <button
                                aria-label={`Fewer nights in ${stop.placeName}`}
                                className="rounded-md p-1.5 text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40"
                                disabled={!routeEditable || stop.nights <= 1}
                                onClick={() => updateStopNights(stopIndex, -1)}
                                type="button"
                              >
                                <MinusIcon className="size-3.5" />
                              </button>
                              <span className="min-w-14 text-center text-xs font-medium">
                                {stop.nights}{" "}
                                {stop.nights === 1 ? "night" : "nights"}
                              </span>
                              <button
                                aria-label={`More nights in ${stop.placeName}`}
                                className="rounded-md p-1.5 text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-40"
                                disabled={!routeEditable}
                                onClick={() => updateStopNights(stopIndex, 1)}
                                type="button"
                              >
                                <PlusIcon className="size-3.5" />
                              </button>
                            </div>
                          </div>

                          {stopDays.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {stopDays.map((day) => (
                                <DayBlockCard
                                  day={day}
                                  editable={daysEditable}
                                  key={day.dayNumber}
                                  onPeek={setPeek}
                                  onRemoveBlock={(index) =>
                                    removeBlock(day.dayNumber, index)
                                  }
                                  onRemoveDay={() => removeDay(day.dayNumber)}
                                />
                              ))}
                            </div>
                          ) : null}
                        </section>
                      </div>
                    );
                  })}
                  {departure ? (
                    <div className="space-y-4">
                      <DayDivider
                        dayNumber={
                          startDays[itinerary.stops.length] ??
                          itinerary.durationDays
                        }
                      />
                      <TransportCard onPeek={setPeek} slot={departure} />
                    </div>
                  ) : null}
                </>
              );
            })()}
            </div>
          </div>
        </div>
      </div>

      {peek ? (
        <>
          <button
            aria-label="Dismiss entity peek"
            className="absolute inset-0 z-10 bg-background/40 backdrop-blur-[1px] transition-opacity"
            onClick={() => setPeek(null)}
            type="button"
          />
          <div className="absolute inset-y-0 right-0 z-20 w-full animate-in slide-in-from-right duration-200 sm:w-[90%] sm:shadow-[-12px_0_32px_rgba(0,0,0,0.12)]">
            <ItineraryEntityPeek peek={peek} onClose={() => setPeek(null)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
