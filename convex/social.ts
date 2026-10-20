import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { areFriends, isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { friendIds, friendshipPair } from "./lib/friendships";
import { MAX_FRIENDS, rateLimiter } from "./lib/limits";

const TOP8_MAX = 8;

async function loadOther(ctx: MutationCtx, id: Id<"profiles">): Promise<Doc<"profiles">> {
  const other = await ctx.db.get(id);
  if (other === null) throw new ConvexError("Profile not found");
  return other;
}

async function addFriendship(ctx: MutationCtx, x: Id<"profiles">, y: Id<"profiles">) {
  if (await areFriends(ctx, x, y)) return;
  await ctx.db.insert("friendships", friendshipPair(x, y));
}

const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUEST_ROWS = 50;

/** The pending request from `from` to `to`, if any. */
async function pendingFrom(ctx: MutationCtx, from: Id<"profiles">, to: Id<"profiles">) {
  return await ctx.db
    .query("friendRequests")
    .withIndex("by_pair_status", (q) => q.eq("from", from).eq("to", to).eq("status", "pending"))
    .first();
}

async function dropFromTop8(ctx: MutationCtx, owner: Doc<"profiles">, removed: Id<"profiles">) {
  if (owner.top8.includes(removed)) {
    await ctx.db.patch(owner._id, { top8: owner.top8.filter((id) => id !== removed) });
  }
}

async function removeFriendship(ctx: MutationCtx, me: Doc<"profiles">, other: Doc<"profiles">) {
  const pair = friendshipPair(me._id, other._id);
  const rows = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("a", pair.a).eq("b", pair.b))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  await dropFromTop8(ctx, me, other._id);
  await dropFromTop8(ctx, other, me._id);
}

/** Looks a profile id up from a username, for the trusted strip. Null when unknown or banned. */
export const profileIdByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<Id<"profiles"> | null> => {
    const checked = validateUsername(username);
    if (!checked.ok) return null;
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    return p === null || p.banned ? null : p._id;
  },
});

export const sendFriendRequest = mutation({
  args: { to: v.id("profiles") },
  returns: v.union(v.literal("sent"), v.literal("accepted")),
  handler: async (ctx, { to }): Promise<"sent" | "accepted"> => {
    const me = await requireProfile(ctx);
    if (to === me._id) throw new ConvexError("Not allowed");
    const other = await loadOther(ctx, to);
    if (other.banned) throw new ConvexError("Profile not found");
    if (await isBlockedEitherWay(ctx, me._id, to)) throw new ConvexError("Not allowed");
    if (await areFriends(ctx, me._id, to)) throw new ConvexError("Already friends");

    if ((await pendingFrom(ctx, me._id, to)) !== null) throw new ConvexError("Request already sent");

    // A declined sender waits 7 days before asking the same person again.
    const declined = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair_status", (q) => q.eq("from", me._id).eq("to", to).eq("status", "declined"))
      .first();
    if (declined !== null) {
      if (Date.now() - (declined.respondedAt ?? 0) < DECLINE_COOLDOWN_MS) {
        throw new ConvexError("Request already sent");
      }
      await ctx.db.delete(declined._id);
    }

    const { ok } = await rateLimiter.limit(ctx, "friendRequest", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");

    const theirs = await pendingFrom(ctx, to, me._id);
    if (theirs !== null) {
      await ctx.db.delete(theirs._id);
      await addFriendship(ctx, me._id, to);
      return "accepted";
    }
    await ctx.db.insert("friendRequests", { from: me._id, to, status: "pending" });
    return "sent";
  },
});

export const respondFriendRequest = mutation({
  args: { requestId: v.id("friendRequests"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { requestId, accept }) => {
    const me = await requireProfile(ctx);
    const req = await ctx.db.get(requestId);
    if (req === null || req.to !== me._id) throw new ConvexError("Not allowed");
    if (req.status !== "pending") return null;
    if (!accept) {
      await ctx.db.patch(requestId, { status: "declined", respondedAt: Date.now() });
      return null;
    }
    const sender = await ctx.db.get(req.from);
    if (sender === null || sender.banned) throw new ConvexError("Profile not found");
    if (await isBlockedEitherWay(ctx, me._id, req.from)) throw new ConvexError("Not allowed");
    await addFriendship(ctx, me._id, req.from);
    await ctx.db.delete(requestId);
    return null;
  },
});

export const removeFriend = mutation({
  args: { other: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { other }) => {
    const me = await requireProfile(ctx);
    if (other === me._id) throw new ConvexError("Not allowed");
    const them = await loadOther(ctx, other);
    if (them.isHouse) throw new ConvexError("Not allowed");
    await removeFriendship(ctx, me, them);
    return null;
  },
});

export const setTop8 = mutation({
  args: { ids: v.array(v.id("profiles")) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    const me = await requireProfile(ctx);
    if (ids.length > TOP8_MAX) throw new ConvexError("Top 8 holds at most 8");
    if (new Set(ids).size !== ids.length) throw new ConvexError("Top 8 can only include friends");
    for (const id of ids) {
      if (!(await areFriends(ctx, me._id, id))) {
        throw new ConvexError("Top 8 can only include friends");
      }
    }
    await ctx.db.patch(me._id, { top8: ids });
    return null;
  },
});

export const block = mutation({
  args: { other: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { other }) => {
    const me = await requireProfile(ctx);
    if (other === me._id) throw new ConvexError("Not allowed");
    const them = await loadOther(ctx, other);
    if (them.isHouse) throw new ConvexError("Not allowed");

    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) => q.eq("blocker", me._id).eq("blocked", other))
      .first();
    if (existing === null) await ctx.db.insert("blocks", { blocker: me._id, blocked: other });

    await removeFriendship(ctx, me, them);
    for (const [from, to] of [
      [me._id, other],
      [other, me._id],
    ] as const) {
      const rows = await ctx.db
        .query("friendRequests")
        .withIndex("by_pair", (q) => q.eq("from", from).eq("to", to))
        .take(MAX_REQUEST_ROWS);
      for (const r of rows) await ctx.db.delete(r._id);
    }
    return null;
  },
});

