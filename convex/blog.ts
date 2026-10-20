import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v, type Infer } from "convex/values";
import { validateUsername } from "../lib/validation";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { recentFriendIds } from "./lib/friendships";
import { rateLimiter } from "./lib/limits";
import { moodIcon } from "./lib/moods";
import { MAX_BLOG_BODY, MAX_BLOG_TITLE, MAX_COMMENT, checkBody, checkLinks } from "./lib/posting";

const POSTS_PER_PAGE = 10;
const COMMENTS_PER_PAGE = 50;
const MAX_MOOD = 40;
const MAX_LISTENING = 100;
/** Comments counted per post. The UI shows more than this as "100+". */
export const MAX_COMMENT_COUNT = 100;
/** Comments a delete removes per call. The rest go in a scheduled cleanup. */
const DELETE_BATCH = 500;
/** Friendships the feed reads, newest first. */
const FEED_FRIENDS = 300;
/** Posts the feed reads per friend. */
const FEED_PER_FRIEND = 3;
const FEED_SIZE = 30;

type Ctx = QueryCtx | MutationCtx;

const moodArg = v.object({ text: v.string(), icon: moodIcon });
type Mood = Infer<typeof moodArg>;

const cardValidator = v.object({
  username: v.string(),
  displayName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  kind: v.union(v.literal("fan"), v.literal("artist")),
});
const postView = v.object({
  id: v.id("blogPosts"),
  author: cardValidator,
  title: v.string(),
  body: v.string(),
  mood: v.optional(moodArg),
  listening: v.optional(v.string()),
  createdAt: v.number(),
  commentCount: v.number(),
  canEdit: v.boolean(),
});
const feedItem = v.object({
  id: v.id("blogPosts"),
  author: cardValidator,
  title: v.string(),
  createdAt: v.number(),
  mood: v.optional(moodArg),
});
const commentView = v.object({
  id: v.id("blogComments"),
  author: cardValidator,
  body: v.string(),
  createdAt: v.number(),
  canDelete: v.boolean(),
});
const pageOf = <T extends typeof postView | typeof commentView>(item: T) =>
  v.object({ page: v.array(item), isDone: v.boolean(), continueCursor: v.string() });

export type BlogPostView = {
  id: Id<"blogPosts">;
  author: PublicCard;
  title: string;
  /** Plain text. The client renders it. */
  body: string;
  mood?: Mood;
  listening?: string;
  createdAt: number;
  /** Visible comments, counted up to MAX_COMMENT_COUNT + 1. */
  commentCount: number;
  canEdit: boolean;
};

export type FeedItem = {
  id: Id<"blogPosts">;
  author: PublicCard;
  title: string;
  createdAt: number;
  mood?: Mood;
};

export type BlogCommentView = {
  id: Id<"blogComments">;
  author: PublicCard;
  body: string;
  createdAt: number;
  canDelete: boolean;
};

/** The signed-in, unbanned viewer, or null. */
async function viewerProfile(ctx: Ctx): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const p = await profileForUser(ctx, userId);
  return p === null || p.banned ? null : p;
}

/** The post and its author when the post is visible: not hidden, author not banned. */
async function visiblePost(
  ctx: Ctx,
  id: Id<"blogPosts">,
): Promise<{ post: Doc<"blogPosts">; author: Doc<"profiles"> } | null> {
  const post = await ctx.db.get(id);
  if (post === null || post.hidden) return null;
  const author = await ctx.db.get(post.authorId);
  if (author === null || author.banned) return null;
  return { post, author };
}

/** Checked, trimmed post fields. Blank listening is dropped. Throws on any limit or the link rule. */
function checkPost(
  me: Doc<"profiles">,
  args: { title: string; body: string; mood?: Mood; listening?: string },
): { title: string; body: string; mood?: Mood; listening?: string } {
  const title = checkBody(args.title, "Title", MAX_BLOG_TITLE);
  const body = checkBody(args.body, "Post", MAX_BLOG_BODY);
  let mood: Mood | undefined;
  if (args.mood !== undefined) {
    const text = args.mood.text.trim();
    if (text.length > MAX_MOOD) throw new ConvexError("Mood is too long");
    mood = { text, icon: args.mood.icon };
  }
  const listening = args.listening?.trim() || undefined;
  if (listening !== undefined && listening.length > MAX_LISTENING) throw new ConvexError("Listening is too long");
  checkLinks(me, [title, body, mood?.text ?? "", listening ?? ""].join("\n"));
  return { title, body, mood, listening };
}

