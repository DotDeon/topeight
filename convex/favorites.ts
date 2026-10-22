import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import { mutation, query } from "./_generated/server";
import { profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { profileKind } from "./lib/kinds";

/** Most profiles a member can save. */
export const MAX_FAVORITES = 500;

const cardValidator = v.object({
  username: v.string(),
  displayName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  kind: profileKind,
});

/** Saves a profile. Saving one already saved does nothing and returns "exists". */
export const add = mutation({
  args: { username: v.string() },
  returns: v.union(v.literal("added"), v.literal("exists")),
  handler: async (ctx, { username }): Promise<"added" | "exists"> => {
    const me = await requireProfile(ctx);
    const checked = validateUsername(username);
    if (!checked.ok) throw new ConvexError("Profile not found");
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (target === null || target.banned) throw new ConvexError("Profile not found");
    if (target._id === me._id) throw new ConvexError("Not allowed");
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_pair", (q) => q.eq("ownerId", me._id).eq("profileId", target._id))
      .first();
    if (existing !== null) return "exists";
    const mine = await ctx.db
      .query("favorites")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .take(MAX_FAVORITES);
    if (mine.length >= MAX_FAVORITES) throw new ConvexError("Favorites are full");
    await ctx.db.insert("favorites", { ownerId: me._id, profileId: target._id });
    return "added";
  },
});

export const remove = mutation({
  args: { profileId: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { profileId }): Promise<null> => {
    const me = await requireProfile(ctx);
    const rows = await ctx.db
      .query("favorites")
      .withIndex("by_pair", (q) => q.eq("ownerId", me._id).eq("profileId", profileId))
      .take(10);
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});

/** The viewer's Favorites, newest first, without banned profiles. Signed out gets an empty list. */
export const list = query({
  args: {},
  returns: v.array(cardValidator),
  handler: async (ctx): Promise<PublicCard[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const me = await profileForUser(ctx, userId);
    if (me === null || me.banned) return [];
    const rows = await ctx.db
      .query("favorites")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(MAX_FAVORITES);
    const out: PublicCard[] = [];
    for (const row of rows) {
      const p = await ctx.db.get(row.profileId);
      if (p !== null && !p.banned) out.push(toPublicCard(p));
    }
    return out;
  },
});

export const isFavorite = query({
  args: { username: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { username }): Promise<boolean> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;
    const me = await profileForUser(ctx, userId);
    if (me === null) return false;
    const checked = validateUsername(username);
    if (!checked.ok) return false;
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (target === null) return false;
    const row = await ctx.db
      .query("favorites")
      .withIndex("by_pair", (q) => q.eq("ownerId", me._id).eq("profileId", target._id))
      .first();
    return row !== null;
  },
});
