import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { profileForUser, requireProfile } from "./lib/access";
import { BULLETIN_WINDOW_MS, friendBulletins, type BulletinView } from "./lib/bulletins";
import { toPublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { MAX_BULLETIN, checkBody, checkLinks } from "./lib/posting";

const FEED_LIMIT = 50;

export const post = mutation({
  args: { body: v.string() },
  returns: v.null(),
  handler: async (ctx, { body }) => {
    const me = await requireProfile(ctx);
    const text = checkBody(body, "Bulletin", MAX_BULLETIN);
    checkLinks(me, text);
    const { ok } = await rateLimiter.limit(ctx, "bulletin", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.insert("bulletins", { authorId: me._id, body: text, hidden: false });
    return null;
  },
});

export const remove = mutation({
  args: { bulletinId: v.id("bulletins") },
  returns: v.null(),
  handler: async (ctx, { bulletinId }) => {
    const me = await requireProfile(ctx);
    const bulletin = await ctx.db.get(bulletinId);
    if (bulletin === null) return null;
    if (bulletin.authorId !== me._id) throw new ConvexError("Not allowed");
    await ctx.db.delete(bulletinId);
    return null;
  },
});

export type FeedStatus = "ok" | "unverified" | "no-profile" | "suspended";

/**
 * Friends' bulletins plus my own from the last 10 days, newest first, at most 50.
 * A signed-in user who cannot post yet gets an empty feed and a status the page
 * can explain. Signed-out callers are refused.
 */
export const feed = query({
  args: {},
  handler: async (ctx): Promise<{ status: FeedStatus; bulletins: BulletinView[] }> => {
    const userId = await getAuthUserId(ctx);
    const user = userId === null ? null : await ctx.db.get(userId);
    if (user === null) throw new ConvexError("Not signed in");
    if (user.emailVerificationTime === undefined) return { status: "unverified", bulletins: [] };
    const me = await profileForUser(ctx, user._id);
    if (me === null) return { status: "no-profile", bulletins: [] };
    if (me.banned) return { status: "suspended", bulletins: [] };

    const theirs = await friendBulletins(ctx, me._id, { limit: FEED_LIMIT });
    const cutoff = Date.now() - BULLETIN_WINDOW_MS;
    const mine = (
      await ctx.db
        .query("bulletins")
        .withIndex("by_author", (q) => q.eq("authorId", me._id).gte("_creationTime", cutoff))
        .order("desc")
        .filter((q) => q.eq(q.field("hidden"), false))
        .take(FEED_LIMIT)
    ).map((b): BulletinView => ({ id: b._id, author: toPublicCard(me), body: b.body, createdAt: b._creationTime }));
    const bulletins = [...theirs, ...mine].sort((x, y) => y.createdAt - x.createdAt).slice(0, FEED_LIMIT);
    return { status: "ok", bulletins };
  },
});