export const unblock = mutation({
  args: { other: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { other }) => {
    const me = await requireProfile(ctx);
    const rows = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) => q.eq("blocker", me._id).eq("blocked", other))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});

/** A profile's friends as cards, at most 1000, banned profiles left out. Null for an unknown username. */
export const listFriends = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<{ friends: PublicCard[]; total: number } | null> => {
    const checked = validateUsername(username);
    if (!checked.ok) return null;
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (p === null || p.banned) return null;
    const ids = (await friendIds(ctx, p._id)).slice(0, MAX_FRIENDS);
    const friends: PublicCard[] = [];
    for (const id of ids) {
      const f = await ctx.db.get(id);
      if (f !== null && !f.banned) friends.push(toPublicCard(f));
    }
    friends.sort((x, y) => x.displayName.localeCompare(y.displayName));
    return { friends, total: friends.length };
  },
});

/** The caller's friends with their profile ids, for the Top 8 picker. At most 1000, banned left out. */
export const myFriendsForTop8 = query({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"profiles">; card: PublicCard; isHouse: boolean }>> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const me = await profileForUser(ctx, userId);
    if (me === null) return [];
    const rows: Array<{ id: Id<"profiles">; card: PublicCard; isHouse: boolean }> = [];
    for (const id of (await friendIds(ctx, me._id)).slice(0, MAX_FRIENDS)) {
      const f = await ctx.db.get(id);
      if (f !== null && !f.banned) rows.push({ id, card: toPublicCard(f), isHouse: f.isHouse });
    }
    rows.sort((x, y) => x.card.displayName.localeCompare(y.card.displayName));
    return rows;
  },
});

/** The caller's blocks as cards with profile ids, at most 1000, banned profiles left out. */
export const myBlocked = query({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"profiles">; card: PublicCard }>> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const me = await profileForUser(ctx, userId);
    if (me === null) return [];
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blocker", me._id))
      .take(MAX_FRIENDS);
    const rows: Array<{ id: Id<"profiles">; card: PublicCard }> = [];
    for (const b of blocks) {
      const p = await ctx.db.get(b.blocked);
      if (p !== null && !p.banned) rows.push({ id: p._id, card: toPublicCard(p) });
    }
    rows.sort((x, y) => x.card.displayName.localeCompare(y.card.displayName));
    return rows;
  },
});

export type Relationship = {
  signedIn: boolean;
  self: boolean;
  friends: boolean;
  pendingOut: boolean;
  blocked: boolean;
};

/**
 * How the viewer stands with a profile, for the trusted strip. Never throws.
 * Null for an unknown or banned profile. A signed-in viewer without a usable
 * profile gets signedIn with everything else false.
 */
export const relationship = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<Relationship | null> => {
    const checked = validateUsername(username);
    if (!checked.ok) return null;
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (target === null || target.banned) return null;

    const off = { self: false, friends: false, pendingOut: false, blocked: false };
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { signedIn: false, ...off };
    const user = await ctx.db.get(userId);
    const me = user === null ? null : await profileForUser(ctx, userId);
    if (user === null || user.emailVerificationTime === undefined || me === null || me.banned) {
      return { signedIn: true, ...off };
    }
    if (me._id === target._id) return { signedIn: true, ...off, self: true };
    const [friends, pending, blocked] = await Promise.all([
      areFriends(ctx, me._id, target._id),
      ctx.db
        .query("friendRequests")
        .withIndex("by_pair_status", (q) => q.eq("from", me._id).eq("to", target._id).eq("status", "pending"))
        .first(),
      ctx.db
        .query("blocks")
        .withIndex("by_pair", (q) => q.eq("blocker", me._id).eq("blocked", target._id))
        .first(),
    ]);
    return { signedIn: true, self: false, friends, pendingOut: pending !== null, blocked: blocked !== null };
  },
});

/** True for the house profile, which cannot be removed as a friend. False for anything else, including unknown names. */
export const isHouseProfile = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<boolean> => {
    const checked = validateUsername(username);
    if (!checked.ok) return false;
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    return p !== null && !p.banned && p.isHouse;
  },
});