async function commentCount(ctx: Ctx, postId: Id<"blogPosts">): Promise<number> {
  const rows = await ctx.db
    .query("blogComments")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .take(MAX_COMMENT_COUNT + 1);
  return rows.filter((c) => !c.hidden).length;
}

async function toView(
  ctx: Ctx,
  post: Doc<"blogPosts">,
  author: Doc<"profiles">,
  viewer: Doc<"profiles"> | null,
): Promise<BlogPostView> {
  return {
    id: post._id,
    author: toPublicCard(author),
    title: post.title,
    body: post.body,
    ...(post.mood ? { mood: post.mood } : {}),
    ...(post.listening ? { listening: post.listening } : {}),
    createdAt: post._creationTime,
    commentCount: await commentCount(ctx, post._id),
    canEdit: viewer !== null && viewer._id === post.authorId,
  };
}

/** The visible post if `me` wrote it. Hidden posts are "Not found" to their author too. */
async function ownPost(ctx: MutationCtx, me: Doc<"profiles">, id: Id<"blogPosts">): Promise<Doc<"blogPosts">> {
  const post = await ctx.db.get(id);
  if (post === null || post.hidden) throw new ConvexError("Not found");
  if (post.authorId !== me._id) throw new ConvexError("Not allowed");
  return post;
}

/** Deletes up to DELETE_BATCH of a post's comments, and schedules the next batch when more remain. */
async function deleteComments(ctx: MutationCtx, postId: Id<"blogPosts">): Promise<void> {
  const rows = await ctx.db
    .query("blogComments")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .take(DELETE_BATCH);
  for (const c of rows) await ctx.db.delete(c._id);
  if (rows.length === DELETE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.blog.cleanupComments, { postId });
  }
}

const postArgs = {
  title: v.string(),
  body: v.string(),
  mood: v.optional(moodArg),
  listening: v.optional(v.string()),
};

/** Writes a post. Ten a day; refused posts cost no quota. */
export const create = mutation({
  args: postArgs,
  returns: v.id("blogPosts"),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const fields = checkPost(me, args);
    const { ok } = await rateLimiter.limit(ctx, "blogPost", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    return await ctx.db.insert("blogPosts", { authorId: me._id, ...fields, hidden: false });
  },
});

/** Replaces a post's fields. A mood or listening left out is removed. Author only. */
export const update = mutation({
  args: { id: v.id("blogPosts"), ...postArgs },
  returns: v.null(),
  handler: async (ctx, { id, ...args }) => {
    const me = await requireProfile(ctx);
    await ownPost(ctx, me, id);
    const fields = checkPost(me, args);
    await ctx.db.patch(id, { mood: undefined, listening: undefined, ...fields });
    return null;
  },
});

