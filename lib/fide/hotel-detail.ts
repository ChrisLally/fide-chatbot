/**
 * Parsing for hotel detail rows (inventory/hotel). Kept out of the card component
 * so the text handling can be unit tested without rendering.
 */

/** Split a delimited column into trimmed, non-empty items. */
export function splitList(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
}

export type HotelRoom = { name: string; description: string };

/**
 * Rooms come from the query as one line per room: `Name :: description`.
 * The description may itself contain " :: ", so only the first separator splits.
 */
export function parseRooms(value: string): HotelRoom[] {
  return splitList(value, "\n").map((line) => {
    const [name, ...rest] = line.split(" :: ");
    return { name: name.trim(), description: rest.join(" :: ").trim() };
  });
}
