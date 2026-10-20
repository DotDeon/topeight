import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { isAdmin, isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { photoUrl } from "./lib/media";
import { checkBody, checkLinks } from "./lib/posting";
import { profileByUsername } from "./profiles";

const MIN_NAME = 3;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 2000;
const MAX_TITLE = 100;
const MAX_POST = 5000;
const MAX_SLUG = 60;
/** Highest suffix tried for a taken slug: name, name-2, ... name-50. */
const MAX_SLUG_SUFFIX = 50;
const GROUPS_PER_PAGE = 20;
const SEARCH_SIZE = 20;
const TOPICS_PER_PAGE = 20;
const REPLIES_PER_PAGE = 50;
const MEMBERS_PER_PAGE = 50;
const MAX_QUERY = 100;
const DAY = 24 * 60 * 60 * 1000;
/** How old an account must be to create a group. */
const CREATE_AGE_MS = 7 * DAY;

type Ctx = QueryCtx | MutationCtx;

export const CATEGORIES = ["music", "local", "hobbies", "fanclubs", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
const categoryValidator = v.union(
  v.literal("music"),
  v.literal("local"),
  v.literal("hobbies"),
  v.literal("fanclubs"),
  v.literal("other"),
);

const cardValidator = v.object({
  username: v.string(),
  displayName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  kind: v.union(v.literal("fan"), v.literal("artist")),
});

const summaryFields = {
  id: v.id("groups"),
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: categoryValidator,
  photoUrl: v.union(v.string(), v.null()),
  memberCount: v.number(),
  /** Only ever true for admins, who also see deleted and hidden groups. */
  deleted: v.boolean(),
  hidden: v.boolean(),
};
const summaryView = v.object(summaryFields);
const groupView = v.object({
  ...summaryFields,
  owner: cardValidator,
  isMember: v.boolean(),
  isOwner: v.boolean(),
  isBanned: v.boolean(),
});
const topicItem = v.object({
  id: v.id("groupTopics"),
  title: v.string(),
  author: cardValidator,
  replyCount: v.number(),
  lastReplyAt: v.number(),
  createdAt: v.number(),
});
const topicView = v.object({
  id: v.id("groupTopics"),
  title: v.string(),
  author: cardValidator,
  replyCount: v.number(),
  createdAt: v.number(),
  groupId: v.id("groups"),
  slug: v.string(),
  groupName: v.string(),
  /** The viewer is a member who isn't banned from the group. */
  canPost: v.boolean(),
  /** The viewer owns the group. */
  canModerate: v.boolean(),
});
const replyView = v.object({
  id: v.id("groupReplies"),
  author: cardValidator,
  body: v.string(),
  createdAt: v.number(),
  /** The topic's first post. Removing it hides the topic. */
  isFirst: v.boolean(),
  canRemove: v.boolean(),
});
const memberView = v.object({ member: cardValidator, isOwner: v.boolean() });
const bannedView = v.object({ profileId: v.id("profiles"), member: cardValidator });

const pageOf = <
  T extends typeof summaryView | typeof topicItem | typeof replyView | typeof memberView | typeof bannedView,
>(
  item: T,
) =>
  v.object({ page: v.array(item), isDone: v.boolean(), continueCursor: v.string() });

export type GroupSummary = {
  id: Id<"groups">;
  slug: string;
  name: string;
  description: string;
  category: Category;
  photoUrl: string | null;
  memberCount: number;
  deleted: boolean;
  hidden: boolean;
};
export type GroupView = GroupSummary & { owner: PublicCard; isMember: boolean; isOwner: boolean; isBanned: boolean };
export type GroupTopicItem = {
  id: Id<"groupTopics">;
  title: string;
  author: PublicCard;
  replyCount: number;
  lastReplyAt: number;
  createdAt: number;
};
export type GroupTopicView = {
  id: Id<"groupTopics">;
  title: string;
  author: PublicCard;
  replyCount: number;
  createdAt: number;
  groupId: Id<"groups">;
  slug: string;
  groupName: string;
  canPost: boolean;
  canModerate: boolean;
};
export type GroupReplyView = {
  id: Id<"groupReplies">;
  author: PublicCard;
  body: string;
  createdAt: number;
  isFirst: boolean;
  canRemove: boolean;
};
export type GroupMemberView = { member: PublicCard; isOwner: boolean };
export type BannedMemberView = { profileId: Id<"profiles">; member: PublicCard };
type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** Lowercase a–z, 0–9 and single hyphens, no hyphen at either end, at most 60 characters. Accents are dropped. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

/** The first of slug, slug-2 ... slug-50 no group (deleted ones included) has. */
async function freeSlug(ctx: MutationCtx, base: string): Promise<string> {
  for (let n = 1; n <= MAX_SLUG_SUFFIX; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "") + suffix;
    const taken = await ctx.db
      .query("groups")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (taken === null) return slug;
  }
  throw new ConvexError("Pick a different name");
}

/** The signed-in, unbanned viewer, or null. */
async function viewerProfile(ctx: Ctx): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const p = await profileForUser(ctx, userId);
  return p === null || p.banned ? null : p;
}

