export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "edit",
  "login",
  "signup",
  "reset",
  "browse",
  "search",
  "bulletins",
  "api",
  "about",
  "faq",
  "terms",
  "privacy",
  "safety",
  "usercontent",
  "coming-soon",
  "static",
  "public",
  "convex",
  "home",
  "friends",
  "comments",
  "settings",
  "support",
  "help",
  "root",
  "system",
  "moderator",
  "openspace",
  "www",
  "_next",
  "favicon",
  "robots",
  "sitemap",
]);

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(
  raw: string,
): { ok: true; username: string } | { ok: false; reason: string } {
  const username = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      reason: "Usernames are 3 to 20 characters: letters, numbers and underscores.",
    };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return { ok: false, reason: "That username is reserved." };
  }
  return { ok: true, username };
}

/** True if value is a real YYYY-MM-DD calendar date. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Whole years between birthDate (YYYY-MM-DD) and today, using UTC. */
export function ageOn(birthDate: string, today: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  if (month < m || (month === m && day < d)) age -= 1;
  return age;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const WWW_PATTERN = /(^|[^\w./@-])www\.[a-z0-9-]+(\.[a-z0-9-]+)+/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?[^\s]*)?$/i;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function containsLink(text: string): boolean {
  return /https?:\/\/[^\s<>"']+/i.test(text) || WWW_PATTERN.test(text);
}

export type CommentToken =
  | { type: "text"; value: string }
  | { type: "image"; url: string }
  | { type: "link"; url: string };

export function tokenizeComment(text: string): CommentToken[] {
  const tokens: CommentToken[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === "text") prev.value += value;
    else tokens.push({ type: "text", value });
  };
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0];
    push(text.slice(last, start));
    if (!isHttpUrl(url)) push(url);
    else if (IMAGE_EXT.test(new URL(url).pathname)) tokens.push({ type: "image", url });
    else tokens.push({ type: "link", url });
    last = start + url.length;
  }
  push(text.slice(last));
  return tokens;
}
