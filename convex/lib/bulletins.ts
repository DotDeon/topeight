import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { toPublicCard, type PublicCard } from "./cards";
import { recentFriendIds } from "./friendships";

export const BULLETIN_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
/** Most friends whose bulletins the feed reads: the most recent friendships. */
export const FEED_MAX_FRIENDS = 300;

export type BulletinView = {
  id: Id<"bulletins">;
  author: PublicCard;
  body: string;
  createdAt: number;
};

/**
 * Bulletins from the profile's friends (the FEED_MAX_FRIENDS newest
 * friendships), last 10 days, newest first.
 * Hidden posts and banned authors are left out.
 */
export async function friendBulletins(
  ctx: QueryCtx | MutationCtx,
  profileId: Id<"profiles">,
  { limit }: { limit: number },
): Promise<BulletinView[]> {
  const cutoff = Date.now() - BULLETIN_WINDOW_MS;
  // Reads one query per friend, in parallel, for at most FEED_MAX_FRIENDS of
  // the newest friendships. Older friends' bulletins drop out of the feed.
  // The long-term fix is a fan-out feed: write each bulletin into a per-reader
  // feed table at post time, so reading the feed is one indexed query.
  const perFriend = await Promise.all(
    (await recentFriendIds(ctx, profileId, FEED_MAX_FRIENDS)).map(async (friendId) => {
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
