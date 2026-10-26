import { INVITE_COOLDOWN_DAYS } from "../../lib/inviteText";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { areFriends } from "./access";
import { friendshipPair } from "./friendships";

const DAY = 24 * 60 * 60 * 1000;
export const INVITE_COOLDOWN_MS = INVITE_COOLDOWN_DAYS * DAY;

/** The invite and its inviter while the link still works: unused, under 30 days old, inviter not banned. */
export async function liveInvite(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<{ invite: Doc<"invites">; inviter: Doc<"profiles"> } | null> {
  if (token === "" || token.length > 64) return null;
  const invite = await ctx.db
    .query("invites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (invite === null || invite.acceptedBy !== undefined) return null;
  if (Date.now() - invite._creationTime > INVITE_COOLDOWN_MS) return null;
  const inviter = await ctx.db.get(invite.inviterId);
  if (inviter === null || inviter.banned) return null;
  return { invite, inviter };
}

/**
 * Makes a new member and their inviter friends and uses up the invite.
 * Does nothing for a bad or used token, so a stale link never blocks sign-up.
 */
export async function acceptInvite(ctx: MutationCtx, token: string, profileId: Id<"profiles">): Promise<void> {
  const live = await liveInvite(ctx, token);
  if (live === null || live.inviter._id === profileId) return;
  if (!(await areFriends(ctx, profileId, live.inviter._id))) {
    await ctx.db.insert("friendships", friendshipPair(profileId, live.inviter._id));
  }
  await ctx.db.patch(live.invite._id, { acceptedBy: profileId, acceptedAt: Date.now() });
}

/** Stops all future invites to the address the token was sent to. False for an unknown token. */
export async function optOutByToken(ctx: MutationCtx, token: string): Promise<boolean> {
  if (token === "" || token.length > 64) return false;
  const invite = await ctx.db
    .query("invites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (invite === null) return false;
  const existing = await ctx.db
    .query("inviteOptOuts")
    .withIndex("by_email", (q) => q.eq("email", invite.email))
    .first();
  if (existing === null) await ctx.db.insert("inviteOptOuts", { email: invite.email });
  return true;
}
