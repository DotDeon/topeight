import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** RSVPs a ban or unban adjusts counts for. */
export const MAX_BAN_RSVPS = 500;

export function countField(status: "going" | "maybe"): "goingCount" | "maybeCount" {
  return status === "going" ? "goingCount" : "maybeCount";
}

/**
 * Adds `delta` to the counts of every event a member answered, at most
 * MAX_BAN_RSVPS of them. A ban passes -1 and an unban +1, so banned members
 * drop out of the counts and come back.
 */
export async function adjustRsvpCounts(ctx: MutationCtx, profileId: Id<"profiles">, delta: 1 | -1): Promise<void> {
  const rows = await ctx.db
    .query("rsvps")
    .withIndex("by_pair", (q) => q.eq("profileId", profileId))
    .take(MAX_BAN_RSVPS);
  for (const r of rows) {
    const event = await ctx.db.get(r.eventId);
    if (event === null) continue;
    const field = countField(r.status);
    await ctx.db.patch(event._id, { [field]: Math.max(0, event[field] + delta) });
  }
}
