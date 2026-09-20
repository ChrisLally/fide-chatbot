"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  NIGHT_FIT_CRITERIA,
  TRANSPORT_MODE_CRITERIA,
  type JevScores,
} from "@/lib/itinerary/jev-types";

function pct(value: number | undefined): string {
  if (typeof value !== "number") {
    return "—";
  }
  return `${Math.round(value * 100)}%`;
}

function RankingsLegend() {
  return (
    <details className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        How to read this
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">
          Labels are our 0–4 scale (and four transport choices), not generated
          prose. Stay-min/rec/max come from the graph when a place has a band.
        </p>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Nights 0–4
          </h3>
          <ol className="mt-1 space-y-0.5 text-xs text-foreground">
            {NIGHT_FIT_CRITERIA.map((line, level) => (
              <li key={line}>
                <span className="font-medium tabular-nums">{level}</span>
                <span className="text-muted-foreground"> — {line}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Transport
          </h3>
          <ul className="mt-1 space-y-0.5 text-xs text-foreground">
            {(
              Object.keys(TRANSPORT_MODE_CRITERIA) as Array<
                keyof typeof TRANSPORT_MODE_CRITERIA
              >
            ).map((mode) => (
              <li key={mode}>
                <span className="font-medium">{mode}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {TRANSPORT_MODE_CRITERIA[mode]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

export function JevScoresButton({ scores }: { scores?: JevScores | null }) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="Rankings"
        className="inline-flex size-7 items-center justify-center rounded-md border border-border/70 bg-background text-sm font-medium text-foreground hover:bg-muted"
        title="Rankings"
        type="button"
      >
        ?
      </DialogTrigger>
      <DialogContent className="max-h-[min(80vh,40rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rankings</DialogTitle>
          <DialogDescription>
            Advisory scores for night split and transport. They do not change
            the trip.
          </DialogDescription>
        </DialogHeader>
        {!scores ? (
          <p className="text-sm text-muted-foreground">
            Scores appear after a route is created or patched. Open this again
            once the itinerary finishes writing.
          </p>
        ) : scores.error ? (
          <p className="text-sm text-destructive">{scores.error}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">
              {scores.nightsSum} nights
              {scores.durationDays != null
                ? ` · ${scores.durationDays} calendar days`
                : ""}
              {scores.verifierOk ? "" : " · verifier has hard errors"}
            </p>
            {scores.verifierErrors.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                {scores.verifierErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Nights per place
              </h3>
              {scores.nights.length === 0 ? (
                <p className="text-muted-foreground">No overnight stops to rank.</p>
              ) : (
                <ul className="space-y-2">
                  {scores.nights.map((row) => (
                      <li
                        className="rounded-lg border border-border/60 px-3 py-2"
                        key={`${row.stopIndex}-${row.placeId}`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">
                            {row.placeName} · {row.nights}{" "}
                            {row.nights === 1 ? "night" : "nights"}
                          </span>
                          <span className="text-xs tabular-nums">
                            {row.score.toFixed(2)} / 4
                          </span>
                        </div>
                        {(row.stayMin != null ||
                          row.stayRec != null ||
                          row.stayMax != null) && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Graph min {row.stayMin ?? "—"} / rec{" "}
                            {row.stayRec ?? "—"} / max {row.stayMax ?? "—"}
                          </p>
                        )}
                      </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Transport between places
              </h3>
              {scores.legs.length === 0 ? (
                <p className="text-muted-foreground">No transfer legs to rank.</p>
              ) : (
                <ul className="space-y-2">
                  {scores.legs.map((leg) => (
                    <li
                      className="rounded-lg border border-border/60 px-3 py-2"
                      key={leg.key}
                    >
                      <div className="font-medium">
                        {leg.fromLabel} → {leg.toLabel}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Chosen: {leg.chosenMode ?? "none"}
                        {leg.durationHours != null
                          ? ` · ${leg.durationHours}h`
                          : ""}
                        {leg.carDisallowed ? " · car already illegal" : ""}
                      </p>
                      <p className="mt-1 text-xs">
                        {leg.recommended === "uncertain" ? (
                          <span className="font-medium">
                            Uncertain — do not book
                          </span>
                        ) : (
                          <>
                            Recommended:{" "}
                            <span className="font-medium">{leg.recommended}</span>
                          </>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
                        {(
                          Object.keys(TRANSPORT_MODE_CRITERIA) as Array<
                            keyof typeof TRANSPORT_MODE_CRITERIA
                          >
                        ).map((mode) => {
                          const selected = leg.recommended === mode;
                          return (
                            <span
                              className={
                                selected
                                  ? "rounded bg-foreground px-1.5 py-0.5 font-semibold text-background"
                                  : "rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                              }
                              key={mode}
                            >
                              {mode} {pct(leg.probabilities[mode])}
                            </span>
                          );
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <RankingsLegend />
      </DialogContent>
    </Dialog>
  );
}
