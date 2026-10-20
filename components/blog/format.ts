/** "Tuesday, 20 October 2026" style date for the header bar of an entry, in UTC. */
export function entryDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** "3 comments", or "100+ comments" when the server stopped counting at 101. */
export function commentLabel(count: number): string {
  if (count > 100) return "100+ comments";
  return count === 1 ? "1 comment" : `${count} comments`;
}
