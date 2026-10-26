import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { INVITES_PER_DAY, MAX_INVITE_MESSAGE, inviteEmail, parseEmails } from "../lib/inviteText";
import { containsLink } from "../lib/validation";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { profileForUser, requireProfile } from "./lib/access";
import { photoUrl } from "./lib/media";
import { INVITE_COOLDOWN_MS, liveInvite, optOutByToken } from "./lib/invites";

const DAY = 24 * 60 * 60 * 1000;
const MAX_HISTORY = 50;

export type InviteResult = { email: string; status: "sent" | "skipped" | "invalid" | "limit" };

function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Invites the member sent in the last 24 hours, at most one past the cap. */
async function sentToday(ctx: QueryCtx | MutationCtx, inviterId: Id<"profiles">): Promise<number> {
  const rows = await ctx.db
    .query("invites")
    .withIndex("by_inviter", (q) => q.eq("inviterId", inviterId).gt("_creationTime", Date.now() - DAY))
    .take(INVITES_PER_DAY + 1);
  return rows.length;
}

/**
 * True when TopEight shouldn't email this address: it belongs to a member, it
 * opted out, or anyone invited it in the last 30 days. The sender only ever
 * sees "skipped", so the page can't be used to find out who has an account.
 */
async function shouldSkip(ctx: MutationCtx, email: string): Promise<boolean> {
  const [member, optedOut, recent] = await Promise.all([
    ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first(),
    ctx.db.query("inviteOptOuts").withIndex("by_email", (q) => q.eq("email", email)).first(),
    ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email).gt("_creationTime", Date.now() - INVITE_COOLDOWN_MS))
      .first(),
  ]);
  return member !== null || optedOut !== null || recent !== null;
}

export const send = mutation({
  args: { emails: v.string(), message: v.optional(v.string()) },
  handler: async (ctx, args): Promise<InviteResult[]> => {
    const me = await requireProfile(ctx);
    const message = (args.message ?? "").trim();
    if (message.length > MAX_INVITE_MESSAGE) throw new ConvexError("Message is too long");
    if (containsLink(message)) throw new ConvexError("Invite messages can't contain links");

    const { valid, invalid } = parseEmails(args.emails);
    if (valid.length === 0 && invalid.length === 0) throw new ConvexError("Enter at least one email address");
    if (valid.length + invalid.length > INVITES_PER_DAY) {
      throw new ConvexError(`You can enter at most ${INVITES_PER_DAY} addresses at a time`);
    }

    let left = INVITES_PER_DAY - (await sentToday(ctx, me._id));
    const results: InviteResult[] = [];
    for (const email of valid) {
      if (await shouldSkip(ctx, email)) {
        results.push({ email, status: "skipped" });
        continue;
      }
      if (left <= 0) {
        results.push({ email, status: "limit" });
        continue;
      }
      left--;
      const inviteId = await ctx.db.insert("invites", {
        inviterId: me._id,
        email,
        token: newToken(),
        ...(message ? { message } : {}),
      });
      await ctx.scheduler.runAfter(0, internal.invites.deliver, { inviteId });
      results.push({ email, status: "sent" });
    }
    for (const email of invalid) results.push({ email, status: "invalid" });
    return results;
  },
});

/** The caller's invites left today and their last 50 invites, newest first. Null when signed out. */
export const mine = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    left: number;
    invites: Array<{ email: string; sentAt: number; joined: { username: string; displayName: string } | null }>;
  } | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const me = await profileForUser(ctx, userId);
    if (me === null || me.banned) return null;
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_inviter", (q) => q.eq("inviterId", me._id))
      .order("desc")
      .take(MAX_HISTORY);
    const invites = [];
    for (const r of rows) {
      const p = r.acceptedBy === undefined ? null : await ctx.db.get(r.acceptedBy);
      invites.push({
        email: r.email,
        sentAt: r._creationTime,
        joined: p === null || p.banned ? null : { username: p.username, displayName: p.displayName },
      });
    }
    return { left: Math.max(0, INVITES_PER_DAY - (await sentToday(ctx, me._id))), invites };
  },
});