/** Deleted and hidden groups are shown to admins only. */
function readable(group: Doc<"groups"> | null, admin: boolean): group is Doc<"groups"> {
  return group !== null && (admin || (!group.deleted && !group.hidden));
}

function live(group: Doc<"groups"> | null): group is Doc<"groups"> {
  return group !== null && !group.deleted && !group.hidden;
}

async function groupBySlug(ctx: Ctx, slug: string): Promise<Doc<"groups"> | null> {
  return await ctx.db
    .query("groups")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

async function membership(ctx: Ctx, groupId: Id<"groups">, profileId: Id<"profiles">) {
  return await ctx.db
    .query("groupMembers")
    .withIndex("by_pair", (q) => q.eq("groupId", groupId).eq("profileId", profileId))
    .unique();
}

/** Throws unless `me` is a member of the group who isn't banned from it. */
async function requireMember(ctx: MutationCtx, groupId: Id<"groups">, me: Doc<"profiles">): Promise<void> {
  const row = await membership(ctx, groupId, me._id);
  if (row === null) throw new ConvexError("Join the group first");
  if (row.banned) throw new ConvexError("You're banned from this group");
}

/** A live group `me` owns. Missing, deleted or hidden is "Not found", someone else's is "Not allowed". */
async function ownGroup(ctx: MutationCtx, me: Doc<"profiles">, groupId: Id<"groups">): Promise<Doc<"groups">> {
  const group = await ctx.db.get(groupId);
  if (!live(group)) throw new ConvexError("Not found");
  if (group.ownerId !== me._id) throw new ConvexError("Not allowed");
  return group;
}

async function bumpMembers(ctx: MutationCtx, group: Doc<"groups">, delta: 1 | -1): Promise<void> {
  const fresh = (await ctx.db.get(group._id)) ?? group;
  await ctx.db.patch(group._id, { memberCount: Math.max(0, fresh.memberCount + delta) });
}

/**
 * Hands the group to the member with this username. They must be a current,
 * non-banned member and not banned site-wide. The old owner stays a member.
 * No access check: groups.handOver and moderation.setGroupOwner do that.
 */
export async function transferOwnership(ctx: MutationCtx, group: Doc<"groups">, username: string): Promise<void> {
  const to = await profileByUsername(ctx, username);
  if (to === null || to.banned) throw new ConvexError("Not a member");
  if (to._id === group.ownerId) return;
  const row = await membership(ctx, group._id, to._id);
  if (row === null || row.banned) throw new ConvexError("Not a member");
  await ctx.db.patch(group._id, { ownerId: to._id });
}

/** Posts read from the newest back to find a topic's latest visible post after a removal. */
const LAST_REPLY_SCAN = 50;

/**
 * Hides a post and takes it off its topic's reply count, never below 0.
 * Hiding a topic's first post hides the whole topic. lastReplyAt moves back to
 * the newest visible post among the latest 50, or the topic's creation time.
 * Already hidden posts are left alone.
 */
export async function hideReply(ctx: MutationCtx, reply: Doc<"groupReplies">): Promise<void> {
  if (reply.hidden) return;
  await ctx.db.patch(reply._id, { hidden: true });
  const topic = await ctx.db.get(reply.topicId);
  if (topic === null) return;
  const first = await ctx.db
    .query("groupReplies")
    .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
    .first();
  const recent = await ctx.db
    .query("groupReplies")
    .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
    .order("desc")
    .take(LAST_REPLY_SCAN);
  const newest = recent.find((r) => !r.hidden);
  await ctx.db.patch(topic._id, {
    replyCount: Math.max(0, topic.replyCount - 1),
    lastReplyAt: newest?._creationTime ?? topic._creationTime,
    ...(first?._id === reply._id ? { hidden: true } : {}),
  });
}

function toSummary(g: Doc<"groups">): GroupSummary {
  return {
    id: g._id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    category: g.category,
    photoUrl: photoUrl(g.photoKey),
    memberCount: g.memberCount,
    deleted: g.deleted,
    hidden: g.hidden,
  };
}

type GroupFields = { name: string; description: string; category: Category };

/** Trimmed name and description. Throws on the length limits or the new-account link rule. */
function checkGroup(me: Doc<"profiles">, args: GroupFields): GroupFields {
  const name = args.name.trim();
  if (name.length < MIN_NAME) throw new ConvexError("Name is too short");
  if (name.length > MAX_NAME) throw new ConvexError("Name is too long");
  const description = args.description.trim();
  if (description.length > MAX_DESCRIPTION) throw new ConvexError("Description is too long");
  checkLinks(me, description);
  return { name, description, category: args.category };
}

const groupArgs = { name: v.string(), description: v.string(), category: categoryValidator };

/**
 * Creates a group owned by the caller, who becomes its first member. Accounts
 * must be a week old. The slug comes from the name, with -2, -3 ... on a
 * collision. Three a day; refused groups cost no quota.
 */
export const create = mutation({
  args: groupArgs,
  returns: v.object({ id: v.id("groups"), slug: v.string() }),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    if (Date.now() - me._creationTime < CREATE_AGE_MS) {
      throw new ConvexError("Your account must be a week old to create a group");
    }
    const fields = checkGroup(me, args);
    const base = slugify(fields.name);
    if (base === "") throw new ConvexError("Name needs letters or numbers");
    const slug = await freeSlug(ctx, base);
    const { ok } = await rateLimiter.limit(ctx, "groupCreate", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    const id = await ctx.db.insert("groups", {
      slug,
      ...fields,
      ownerId: me._id,
      deleted: false,
      hidden: false,
      memberCount: 1,
    });
    await ctx.db.insert("groupMembers", { groupId: id, profileId: me._id, banned: false });
    return { id, slug };
  },
});

/** Replaces the name, description and category. The slug never changes. Owner only. Photos go through media.beginUpload. */
export const update = mutation({
  args: { groupId: v.id("groups"), ...groupArgs },
  returns: v.null(),
  handler: async (ctx, { groupId, ...args }) => {
    const me = await requireProfile(ctx);
    await ownGroup(ctx, me, groupId);
    const fields = checkGroup(me, args);
    const { ok } = await rateLimiter.limit(ctx, "groupEdit", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.patch(groupId, fields);
    return null;
  },
});

/** Deletes a group: it drops out of every read but is kept for an admin to restore. Owner only. */
export const remove = mutation({
  args: { groupId: v.id("groups") },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const me = await requireProfile(ctx);
    await ownGroup(ctx, me, groupId);
    await ctx.db.patch(groupId, { deleted: true });
    return null;
  },
});

/** Joins a live group. Members banned from it can't rejoin. Joining twice does nothing. */
export const join = mutation({
  args: { groupId: v.id("groups") },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const me = await requireProfile(ctx);
    const group = await ctx.db.get(groupId);
    if (!live(group)) throw new ConvexError("Not found");
    const row = await membership(ctx, groupId, me._id);
    if (row?.banned) throw new ConvexError("You're banned from this group");
    if (row !== null) return null;
    await ctx.db.insert("groupMembers", { groupId, profileId: me._id, banned: false });
    await bumpMembers(ctx, group, 1);
    return null;
  },
});

