/** Same limits as convex/lib/posting.ts. */
export const MAX_SUBJECT = 100;
export const MAX_MESSAGE = 5000;

/** The line between a reply and the message it quotes. */
export const QUOTE_RULE = "--------------------";

/** "Re: " in front of a subject, unless it already starts with "Re:" in any case. */
export function replySubject(subject: string): string {
  const next = /^re:/i.test(subject.trimStart()) ? subject : `Re: ${subject}`;
  return next.slice(0, MAX_SUBJECT);
}

/**
 * The original message quoted under a line of dashes, every line starting
 * with "> ". Cut short so the whole reply stays within the message limit.
 */
export function quoteBody(body: string): string {
  const lead = `\n\n${QUOTE_RULE}\n`;
  const quoted = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return (lead + quoted).slice(0, MAX_MESSAGE);
}

/** Inbox count for display: "" for none, "99+" at the server's cap of 100. */
export function unreadBadge(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

/** "2026-10-20 14:05 UTC" */
export function mailDate(t: number): string {
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
