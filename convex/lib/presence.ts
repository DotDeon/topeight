import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** A member counts as online for this long after their last heartbeat. */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * True when the member shares presence (showOnline is not false) and their last
 * heartbeat is within 5 minutes. One index read.
 */
export async function isOnline(
  ctx: Pick<QueryCtx, "db">,
  profile: Pick<Doc<"profiles">, "_id" | "showOnline">,
  now: number,
): Promise<boolean> {
  if (profile.showOnline === false) return false;
  const row = await ctx.db
    .query("presence")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .unique();
  return row !== null && now - row.lastSeenAt < ONLINE_WINDOW_MS;
}

/** How far a caller's `asOf` may sit from the server clock before it is ignored. */
export const AS_OF_SLACK_MS = 2 * 60 * 1000;

/**
 * The time to judge "online" against. Callers pass `asOf`, the current minute,
 * so the query's cache key moves every minute and a cached `online: true` can't
 * outlive the window: nothing is written when someone goes offline, so without
 * it a cached result would only refresh when something else it reads changes.
 * An `asOf` more than 2 minutes from the server clock is ignored, so a caller
 * can't pick an arbitrary time.
 */
export function onlineAsOf(asOf: number | undefined, now: number = Date.now()): number {
  return asOf !== undefined && Math.abs(asOf - now) <= AS_OF_SLACK_MS ? asOf : now;
}