/** Leaves a group. The owner must hand it over first. A group ban stays in place. */
export const leave = mutation({
  args: { groupId: v.id("groups") },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const me = await requireProfile(ctx);
    const group = await ctx.db.get(groupId);
    if (group === null) throw new ConvexError("Not found");
    if (group.ownerId === me._id) throw new ConvexError("Hand over the group first");
    const row = await membership(ctx, groupId, me._id);
    if (row === null || row.banned) return null;
    await ctx.db.delete(row._id);
    await bumpMembers(ctx, group, -1);
    return null;
  },
});

/** The profile for `username` and their row in a group the caller owns, refusing the owner. */
async function memberRow(
  ctx: MutationCtx,
  group: Doc<"groups">,
  username: string,
  selfError: string,
): Promise<{ target: Doc<"profiles">; row: Doc<"groupMembers"> | null }> {
  const target = await profileByUsername(ctx, username);
  if (target === null) throw new ConvexError("Not a member");
  if (target._id === group.ownerId) throw new ConvexError(selfError);
  return { target, row: await membership(ctx, group._id, target._id) };
}

/** Owner: deletes a membership. Their posts stay. Banned rows are refused: unbanMember lifts a ban. */
export const removeMember = mutation({
  args: { groupId: v.id("groups"), username: v.string() },
  returns: v.null(),
  handler: async (ctx, { groupId, username }) => {
    const me = await requireProfile(ctx);
    const group = await ownGroup(ctx, me, groupId);
    const { row } = await memberRow(ctx, group, username, "You can't remove yourself");
    if (row === null || row.banned) throw new ConvexError("Not a member");
    await ctx.db.delete(row._id);
    await bumpMembers(ctx, group, -1);
    return null;
  },
});

