import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { syncMediaFlags } from "./lib/media";

const BATCH = 100;

/**
 * Sets hasPhoto and hasTracks on profiles made before those flags existed.
 * Handles 100 profiles per run, then schedules itself with the continue cursor.
 * Safe to run again. Run it once after upgrading: npx convex run migrations:backfillMediaFlags
 */
export const backfillMediaFlags = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("profiles")
      .paginate({ numItems: BATCH, cursor: cursor ?? null });
    for (const p of page.page) await syncMediaFlags(ctx, p._id);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillMediaFlags, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
