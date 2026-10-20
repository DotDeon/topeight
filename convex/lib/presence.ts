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
