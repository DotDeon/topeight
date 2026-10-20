import { ConvexError, v, type Infer } from "convex/values";
import { validateUsername } from "../lib/validation";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { canSeeFull, isBlockedEitherWay, requireProfile, viewerProfile } from "./lib/access";
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
/** Characters of the body kept on the post row for list previews. */
const EXCERPT_LENGTH = 200;
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
const summaryFields = {
  id: v.id("blogPosts"),
  author: cardValidator,
  title: v.string(),
  excerpt: v.string(),
  mood: v.optional(moodArg),
  listening: v.optional(v.string()),
  createdAt: v.number(),
  commentCount: v.number(),
  canEdit: v.boolean(),
};
const summaryView = v.object(summaryFields);
const postView = v.object({ ...summaryFields, body: v.string() });
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
const pageOf = <T extends typeof summaryView | typeof commentView>(item: T) =>
  v.object({ page: v.array(item), isDone: v.boolean(), continueCursor: v.string() });

/** A post without its body, for lists. */
export type BlogPostSummary = {
  id: Id<"blogPosts">;
  author: PublicCard;
  title: string;
  /** The first 200 characters of the body. */
  excerpt: string;
  mood?: Mood;
  listening?: string;
  createdAt: number;
  /** Visible comments. 101 means "over 100", shown as "100+". */
  commentCount: number;
  canEdit: boolean;
};

