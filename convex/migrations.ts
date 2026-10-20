import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { syncMediaFlags } from "./lib/media";
import { audioBucket, photoBucket, storage } from "./lib/r2";

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

const TRACK_BATCH = 50;

/** One page of track keys for moveTracksToAudioBucket. */
export const trackKeysPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ keys: v.array(v.string()), continueCursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("tracks").paginate({ numItems: TRACK_BATCH, cursor: cursor ?? null });
    return { keys: page.page.map((t) => t.key), continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Moves tracks uploaded before the private audio bucket existed out of the public
 * bucket. For each track: copy it to R2_AUDIO_BUCKET unless it is already there,
 * then delete the public copy if one exists. 50 tracks per run, then it schedules
 * itself with the continue cursor. Safe to run again.
 * Run it once right after deploying: npx convex run migrations:moveTracksToAudioBucket
 */
export const moveTracksToAudioBucket = internalAction({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page: { keys: string[]; continueCursor: string; isDone: boolean } = await ctx.runQuery(
      internal.migrations.trackKeysPage,
      { cursor },
    );
    const audio = audioBucket();
    const pub = photoBucket();
    for (const key of page.keys) {
      try {
        if ((await storage.head(key, audio)) === null) await storage.copyToAudio(key);
        if ((await storage.head(key, pub)) !== null) await storage.removeLegacyPublic(ctx, key);
      } catch (e) {
        // A key in neither bucket cannot be copied. Log it and keep going.
        console.warn(`moveTracksToAudioBucket: ${key} failed`, e);
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.moveTracksToAudioBucket, {
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
