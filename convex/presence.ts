import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireProfile } from "./lib/access";
import { rateLimiter } from "./lib/limits";

/**
 * Marks the caller as seen now. Writes only the presence row, never the profile
 * doc. Does nothing (and removes any row) when the member turned Online Now! off.
 * Limited to 2 a minute; extra beats are ignored without an error.
 */
export const heartbeat = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const me = await requireProfile(ctx);
    const row = await ctx.db
      .query("presence")
      .withIndex("by_profile", (q) => q.eq("profileId", me._id))
      .unique();
    if (me.showOnline === false) {
      if (row !== null) await ctx.db.delete(row._id);
      return null;
    }
    const { ok } = await rateLimiter.limit(ctx, "heartbeat", { key: me._id });
    if (!ok) return null;
    if (row === null) await ctx.db.insert("presence", { profileId: me._id, lastSeenAt: Date.now() });
    else await ctx.db.patch(row._id, { lastSeenAt: Date.now() });
    return null;
  },
});

/** Turns Online Now! on or off. Turning it off deletes the presence row. 30 an hour. */
export const setShowOnline = mutation({
  args: { value: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { value }) => {
    const me = await requireProfile(ctx);
    const { ok } = await rateLimiter.limit(ctx, "showOnline", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.patch(me._id, { showOnline: value });
    if (!value) {
      const row = await ctx.db
        .query("presence")
        .withIndex("by_profile", (q) => q.eq("profileId", me._id))
        .unique();
      if (row !== null) await ctx.db.delete(row._id);
    }
    return null;
  },
});
