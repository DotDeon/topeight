import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Friendship rows store the two profile ids sorted by id string, a < b. */
export function friendshipPair(
  x: Id<"profiles">,
  y: Id<"profiles">,
): { a: Id<"profiles">; b: Id<"profiles"> } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

/** Ids of every profile that is friends with `profileId`. */
export async function friendIds(
  ctx: QueryCtx | MutationCtx,
  profileId: Id<"profiles">,
): Promise<Id<"profiles">[]> {
  const [asA, asB] = await Promise.all([
    ctx.db.query("friendships").withIndex("by_a", (q) => q.eq("a", profileId)).collect(),
    ctx.db.query("friendships").withIndex("by_b", (q) => q.eq("b", profileId)).collect(),
  ]);
  return [...asA.map((f) => f.b), ...asB.map((f) => f.a)];
}
