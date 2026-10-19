import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { MAX_COMMENT, checkBody, checkLinks } from "./lib/posting";

const PAGE_SIZE = 50;

export const add = mutation({
  args: { profileId: v.id("profiles"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { profileId, body }) => {
    const me = await requireProfile(ctx);
    const text = checkBody(body, "Comment", MAX_COMMENT);
    const owner = await ctx.db.get(profileId);
    if (owner === null || owner.banned) throw new ConvexError("Profile not found");
    if (owner._id !== me._id && (await isBlockedEitherWay(ctx, me._id, owner._id))) {
      throw new ConvexError("Not allowed");
    }
    checkLinks(me, text);
    const { ok } = await rateLimiter.limit(ctx, "comment", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.insert("comments", { profileId, authorId: me._id, body: text, hidden: false });
    return null;
  },
});

/** Hard-deletes a comment. The profile owner or the comment's author may do it. */
export const remove = mutation({
  args: { commentId: v.id("comments") },
  returns: v.null(),
  handler: async (ctx, { commentId }) => {
    const me = await requireProfile(ctx);
    const comment = await ctx.db.get(commentId);
    if (comment === null) return null;
    if (comment.profileId !== me._id && comment.authorId !== me._id) throw new ConvexError("Not allowed");
    await ctx.db.delete(commentId);
    return null;
  },
});

export type CommentView = {
  id: Id<"comments">;
  author: PublicCard;
  body: string;
  createdAt: number;
  canDelete: boolean;
};

async function viewerProfile(ctx: QueryCtx): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const p = await profileForUser(ctx, userId);
  return p === null || p.banned ? null : p;
}

/**
 * One page (50) of a profile's comments, newest first. Hidden comments, banned
 * authors and authors the owner blocked are dropped after paging, so a page can
 * come back short.
 */
export const list = query({
  args: { username: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { username, cursor }) => {
    const empty = { page: [] as CommentView[], isDone: true, continueCursor: "" };
    const checked = validateUsername(username);
    if (!checked.ok) return empty;
    const owner = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (owner === null || owner.banned) return empty;
    const viewer = await viewerProfile(ctx);

    const result = await ctx.db
      .query("comments")
      .withIndex("by_profile", (q) => q.eq("profileId", owner._id))
      .order("desc")
      .paginate({ numItems: PAGE_SIZE, cursor });

    const authors = new Map<Id<"profiles">, Doc<"profiles"> | null>();
    const page: CommentView[] = [];
    for (const row of result.page) {
      if (row.hidden) continue;
      if (!authors.has(row.authorId)) {
        const author = await ctx.db.get(row.authorId);
        const blocked =
          author !== null &&
          (await ctx.db
            .query("blocks")
            .withIndex("by_pair", (q) => q.eq("blocker", owner._id).eq("blocked", row.authorId))
            .first()) !== null;
        authors.set(row.authorId, author === null || author.banned || blocked ? null : author);
      }
      const author = authors.get(row.authorId);
      if (!author) continue;
      page.push({
        id: row._id,
        author: toPublicCard(author),
        body: row.body,
        createdAt: row._creationTime,
        canDelete: viewer !== null && (viewer._id === owner._id || viewer._id === row.authorId),
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
