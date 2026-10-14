"use client";

import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { Guest } from "@/lib/itinerary/schema";
import { cn } from "@/lib/utils";

const fieldClass =
  "rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50";

/**
 * Guests on the trip (clients, not necessarily the person chatting). Optional: nothing is blocked
 * without them. Fields save on blur; buttons save immediately. Collapsible; open while there are none.
 */
export function GuestsPanel({
  guests,
  editable,
  onChange,
}: {
  guests: Guest[];
  editable: boolean;
  onChange: (next: Guest[]) => void;
}) {
  const [open, setOpen] = useState(guests.length === 0);

  const updateGuest = (index: number, patch: Partial<Guest>) => {
    const next = { ...guests[index], ...patch };
    // Clearing both fields would leave a blank guest, which the itinerary cannot be saved with.
    if (!next.name && !next.info) {
      return;
    }
    onChange(guests.map((guest, i) => (i === index ? next : guest)));
  };

  return (
    <section className="space-y-3 rounded-lg border border-border/60 p-4">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDownIcon
          className={cn("size-4 transition-transform", open ? "" : "-rotate-90")}
        />
        <span className="text-sm font-semibold tracking-tight">Guests on this trip</span>
        <span className="text-xs text-muted-foreground">
          {guests.length === 0
            ? "none yet"
            : `${guests.length} ${guests.length === 1 ? "guest" : "guests"}`}
        </span>
      </button>

      {open ? (
        <div className="space-y-3">
          <ul className="space-y-3">
            {guests.map((guest, index) => (
              <li
                className="grid gap-2 rounded-md border border-border/50 p-3"
                key={guest.guestId ?? index}
              >
                <div className="flex gap-2">
                  <input
                    className={cn(fieldClass, "flex-1")}
                    // Remount when the saved value changes, so agent edits show without a reload.
                    defaultValue={guest.name ?? ""}
                    disabled={!editable}
                    key={`name-${guest.name ?? ""}`}
                    onBlur={(event) =>
                      updateGuest(index, { name: event.target.value.trim() || undefined })
                    }
                    placeholder="Guest name (optional)"
                    type="text"
                  />
                  <button
                    aria-label="Remove guest"
                    className="rounded-md border border-border px-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={!editable}
                    onClick={() => onChange(guests.filter((_, i) => i !== index))}
                    type="button"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
                <textarea
                  className={cn(fieldClass, "min-h-16")}
                  defaultValue={guest.info ?? ""}
                  disabled={!editable}
                  key={`info-${guest.info ?? ""}`}
                  onBlur={(event) =>
                    updateGuest(index, { info: event.target.value.trim() || undefined })
                  }
                  placeholder="About them: ages, interests, pace, needs, anything that matters"
                />
              </li>
            ))}
          </ul>

          <AddGuest disabled={!editable} onAdd={(guest) => onChange([...guests, guest])} />
        </div>
      ) : null}
    </section>
  );
}

/** A guest needs a name or some info, so the form will not add an empty guest. */
function AddGuest({ disabled, onAdd }: { disabled: boolean; onAdd: (guest: Guest) => void }) {
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const name = String(form.get("name") ?? "").trim();
        const info = String(form.get("info") ?? "").trim();
        if (!name && !info) {
          return;
        }
        onAdd({ name: name || undefined, info: info || undefined });
        event.currentTarget.reset();
      }}
    >
      <input
        className={fieldClass}
        disabled={disabled}
        name="name"
        placeholder="Guest name (optional)"
        type="text"
      />
      <input
        className={fieldClass}
        disabled={disabled}
        name="info"
        placeholder="About them (or a name)"
        type="text"
      />
      <button
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm hover:bg-muted disabled:opacity-50"
        disabled={disabled}
        type="submit"
      >
        <PlusIcon className="size-4" />
        Add guest
      </button>
    </form>
  );
}