/**
 * Owner: bans someone from the group. They can't post or rejoin, and their posts
 * stay. A non-member gets a banned row too, so leaving can't dodge a ban.
 */
export const banMember = mutation({
  args: { groupId: v.id("groups"), username: v.string() },
  returns: v.null(),
  handler: async (ctx, { groupId, username }) => {
    const me = await requireProfile(ctx);
    const group = await ownGroup(ctx, me, groupId);
    const { target, row } = await memberRow(ctx, group, username, "You can't ban yourself");
    if (row === null) {
      await ctx.db.insert("groupMembers", { groupId, profileId: target._id, banned: true });
      return null;
    }
    if (row.banned) return null;
    await ctx.db.patch(row._id, { banned: true });
    await bumpMembers(ctx, group, -1);
    return null;
  },
});

/** Owner: lifts a group ban by deleting the banned row. They can join again; the count is unchanged. */
export const unbanMember = mutation({
  args: { groupId: v.id("groups"), profileId: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { groupId, profileId }) => {
    const me = await requireProfile(ctx);
    await ownGroup(ctx, me, groupId);
    const row = await membership(ctx, groupId, profileId);
    if (row === null || !row.banned) throw new ConvexError("Not banned");
    await ctx.db.delete(row._id);
    return null;
  },
});

