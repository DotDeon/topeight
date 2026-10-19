import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { areFriends, isBlockedEitherWay, requireProfile } from "./lib/access";
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

/** Pending requests between two profiles, in both directions. */
async function pendingBetween(ctx: MutationCtx, x: Id<"profiles">, y: Id<"profiles">) {
  const [xy, yx] = await Promise.all([
    ctx.db.query("friendRequests").withIndex("by_pair", (q) => q.eq("from", x).eq("to", y)).collect(),
    ctx.db.query("friendRequests").withIndex("by_pair", (q) => q.eq("from", y).eq("to", x)).collect(),
  ]);
  return [...xy, ...yx].filter((r) => r.status === "pending");
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

    const pending = await pendingBetween(ctx, me._id, to);
    if (pending.some((r) => r.from === me._id)) throw new ConvexError("Request already sent");

    const { ok } = await rateLimiter.limit(ctx, "friendRequest", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");

    const theirs = pending.find((r) => r.from === to);
    if (theirs) {
      await ctx.db.patch(theirs._id, { status: "accepted" });
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
    if (accept) {
      if (await isBlockedEitherWay(ctx, me._id, req.from)) throw new ConvexError("Not allowed");
      await addFriendship(ctx, me._id, req.from);
    }
    await ctx.db.patch(requestId, { status: accept ? "accepted" : "declined" });
    return null;
  },
});

export const removeFriend = mutation({
  args: { other: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { other }) => {
    const me = await requireProfile(ctx);
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
    for (const r of await pendingBetween(ctx, me._id, other)) await ctx.db.delete(r._id);
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