/** Hard-deletes a post and its comments. Author only. */
export const remove = mutation({
  args: { id: v.id("blogPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const me = await requireProfile(ctx);
    await ownPost(ctx, me, id);
    await ctx.db.delete(id);
    await deleteComments(ctx, id);
    return null;
  },
});

/** Finishes deleting the comments of a deleted post, one batch per run. */
export const cleanupComments = internalMutation({
  args: { postId: v.id("blogPosts") },
  returns: v.null(),
  handler: async (ctx, { postId }) => {
    await deleteComments(ctx, postId);
    return null;
  },
});

/** One page (10) of a member's posts, newest first. Hidden posts are dropped after paging. */
export const listByUser = query({
  args: { username: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(postView),
  handler: async (ctx, { username, cursor }) => {
    const empty = { page: [] as BlogPostView[], isDone: true, continueCursor: "" };
    const checked = validateUsername(username);
    if (!checked.ok) return empty;
    const author = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (author === null || author.banned) return empty;
    const viewer = await viewerProfile(ctx);
    const result = await ctx.db
      .query("blogPosts")
      .withIndex("by_author", (q) => q.eq("authorId", author._id))
      .order("desc")
      .paginate({ numItems: POSTS_PER_PAGE, cursor });
    const page: BlogPostView[] = [];
    for (const post of result.page) {
      if (!post.hidden) page.push(await toView(ctx, post, author, viewer));
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** One post, or null when the id is malformed, the post is gone or hidden, or its author is banned. */
export const get = query({
  args: { id: v.string() },
  returns: v.union(postView, v.null()),
  handler: async (ctx, { id }): Promise<BlogPostView | null> => {
    const postId = ctx.db.normalizeId("blogPosts", id);
    if (postId === null) return null;
    const found = await visiblePost(ctx, postId);
    if (found === null) return null;
    return await toView(ctx, found.post, found.author, await viewerProfile(ctx));
  },
});

/**
 * The 30 newest posts from the viewer's 300 most recent friendships, reading
 * at most 3 per friend. Empty when signed out.
 */
export const friendsFeed = query({
  args: {},
  returns: v.array(feedItem),
  handler: async (ctx): Promise<FeedItem[]> => {
    const me = await viewerProfile(ctx);
    if (me === null) return [];
    const items: FeedItem[] = [];
    for (const friendId of await recentFriendIds(ctx, me._id, FEED_FRIENDS)) {
      const friend = await ctx.db.get(friendId);
      if (friend === null || friend.banned) continue;
      const posts = await ctx.db
        .query("blogPosts")
        .withIndex("by_author", (q) => q.eq("authorId", friendId))
        .order("desc")
        .take(FEED_PER_FRIEND);
      const author = toPublicCard(friend);
      for (const p of posts) {
        if (p.hidden) continue;
        items.push({
          id: p._id,
          author,
          title: p.title,
          createdAt: p._creationTime,
          ...(p.mood ? { mood: p.mood } : {}),
        });
      }
    }
    return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, FEED_SIZE);
  },
});

/**
 * Comments on a visible post. A blocked pair (either way) cannot comment.
 * Shares the hourly `comment` limit with profile comments, used only once the
 * comment passes every check.
 */
export const addComment = mutation({
  args: { postId: v.id("blogPosts"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { postId, body }) => {
    const me = await requireProfile(ctx);
    const text = checkBody(body, "Comment", MAX_COMMENT);
    const found = await visiblePost(ctx, postId);
    if (found === null) throw new ConvexError("Not found");
    if (found.author._id !== me._id && (await isBlockedEitherWay(ctx, me._id, found.author._id))) {
      throw new ConvexError("Not allowed");
    }
    checkLinks(me, text);
    const { ok } = await rateLimiter.limit(ctx, "comment", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.insert("blogComments", { postId, authorId: me._id, body: text, hidden: false });
    return null;
  },
});

/** Hard-deletes a comment. Its author or the post's author may do it. */
export const removeComment = mutation({
  args: { id: v.id("blogComments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const me = await requireProfile(ctx);
    const comment = await ctx.db.get(id);
    if (comment === null) return null;
    const post = await ctx.db.get(comment.postId);
    if (comment.authorId !== me._id && post?.authorId !== me._id) throw new ConvexError("Not allowed");
    await ctx.db.delete(id);
    return null;
  },
});

/**
 * One page (50) of a visible post's comments, oldest first. Hidden comments,
 * banned commenters, commenters blocked either way by the post's author, and
 * commenters blocked either way by the viewer are dropped after paging, so a
 * page can come back short.
 */
export const comments = query({
  args: { postId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(commentView),
  handler: async (ctx, { postId, cursor }) => {
    const empty = { page: [] as BlogCommentView[], isDone: true, continueCursor: "" };
    const id = ctx.db.normalizeId("blogPosts", postId);
    if (id === null) return empty;
    const found = await visiblePost(ctx, id);
    if (found === null) return empty;
    const owner = found.author;
    const viewer = await viewerProfile(ctx);

    const result = await ctx.db
      .query("blogComments")
      .withIndex("by_post", (q) => q.eq("postId", id))
      .order("asc")
      .paginate({ numItems: COMMENTS_PER_PAGE, cursor });

    const authors = new Map<Id<"profiles">, Doc<"profiles"> | null>();
    const page: BlogCommentView[] = [];
    for (const row of result.page) {
      if (row.hidden) continue;
      if (!authors.has(row.authorId)) {
        const author = await ctx.db.get(row.authorId);
        let ok = author !== null && !author.banned;
        if (ok && row.authorId !== owner._id) ok = !(await isBlockedEitherWay(ctx, owner._id, row.authorId));
        if (ok && viewer !== null && row.authorId !== viewer._id) {
          ok = !(await isBlockedEitherWay(ctx, viewer._id, row.authorId));
        }
        authors.set(row.authorId, ok ? author : null);
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