/** Owner: makes another current member the owner. The caller stays a member. */
export const handOver = mutation({
  args: { groupId: v.id("groups"), to: v.string() },
  returns: v.null(),
  handler: async (ctx, { groupId, to }) => {
    const me = await requireProfile(ctx);
    const group = await ownGroup(ctx, me, groupId);
    await transferOwnership(ctx, group, to);
    return null;
  },
});

/** Owner: removes a post. Removing a topic's first post hides the topic. */
export const removePost = mutation({
  args: { replyId: v.id("groupReplies") },
  returns: v.null(),
  handler: async (ctx, { replyId }) => {
    const me = await requireProfile(ctx);
    const reply = await ctx.db.get(replyId);
    const topic = reply && (await ctx.db.get(reply.topicId));
    if (!reply || !topic) throw new ConvexError("Not found");
    await ownGroup(ctx, me, topic.groupId);
    await hideReply(ctx, reply);
    return null;
  },
});

/** Members start a topic with its first post. Ten an hour; refused topics cost no quota. */
export const startTopic = mutation({
  args: { groupId: v.id("groups"), title: v.string(), body: v.string() },
  returns: v.object({ topicId: v.id("groupTopics"), replyId: v.id("groupReplies") }),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const title = checkBody(args.title, "Title", MAX_TITLE);
    const body = checkBody(args.body, "Post", MAX_POST);
    if (!live(await ctx.db.get(args.groupId))) throw new ConvexError("Not found");
    await requireMember(ctx, args.groupId, me);
    checkLinks(me, title);
    checkLinks(me, body);
    const { ok } = await rateLimiter.limit(ctx, "groupTopic", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    const topicId = await ctx.db.insert("groupTopics", {
      groupId: args.groupId,
      authorId: me._id,
      title,
      lastReplyAt: Date.now(),
      replyCount: 1,
      hidden: false,
    });
    const replyId = await ctx.db.insert("groupReplies", { topicId, authorId: me._id, body, hidden: false });
    return { topicId, replyId };
  },
});

/** Members reply to a visible topic. Sixty an hour; refused replies cost no quota. */
export const reply = mutation({
  args: { topicId: v.id("groupTopics"), body: v.string() },
  returns: v.id("groupReplies"),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const body = checkBody(args.body, "Post", MAX_POST);
    const topic = await ctx.db.get(args.topicId);
    if (topic === null || topic.hidden) throw new ConvexError("Not found");
    const author = await ctx.db.get(topic.authorId);
    if (author === null || author.banned) throw new ConvexError("Not found");
    if (!live(await ctx.db.get(topic.groupId))) throw new ConvexError("Not found");
    await requireMember(ctx, topic.groupId, me);
    checkLinks(me, body);
    const { ok } = await rateLimiter.limit(ctx, "groupReply", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    const replyId = await ctx.db.insert("groupReplies", { topicId: topic._id, authorId: me._id, body, hidden: false });
    await ctx.db.patch(topic._id, { lastReplyAt: Date.now(), replyCount: topic.replyCount + 1 });
    return replyId;
  },
});

/**
 * One group by slug, or null when it is missing, or deleted or hidden and the
 * viewer isn't an admin. A site-banned owner's group stays up.
 */
export const get = query({
  args: { slug: v.string() },
  returns: v.union(groupView, v.null()),
  handler: async (ctx, { slug }): Promise<GroupView | null> => {
    const group = await groupBySlug(ctx, slug);
    if (!readable(group, await isAdmin(ctx))) return null;
    const owner = await ctx.db.get(group.ownerId);
    if (owner === null) return null;
    const viewer = await viewerProfile(ctx);
    const row = viewer === null ? null : await membership(ctx, group._id, viewer._id);
    return {
      ...toSummary(group),
      owner: toPublicCard(owner),
      isMember: row !== null && !row.banned,
      isOwner: viewer !== null && viewer._id === group.ownerId,
      isBanned: row?.banned ?? false,
    };
  },
});

