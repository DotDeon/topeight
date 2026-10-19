import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_FRIENDS } from "./limits";

/** Friendship rows store the two profile ids sorted by id string, a < b. */
export function friendshipPair(
  x: Id<"profiles">,
  y: Id<"profiles">,
): { a: Id<"profiles">; b: Id<"profiles"> } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

/** Ids of the `n` most recently made friendships of `profileId`, newest first. */
export async function recentFriendIds(
  ctx: QueryCtx | MutationCtx,
  profileId: Id<"profiles">,
  n: number,
): Promise<Id<"profiles">[]> {
  // Each index ends in _creationTime, so desc order is newest friendship first.
  const [asA, asB] = await Promise.all([
    ctx.db.query("friendships").withIndex("by_a", (q) => q.eq("a", profileId)).order("desc").take(n),
    ctx.db.query("friendships").withIndex("by_b", (q) => q.eq("b", profileId)).order("desc").take(n),
  ]);
  return [...asA.map((f) => ({ id: f.b, at: f._creationTime })), ...asB.map((f) => ({ id: f.a, at: f._creationTime }))]
    .sort((x, y) => y.at - x.at)
    .slice(0, n)
    .map((f) => f.id);
}

/** Ids of profiles that are friends with `profileId`, at most MAX_FRIENDS per index. */
export async function friendIds(
  ctx: QueryCtx | MutationCtx,
  profileId: Id<"profiles">,
): Promise<Id<"profiles">[]> {
  const [asA, asB] = await Promise.all([
    ctx.db.query("friendships").withIndex("by_a", (q) => q.eq("a", profileId)).take(MAX_FRIENDS),
    ctx.db.query("friendships").withIndex("by_b", (q) => q.eq("b", profileId)).take(MAX_FRIENDS),
  ]);
  return [...asA.map((f) => f.b), ...asB.map((f) => f.a)];
}
