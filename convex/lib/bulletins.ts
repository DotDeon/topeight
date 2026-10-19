import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicCard, type PublicCard } from "./cards";
import { friendIds } from "./friendships";

export const BULLETIN_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export type BulletinView = {
  id: Id<"bulletins">;
  author: PublicCard;
  body: string;
  createdAt: number;
};

/**
 * Bulletins from the profile's friends, last 10 days, newest first.
 * Hidden posts and banned authors are left out.
 */
export async function friendBulletins(
  ctx: QueryCtx | MutationCtx,
  profileId: Id<"profiles">,
  { limit }: { limit: number },
): Promise<BulletinView[]> {
  const cutoff = Date.now() - BULLETIN_WINDOW_MS;
  // Reads one query per friend, in parallel. A fan-out feed table is the long-term fix.
  const perFriend = await Promise.all(
    (await friendIds(ctx, profileId)).map(async (friendId) => {
      const author = await ctx.db.get(friendId);
      if (author === null || author.banned) return [];
      const posts = await ctx.db
        .query("bulletins")
        .withIndex("by_author", (q) => q.eq("authorId", friendId).gte("_creationTime", cutoff))
        .order("desc")
        .filter((q) => q.eq(q.field("hidden"), false))
        .take(limit);
      return posts.map(
        (post): BulletinView => ({
          id: post._id,
          author: toPublicCard(author),
          body: post.body,
          createdAt: post._creationTime,
        }),
      );
    }),
  );
  return perFriend
    .flat()
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, limit);
}
