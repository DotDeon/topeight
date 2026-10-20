import { ConvexError } from "convex/values";
import { containsLink, tokenizeComment } from "../../lib/validation";
import type { Doc } from "../_generated/dataModel";

export const MAX_COMMENT = 2000;
export const MAX_BULLETIN = 5000;
export const MAX_SUBJECT = 100;
export const MAX_MESSAGE = 5000;
export const MAX_BLOG_TITLE = 100;
export const MAX_BLOG_BODY = 20000;
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;

/** The trimmed body, or throws "<Label> can't be empty" / "<Label> is too long". */
export function checkBody(raw: string, label: "Comment" | "Bulletin" | "Subject" | "Message" | "Title" | "Post" | "Venue" | "City", max: number): string {
  const body = raw.trim();
  if (body === "") throw new ConvexError(`${label} can't be empty`);
  if (body.length > max) throw new ConvexError(`${label} is too long`);
  return body;
}

/** Accounts under 24 hours old cannot post links. An image URL counts as a link. */
export function checkLinks(author: Pick<Doc<"profiles">, "_creationTime">, body: string): void {
  if (Date.now() - author._creationTime >= NEW_ACCOUNT_MS) return;
  const hasLink = containsLink(body) || tokenizeComment(body).some((t) => t.type !== "text");
  if (hasLink) throw new ConvexError("New accounts can't post links yet");
}