/**
 * Groups, 20 a page, newest first. With `category`, reads that category
 * through by_category. With `q`, the 20 best name matches in one page.
 * Deleted and hidden groups are left out except for admins, so a page can be short.
 */
export const list = query({
  args: { category: v.optional(categoryValidator), q: v.optional(v.string()), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(summaryView),
  handler: async (ctx, { category, q, cursor }): Promise<Page<GroupSummary>> => {
    const admin = await isAdmin(ctx);
    const text = (q ?? "").trim().slice(0, MAX_QUERY);
    if (text !== "") {
      const rows = await ctx.db
        .query("groups")
        .withSearchIndex("search_name", (s) => {
          const base = s.search("name", text);
          const scoped = category ? base.eq("category", category) : base;
          return admin ? scoped : scoped.eq("deleted", false).eq("hidden", false);
        })
        .take(SEARCH_SIZE);
      return {
        page: rows.map(toSummary),
        isDone: true,
        continueCursor: "",
      };
    }
    const opts = { numItems: GROUPS_PER_PAGE, cursor };
    const result = category
      ? await ctx.db
          .query("groups")
          .withIndex("by_category", (i) => i.eq("category", category))
          .order("desc")
          .paginate(opts)
      : await ctx.db.query("groups").order("desc").paginate(opts);
    return {
      page: result.page.filter((g) => readable(g, admin)).map(toSummary),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** One page (50) of a group's members, oldest first. Group-banned and site-banned members are left out. */
export const members = query({
  args: { slug: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(memberView),
  handler: async (ctx, { slug, cursor }): Promise<Page<GroupMemberView>> => {
    const empty = { page: [], isDone: true, continueCursor: "" };
    const group = await groupBySlug(ctx, slug);
    if (!readable(group, await isAdmin(ctx))) return empty;
    const result = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_banned", (q) => q.eq("groupId", group._id).eq("banned", false))
      .paginate({ numItems: MEMBERS_PER_PAGE, cursor });
    const page: GroupMemberView[] = [];
    for (const row of result.page) {
      const p = await ctx.db.get(row.profileId);
      if (p === null || p.banned) continue;
      page.push({ member: toPublicCard(p), isOwner: p._id === group.ownerId });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Owner only: one page (50) of the people banned from a live group, for the Unban list. */
export const bannedMembers = query({
  args: { slug: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(bannedView),
  handler: async (ctx, { slug, cursor }): Promise<Page<BannedMemberView>> => {
    const viewer = await viewerProfile(ctx);
    const group = await groupBySlug(ctx, slug);
    if (!live(group)) throw new ConvexError("Not found");
    if (viewer === null || viewer._id !== group.ownerId) throw new ConvexError("Not allowed");
    const result = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_banned", (q) => q.eq("groupId", group._id).eq("banned", true))
      .paginate({ numItems: MEMBERS_PER_PAGE, cursor });
    const page: BannedMemberView[] = [];
    for (const row of result.page) {
      const p = await ctx.db.get(row.profileId);
      if (p !== null) page.push({ profileId: p._id, member: toPublicCard(p) });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Reads authors once each. An author is shown when they exist, aren't banned
 * site-wide and, for a signed-in viewer, aren't blocked either way.
 */
function authorFilter(ctx: Ctx, viewer: Doc<"profiles"> | null) {
  const seen = new Map<Id<"profiles">, Doc<"profiles"> | null>();
  return async (id: Id<"profiles">): Promise<Doc<"profiles"> | null> => {
    if (!seen.has(id)) {
      const p = await ctx.db.get(id);
      let ok = p !== null && !p.banned;
      if (ok && viewer !== null && id !== viewer._id) ok = !(await isBlockedEitherWay(ctx, viewer._id, id));
      seen.set(id, ok ? p : null);
    }
    return seen.get(id)!;
  };
}

/**
 * One page (20) of a group's topics, latest reply first. Hidden topics, topics
 * by banned members and, for the viewer, topics by anyone blocked either way
 * are dropped after paging, so a page can come back short.
 */
export const topics = query({
  args: { slug: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(topicItem),
  handler: async (ctx, { slug, cursor }): Promise<Page<GroupTopicItem>> => {
    const empty = { page: [], isDone: true, continueCursor: "" };
    const group = await groupBySlug(ctx, slug);
    if (!readable(group, await isAdmin(ctx))) return empty;
    const author = authorFilter(ctx, await viewerProfile(ctx));
    const result = await ctx.db
      .query("groupTopics")
      .withIndex("by_group_last", (q) => q.eq("groupId", group._id))
      .order("desc")
      .paginate({ numItems: TOPICS_PER_PAGE, cursor });
    const page: GroupTopicItem[] = [];
    for (const t of result.page) {
      if (t.hidden) continue;
      const a = await author(t.authorId);
      if (a === null) continue;
      page.push({
        id: t._id,
        title: t.title,
        author: toPublicCard(a),
        replyCount: t.replyCount,
        lastReplyAt: t.lastReplyAt,
        createdAt: t._creationTime,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** A visible topic and its group, or null. Blocks don't apply: the replies read filters those. */
async function readableTopic(ctx: Ctx, rawId: string) {
  const id = ctx.db.normalizeId("groupTopics", rawId);
  const topic = id && (await ctx.db.get(id));
  if (!topic || topic.hidden) return null;
  const author = await ctx.db.get(topic.authorId);
  if (author === null || author.banned) return null;
  const group = await ctx.db.get(topic.groupId);
  if (!readable(group, await isAdmin(ctx))) return null;
  return { topic, author, group };
}

/** One topic's header, or null when the id is malformed, the topic is hidden, its author banned or its group not shown. */
export const topic = query({
  args: { topicId: v.string() },
  returns: v.union(topicView, v.null()),
  handler: async (ctx, { topicId }): Promise<GroupTopicView | null> => {
    const found = await readableTopic(ctx, topicId);
    if (found === null) return null;
    const { topic, author, group } = found;
    const viewer = await viewerProfile(ctx);
    const row = viewer === null ? null : await membership(ctx, group._id, viewer._id);
    return {
      id: topic._id,
      title: topic.title,
      author: toPublicCard(author),
      replyCount: topic.replyCount,
      createdAt: topic._creationTime,
      groupId: group._id,
      slug: group.slug,
      groupName: group.name,
      canPost: row !== null && !row.banned && live(group),
      canModerate: viewer !== null && viewer._id === group.ownerId,
    };
  },
});

/**
 * One page (50) of a topic's posts, oldest first, the first post leading.
 * Hidden posts, banned members' posts and, for the viewer, posts by anyone
 * blocked either way are dropped after paging, so a page can come back short.
 */
export const replies = query({
  args: { topicId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: pageOf(replyView),
  handler: async (ctx, { topicId, cursor }): Promise<Page<GroupReplyView>> => {
    const empty = { page: [], isDone: true, continueCursor: "" };
    const found = await readableTopic(ctx, topicId);
    if (found === null) return empty;
    const { topic, group } = found;
    const viewer = await viewerProfile(ctx);
    const author = authorFilter(ctx, viewer);
    const canRemove = viewer !== null && viewer._id === group.ownerId;
    const first = await ctx.db
      .query("groupReplies")
      .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
      .first();
    const result = await ctx.db
      .query("groupReplies")
      .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
      .order("asc")
      .paginate({ numItems: REPLIES_PER_PAGE, cursor });
    const page: GroupReplyView[] = [];
    for (const r of result.page) {
      if (r.hidden) continue;
      const a = await author(r.authorId);
      if (a === null) continue;
      page.push({
        id: r._id,
        author: toPublicCard(a),
        body: r.body,
        createdAt: r._creationTime,
        isFirst: r._id === first?._id,
        canRemove,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