export type BlogPostView = BlogPostSummary & {
  /** Plain text. The client renders it. */
  body: string;
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

type PostFields = { title: string; body: string; mood?: Mood; listening?: string };

/** Checked, trimmed post fields. Blank listening is dropped. Throws on any limit or the link rule. */
function checkPost(me: Doc<"profiles">, args: PostFields): PostFields {
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

/** The blogPosts columns for checked fields: everything but the body, plus its excerpt. */
function postColumns({ body, ...rest }: PostFields) {
  return { ...rest, excerpt: body.slice(0, EXCERPT_LENGTH) };
}

/**
 * Visible comments on a post: not hidden, commenter not banned. Reads at most
 * MAX_COMMENT_COUNT + 1 rows and returns MAX_COMMENT_COUNT + 1 whenever more
 * than MAX_COMMENT_COUNT exist. `authors` caches who is unbanned across posts.
 */
async function commentCount(ctx: Ctx, postId: Id<"blogPosts">, authors: Map<Id<"profiles">, boolean>): Promise<number> {
  const rows = await ctx.db
    .query("blogComments")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .take(MAX_COMMENT_COUNT + 1);
  if (rows.length > MAX_COMMENT_COUNT) return MAX_COMMENT_COUNT + 1;
  let n = 0;
  for (const c of rows) {
    if (c.hidden) continue;
    if (!authors.has(c.authorId)) {
      const a = await ctx.db.get(c.authorId);
      authors.set(c.authorId, a !== null && !a.banned);
    }
    if (authors.get(c.authorId)) n++;
  }
  return n;
}

async function toSummary(
  ctx: Ctx,
  post: Doc<"blogPosts">,
  author: Doc<"profiles">,
  viewer: Doc<"profiles"> | null,
  authors: Map<Id<"profiles">, boolean>,
): Promise<BlogPostSummary> {
  return {
    id: post._id,
    author: toPublicCard(author),
    title: post.title,
    excerpt: post.excerpt,
    ...(post.mood ? { mood: post.mood } : {}),
    ...(post.listening ? { listening: post.listening } : {}),
    createdAt: post._creationTime,
    commentCount: await commentCount(ctx, post._id, authors),
    canEdit: viewer !== null && viewer._id === post.authorId,
  };
}

async function bodyRow(ctx: Ctx, postId: Id<"blogPosts">) {
  return await ctx.db
    .query("blogBodies")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .first();
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
    const { ok } = await rateLimiter.limit(ctx, "blogCreate", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    const postId = await ctx.db.insert("blogPosts", { authorId: me._id, ...postColumns(fields), hidden: false });
    await ctx.db.insert("blogBodies", { postId, body: fields.body });
    return postId;
  },
});

/** Replaces a post's fields. A mood or listening left out is removed. Author only, 30 an hour. */
export const update = mutation({
  args: { id: v.id("blogPosts"), ...postArgs },
  returns: v.null(),
  handler: async (ctx, { id, ...args }) => {
    const me = await requireProfile(ctx);
    await ownPost(ctx, me, id);
    const fields = checkPost(me, args);
    const { ok } = await rateLimiter.limit(ctx, "blogEdit", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.patch(id, { mood: undefined, listening: undefined, ...postColumns(fields) });
    const row = await bodyRow(ctx, id);
    if (row === null) await ctx.db.insert("blogBodies", { postId: id, body: fields.body });
    else await ctx.db.patch(row._id, { body: fields.body });
    return null;
  },
});

/** Hard-deletes a post, its body and its comments. Author only. */
export const remove = mutation({
  args: { id: v.id("blogPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const me = await requireProfile(ctx);
    await ownPost(ctx, me, id);
    await ctx.db.delete(id);
    const row = await bodyRow(ctx, id);
    if (row !== null) await ctx.db.delete(row._id);
    await deleteComments(ctx, id);
    return null;
  },
});

/** Finishes deleting the comments of a deleted post, one batch per run, and any body row left. */
export const cleanupComments = internalMutation({
  args: { postId: v.id("blogPosts") },
  returns: v.null(),
  handler: async (ctx, { postId }) => {
    const row = await bodyRow(ctx, postId);
    if (row !== null) await ctx.db.delete(row._id);
    await deleteComments(ctx, postId);
    return null;
  },
});

/**
 * One page (10) of a member's posts, newest first, without bodies. Hidden posts are dropped after paging.
 * Comment counts leave out banned commenters, as get does. Empty on a private
 * profile the viewer can't see in full.
 */
export const listByUser = query({
  args: { username: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(summaryView),
  handler: async (ctx, { username, cursor }) => {
    const empty = { page: [] as BlogPostSummary[], isDone: true, continueCursor: "" };
    const checked = validateUsername(username);
    if (!checked.ok) return empty;
    const author = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", checked.username))
      .unique();
    if (author === null || author.banned) return empty;
    const viewer = await viewerProfile(ctx);
    if (!(await canSeeFull(ctx, viewer, author))) return empty;
    const result = await ctx.db
      .query("blogPosts")
      .withIndex("by_author", (q) => q.eq("authorId", author._id))
      .order("desc")
      .paginate({ numItems: POSTS_PER_PAGE, cursor });
    const page: BlogPostSummary[] = [];
    const authors = new Map<Id<"profiles">, boolean>();
    for (const post of result.page) {
      if (!post.hidden) page.push(await toSummary(ctx, post, author, viewer, authors));
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * One post with its body, or null when the id is malformed, the post is gone
 * or hidden, its author is banned, or its author is private and the viewer can't
 * see their full page. The comment count leaves out banned commenters.
 */
export const get = query({
  args: { id: v.string() },
  returns: v.union(postView, v.null()),
  handler: async (ctx, { id }): Promise<BlogPostView | null> => {
    const postId = ctx.db.normalizeId("blogPosts", id);
    if (postId === null) return null;
    const found = await visiblePost(ctx, postId);
    if (found === null) return null;
    const viewer = await viewerProfile(ctx);
    if (!(await canSeeFull(ctx, viewer, found.author))) return null;
    const summary = await toSummary(ctx, found.post, found.author, viewer, new Map());
    return { ...summary, body: (await bodyRow(ctx, postId))?.body ?? "" };
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
 * page can come back short. Empty when the post's author is private and the
 * viewer can't see their full page.
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
    if (!(await canSeeFull(ctx, viewer, owner))) return empty;

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