/** Who sent a join link, for the sign-up page. Null once the link is used, expired or the inviter is banned. */
export const preview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ displayName: string; photoUrl: string | null } | null> => {
    const live = await liveInvite(ctx, token);
    if (live === null) return null;
    return { displayName: live.inviter.displayName, photoUrl: photoUrl(live.inviter.photoKey) };
  },
});

/** The "stop invites" page. Always returns null, so a guessed token tells nobody anything. */
export const optOut = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }) => {
    await optOutByToken(ctx, token);
    return null;
  },
});

export const optOutInternal = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }) => {
    await optOutByToken(ctx, token);
    return null;
  },
});

/** One-click unsubscribe (RFC 8058). Mail clients POST here from the List-Unsubscribe header. */
export const oneClickOptOut = httpAction(async (ctx, req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  await ctx.runMutation(internal.invites.optOutInternal, { token });
  return new Response(null, { status: 200 });
});

async function forDeliveryHandler(ctx: QueryCtx, { inviteId }: { inviteId: Id<"invites"> }) {
  const invite = await ctx.db.get(inviteId);
  if (invite === null) return null;
  const inviter = await ctx.db.get(invite.inviterId);
  if (inviter === null || inviter.banned) return null;
  // The address may have opted out after the invite was queued.
  const optedOut = await ctx.db
    .query("inviteOptOuts")
    .withIndex("by_email", (q) => q.eq("email", invite.email))
    .first();
  if (optedOut !== null) return null;
  return {
    email: invite.email,
    token: invite.token,
    message: invite.message,
    inviterName: inviter.displayName,
    photoUrl: photoUrl(inviter.photoKey),
  };
}

export const forDelivery = internalQuery({
  args: { inviteId: v.id("invites") },
  handler: forDeliveryHandler,
});

/** Removes an invite whose email never went out, so it doesn't use up a daily slot or the 30-day wait. */
export const dropUnsent = internalMutation({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
    if (invite !== null && invite.acceptedBy === undefined) await ctx.db.delete(inviteId);
    return null;
  },
});

/** Thrown when the email certainly didn't go out: bad settings or Resend said no. */
class NotSent extends Error {}

/**
 * Sends one invite through Resend. Throws NotSent when the email certainly
 * didn't go out. A network error throws something else, because Resend may
 * have sent it anyway.
 */
async function sendInvite(data: NonNullable<Awaited<ReturnType<typeof forDeliveryHandler>>>, apiKey: string) {
  const from = process.env.AUTH_EMAIL_FROM;
  if (!from) throw new NotSent("AUTH_EMAIL_FROM must be set when AUTH_RESEND_KEY is set");
  const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
  if (!site) throw new NotSent("SITE_URL must be set when AUTH_RESEND_KEY is set");
  const token = encodeURIComponent(data.token);
  const { subject, text, html } = inviteEmail({
    ...data,
    joinUrl: `${site}/signup?invite=${token}`,
    stopUrl: `${site}/invite/stop?t=${token}`,
  });
  const oneClick = `${process.env.CONVEX_SITE_URL}/invites/unsubscribe?t=${token}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // A retry of the same invite never sends a second email.
      "Idempotency-Key": `invite-${data.token}`,
    },
    body: JSON.stringify({
      from,
      to: [data.email],
      subject,
      text,
      html,
      headers: {
        "List-Unsubscribe": `<${oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!res.ok) throw new NotSent(`Could not send invite (${res.status}): ${await res.text()}`);
}

export const deliver = internalAction({
  args: { inviteId: v.id("invites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const data = await ctx.runQuery(internal.invites.forDelivery, { inviteId });
    if (data === null) return null;
    const apiKey = process.env.AUTH_RESEND_KEY;
    if (!apiKey) {
      // Local development without email: read the link from the Convex logs.
      const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "");
      console.log(`[TopEight] Invite for ${data.email}: ${site}/signup?invite=${encodeURIComponent(data.token)}`);
      return null;
    }
    try {
      await sendInvite(data, apiKey);
    } catch (err) {
      if (err instanceof NotSent) await ctx.runMutation(internal.invites.dropUnsent, { inviteId });
      throw err;
    }
    return null;
  },
});
