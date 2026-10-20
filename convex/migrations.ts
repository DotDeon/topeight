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

/** True for an R2 permission failure: HTTP 403, AccessDenied or Forbidden. */
function isAccessDenied(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.$metadata?.httpStatusCode === 403 || err.name === "AccessDenied" || err.name === "Forbidden";
}

const counts = v.object({ moved: v.number(), skipped: v.number(), failed: v.number() });

/**
 * Moves tracks uploaded before the private audio bucket existed out of the public
 * bucket. For each track: copy it to R2_AUDIO_BUCKET unless it is already there,
 * then delete the public copy if one exists. 50 tracks per run, then it schedules
 * itself with the continue cursor and the running counts. Safe to run again.
 *
 * A 403 from R2 stops the run with an error: it means the API token cannot reach
 * a bucket, and every later track would fail the same way. Other errors are
 * logged, counted as failed, and the run continues.
 * Run it once right after deploying: npx convex run migrations:moveTracksToAudioBucket
 */
export const moveTracksToAudioBucket = internalAction({
  args: { cursor: v.optional(v.string()), totals: v.optional(counts) },
  returns: v.null(),
  handler: async (ctx, { cursor, totals }) => {
    const page: { keys: string[]; continueCursor: string; isDone: boolean } = await ctx.runQuery(
      internal.migrations.trackKeysPage,
      { cursor },
    );
    const audio = audioBucket();
    const pub = photoBucket();
    const run = { moved: totals?.moved ?? 0, skipped: totals?.skipped ?? 0, failed: totals?.failed ?? 0 };
    const pageCounts = { moved: 0, skipped: 0, failed: 0 };
    for (const key of page.keys) {
      try {
        let didWork = false;
        if ((await storage.head(key, audio)) === null) {
          await storage.copyToAudio(key);
          didWork = true;
        }
        if ((await storage.head(key, pub)) !== null) {
          await storage.removeLegacyPublic(ctx, key);
          didWork = true;
        }
        pageCounts[didWork ? "moved" : "skipped"]++;
      } catch (e) {
        if (isAccessDenied(e)) {
          throw new Error(
            `moveTracksToAudioBucket: access denied on ${key}. Give the R2 API token Object Read & Write on both the photo bucket "${pub}" and the audio bucket "${audio}", then run it again. Stopped after moved=${run.moved + pageCounts.moved}, skipped=${run.skipped + pageCounts.skipped}, failed=${run.failed + pageCounts.failed}.`,
          );
        }
        // A key in neither bucket cannot be copied. Log it and keep going.
        pageCounts.failed++;
        console.warn(`moveTracksToAudioBucket: ${key} failed`, e);
      }
    }
    run.moved += pageCounts.moved;
    run.skipped += pageCounts.skipped;
    run.failed += pageCounts.failed;
    console.log(
      `moveTracksToAudioBucket: page moved=${pageCounts.moved} skipped=${pageCounts.skipped} failed=${pageCounts.failed}; total moved=${run.moved} skipped=${run.skipped} failed=${run.failed}`,
    );
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.moveTracksToAudioBucket, {
        cursor: page.continueCursor,
        totals: run,
      });
    } else {
      console.log(
        `moveTracksToAudioBucket: done. moved=${run.moved} skipped=${run.skipped} failed=${run.failed}`,
      );
    }
    return null;
  },
});
