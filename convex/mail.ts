import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { areFriends, isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { MAX_MESSAGE, MAX_SUBJECT, checkBody, checkLinks } from "./lib/posting";
import { profileKind } from "./lib/kinds";

const PAGE_SIZE = 25;
/** Most inbox rows one page reads while skipping hidden ones: three pages' worth. */
const INBOX_SCAN = 3 * PAGE_SIZE;
/** Most unread rows unreadCount reads. The header only needs "any", the inbox shows "99+". */
const MAX_UNREAD = 100;

type Ctx = QueryCtx | MutationCtx;

export type MessageSummary = {
  id: Id<"messages">;
  /** The sender in the inbox, the recipient in sent. */
  other: PublicCard;
  subject: string;
  createdAt: number;
  unread: boolean;
};

export type MessageView = {
  id: Id<"messages">;
  from: PublicCard;
  to: PublicCard;
  subject: string;
  /** Plain text. The client renders it. */
  body: string;
  createdAt: number;
  canReply: boolean;
  isRecipient: boolean;
  replyTo?: { subject: string };
  /** Recipient only. Always false for the sender: senders get no read receipts. */
  unread: boolean;
};

const cardValidator = v.object({
  username: v.string(),
  displayName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  kind: profileKind,
});
const pageValidator = v.object({
  page: v.array(
    v.object({
      id: v.id("messages"),
      other: cardValidator,
      subject: v.string(),
      createdAt: v.number(),
      unread: v.boolean(),
    }),
  ),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
const viewValidator = v.object({
  unread: v.boolean(),
  id: v.id("messages"),
  from: cardValidator,
  to: cardValidator,
  subject: v.string(),
  body: v.string(),
  createdAt: v.number(),
  canReply: v.boolean(),
  isRecipient: v.boolean(),
  replyTo: v.optional(v.object({ subject: v.string() })),
});

type Page = { page: MessageSummary[]; isDone: boolean; continueCursor: string };
const EMPTY: Page = { page: [], isDone: true, continueCursor: "" };

/** The signed-in, unbanned viewer, or null. For queries that should not throw when signed out. */
async function viewerProfile(ctx: Ctx): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const p = await profileForUser(ctx, userId);
  return p === null || p.banned ? null : p;
}

async function profileByUsername(ctx: Ctx, username: string): Promise<Doc<"profiles"> | null> {
  const checked = validateUsername(username);
  if (!checked.ok) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", checked.username))
    .unique();
}

/**
 * Why `me` may not mail `target`, or null when they may. Self, banned
 * targets and blocks either way are "Not allowed"; a friends-only target
 * refuses non-friends. The house account takes mail like anyone else.
 */
async function refusal(ctx: Ctx, me: Doc<"profiles">, target: Doc<"profiles">): Promise<string | null> {
  if (target._id === me._id || target.banned) return "Not allowed";
  if (await isBlockedEitherWay(ctx, me._id, target._id)) return "Not allowed";
  if ((target.mailFrom ?? "friends") === "friends" && !(await areFriends(ctx, me._id, target._id))) {
    return "This person only accepts messages from friends";
  }
  return null;
}

/** The message if the viewer still has a copy of it, otherwise null. */
function viewerCopy(m: Doc<"messages"> | null, me: Doc<"profiles">): Doc<"messages"> | null {
  if (m === null) return null;
  if (m.recipientId === me._id && !m.recipientDeleted) return m;
  if (m.senderId === me._id && !m.senderDeleted) return m;
  return null;
}

/**
 * Sends a message by username. Validation, permission and link checks come
 * before the hourly and daily limits so a refused send costs no quota.
 * `replyTo` must be a message the sender received from the person they are writing to.
 */
export const send = mutation({
  args: { to: v.string(), subject: v.string(), body: v.string(), replyTo: v.optional(v.id("messages")) },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const subject = checkBody(args.subject, "Subject", MAX_SUBJECT);
    const body = checkBody(args.body, "Message", MAX_MESSAGE);
    const target = await profileByUsername(ctx, args.to);
    if (target === null || target.banned) throw new ConvexError("Profile not found");
    const why = await refusal(ctx, me, target);
    if (why !== null) throw new ConvexError(why);
    if (args.replyTo !== undefined) {
      const original = viewerCopy(await ctx.db.get(args.replyTo), me);
      if (original === null || original.recipientId !== me._id || original.senderId !== target._id) {
        throw new ConvexError("Not found");
      }
    }
    checkLinks(me, `${subject}\n${body}`);
    // A throw rolls the whole mutation back, so a refused daily limit does not keep the hourly hit.
    for (const name of ["mail", "mailDaily"] as const) {
      const { ok } = await rateLimiter.limit(ctx, name, { key: me._id });
      if (!ok) throw new ConvexError("Slow down");
    }
    return await ctx.db.insert("messages", {
      senderId: me._id,
      recipientId: target._id,
      subject,
      body,
      unread: true,
      senderDeleted: false,
      recipientDeleted: false,
      ...(args.replyTo !== undefined ? { replyTo: args.replyTo } : {}),
    });
  },
});

/**
 * Card lookups for the other party, cached per profile. Null means the row is
 * hidden: the other party is gone or banned, or (when `checkBlocks` is set)
 * either side has blocked the other.
 */
function otherParty(ctx: QueryCtx, me: Doc<"profiles">, checkBlocks: boolean) {
  const cards = new Map<Id<"profiles">, PublicCard | null>();
  return async (otherId: Id<"profiles">): Promise<PublicCard | null> => {
    if (!cards.has(otherId)) {
      const p = await ctx.db.get(otherId);
      const hidden = p === null || p.banned || (checkBlocks && (await isBlockedEitherWay(ctx, me._id, otherId)));
      cards.set(otherId, hidden ? null : toPublicCard(p));
    }
    return cards.get(otherId) ?? null;
  };
}

function summary(m: Doc<"messages">, other: PublicCard, unread: boolean): MessageSummary {
  return { id: m._id, other, subject: m.subject, createdAt: m._creationTime, unread };
}

const cursorArg = { cursor: v.union(v.string(), v.null()) };

/**
 * The viewer's received mail, 25 a page, newest first. Mail from banned
 * senders, and from anyone either side has blocked, is skipped. To keep pages
 * full, one call reads up to 75 rows and returns the first 25 visible ones.
 * The cursor is the `_creationTime` of the last row consumed, so the next call
 * starts right after it. If 75 rows in a row are hidden the page comes back
 * empty with `isDone: false`, and the next cursor moves past them.
 * This is a plain query with its own cursor, not a Convex paginated query:
 * call it with `useQuery` and keep the cursor in state.
 */
export const inbox = query({
  args: cursorArg,
  returns: pageValidator,
  handler: async (ctx, { cursor }): Promise<Page> => {
    const me = await viewerProfile(ctx);
    if (me === null) return EMPTY;
    const before = cursor === null ? null : Number(cursor);
    if (before !== null && !Number.isFinite(before)) return EMPTY;
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => {
        const base = q.eq("recipientId", me._id).eq("recipientDeleted", false);
        return before === null ? base : base.lt("_creationTime", before);
      })
      .order("desc")
      .take(INBOX_SCAN);
    const cardFor = otherParty(ctx, me, true);
    const page: MessageSummary[] = [];
    let last: number | null = null;
    let i = 0;
    for (; i < rows.length && page.length < PAGE_SIZE; i++) {
      const m = rows[i];
      last = m._creationTime;
      const other = await cardFor(m.senderId);
      if (other) page.push(summary(m, other, m.unread));
    }
    // Rows left over from this read decide isDone when the scan was not cut short.
    let moreVisible = false;
    for (let j = i; j < rows.length && !moreVisible; j++) moreVisible = (await cardFor(rows[j].senderId)) !== null;
    const isDone = rows.length < INBOX_SCAN && !moreVisible;
    return { page, isDone, continueCursor: last === null ? (cursor ?? "") : String(last) };
  },
});

