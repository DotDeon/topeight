/** Most invites one member sends in any 24 hours. */
export const INVITES_PER_DAY = 20;
/** Days before anyone can invite the same address again, and before an invite link stops working. */
export const INVITE_COOLDOWN_DAYS = 30;
export const MAX_INVITE_MESSAGE = 500;

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const MAX_EMAIL = 254;

/**
 * Splits the To box on commas, semicolons and whitespace. Returns each address
 * once, lowercased, in the order typed, with the ones that don't look like email.
 */
export function parseEmails(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (email === "" || seen.has(email)) continue;
    seen.add(email);
    if (email.length <= MAX_EMAIL && EMAIL_PATTERN.test(email)) valid.push(email);
    else invalid.push(email);
  }
  return { valid, invalid };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type InviteEmailInput = {
  inviterName: string;
  photoUrl: string | null;
  message?: string;
  joinUrl: string;
  stopUrl: string;
};

/** The subject, plain text and HTML of an invite email. */
export function inviteEmail(input: InviteEmailInput): { subject: string; text: string; html: string } {
  const name = input.inviterName.replace(/\s+/g, " ").trim();
  const subject = `${name} has invited you to TopEight`;
  const text = [
    `${name} has invited you to join TopEight, a place for friends, music and your own profile page.`,
    ...(input.message ? ["", `${name} says:`, input.message] : []),
    "",
    `Join here: ${input.joinUrl}`,
    `When you join from this link, you and ${name} are friends straight away.`,
    "",
    `Don't want invites from TopEight? Stop them here: ${input.stopUrl}`,
  ].join("\n");

  const n = escapeHtml(name);
  const photo = input.photoUrl
    ? `<img src="${escapeHtml(input.photoUrl)}" width="90" alt="" style="display:block;margin:0 0 10px;border:0">`
    : "";
  const message = input.message
    ? `<p style="margin:0 0 4px"><b>${n} says:</b></p><p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(input.message)}</p>`
    : "";
  const html = `<div style="font-family:Verdana,Arial,sans-serif;font-size:13px;color:#000;max-width:500px">
<div style="background:#6698cb;color:#fff;font-weight:bold;padding:6px 8px">TopEight</div>
<div style="border:1px solid #6698cb;padding:12px">
${photo}<p style="margin:0 0 12px"><b>${n}</b> has invited you to join TopEight, a place for friends, music and your own profile page.</p>
${message}<p style="margin:0 0 12px"><a href="${escapeHtml(input.joinUrl)}" style="color:#036;font-weight:bold">Join TopEight</a></p>
<p style="margin:0">When you join from this link, you and ${n} are friends straight away.</p>
</div>
<p style="font-size:11px;color:#666">Don't want invites from TopEight? <a href="${escapeHtml(input.stopUrl)}" style="color:#666">Stop them here</a>.</p>
</div>`;
  return { subject, text, html };
}