/**
 * The viewer's sent mail, 25 a page, newest first. Banned recipients are
 * dropped. `unread` is always false here: senders get no read receipts.
 */
export const sent = query({
  args: cursorArg,
  returns: pageValidator,
  handler: async (ctx, { cursor }): Promise<Page> => {
    const me = await viewerProfile(ctx);
    if (me === null) return EMPTY;
    const result = await ctx.db
      .query("messages")
      .withIndex("by_sender", (q) => q.eq("senderId", me._id).eq("senderDeleted", false))
      .order("desc")
      .paginate({ numItems: PAGE_SIZE, cursor });
    const cardFor = otherParty(ctx, me, false);
    const page: MessageSummary[] = [];
    for (const m of result.page) {
      const other = await cardFor(m.recipientId);
      if (other) page.push(summary(m, other, false));
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * One of the viewer's own messages. Anyone else, admins included, gets
 * "Not found". A message whose other party is banned still opens, but cannot
 * be replied to. No side effects: the client calls markRead when it opens.
 */
export const get = query({
  args: { id: v.id("messages") },
  returns: viewValidator,
  handler: async (ctx, { id }): Promise<MessageView> => {
    const me = await requireProfile(ctx);
    const m = viewerCopy(await ctx.db.get(id), me);
    if (m === null) throw new ConvexError("Not found");
    const isRecipient = m.recipientId === me._id;
    const [from, to] = await Promise.all([ctx.db.get(m.senderId), ctx.db.get(m.recipientId)]);
    if (from === null || to === null) throw new ConvexError("Not found");
    const canReply = isRecipient && (await refusal(ctx, me, from)) === null;
    const original = m.replyTo !== undefined ? await ctx.db.get(m.replyTo) : null;
    return {
      id: m._id,
      from: toPublicCard(from),
      to: toPublicCard(to),
      subject: m.subject,
      body: m.body,
      createdAt: m._creationTime,
      canReply,
      isRecipient,
      unread: isRecipient && m.unread,
      ...(original !== null ? { replyTo: { subject: original.subject } } : {}),
    };
  },
});

/** Marks one of the viewer's received messages read. Does nothing for the sender or a message already read. */
export const markRead = mutation({
  args: { id: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const me = await requireProfile(ctx);
    const m = viewerCopy(await ctx.db.get(id), me);
    if (m === null) throw new ConvexError("Not found");
    if (m.recipientId === me._id && m.unread) await ctx.db.patch(m._id, { unread: false, readAt: Date.now() });
    return null;
  },
});

/** Deletes the viewer's copy. The row itself goes once both sides have deleted it. */
export const remove = mutation({
  args: { id: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const me = await requireProfile(ctx);
    const m = viewerCopy(await ctx.db.get(id), me);
    if (m === null) throw new ConvexError("Not found");
    const senderDeleted = m.senderDeleted || m.senderId === me._id;
    const recipientDeleted = m.recipientDeleted || m.recipientId === me._id;
    if (senderDeleted && recipientDeleted) await ctx.db.delete(m._id);
    else await ctx.db.patch(m._id, { senderDeleted, recipientDeleted });
    return null;
  },
});

/**
 * Unread mail in the viewer's inbox, reading at most 100 rows and skipping the
 * same senders the inbox hides (banned, or blocked either way). 0 when signed out.
 */
export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const me = await viewerProfile(ctx);
    if (me === null) return 0;
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_recipient_unread", (q) =>
        q.eq("recipientId", me._id).eq("recipientDeleted", false).eq("unread", true),
      )
      .take(MAX_UNREAD);
    const cardFor = otherParty(ctx, me, true);
    let count = 0;
    for (const m of rows) if ((await cardFor(m.senderId)) !== null) count++;
    return count;
  },
});

/** Sets who may send the viewer mail. */
export const setMailFrom = mutation({
  args: { value: v.union(v.literal("friends"), v.literal("anyone")) },
  returns: v.null(),
  handler: async (ctx, { value }) => {
    const me = await requireProfile(ctx);
    await ctx.db.patch(me._id, { mailFrom: value });
    return null;
  },
});

/** True when the signed-in viewer may mail this username. False for signed-out callers and unknown names. */
export const canMessage = query({
  args: { username: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { username }) => {
    const me = await viewerProfile(ctx);
    if (me === null) return false;
    const target = await profileByUsername(ctx, username);
    if (target === null) return false;
    return (await refusal(ctx, me, target)) === null;
  },
});
