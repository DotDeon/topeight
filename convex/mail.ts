import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { areFriends, isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { MAX_MESSAGE, MAX_SUBJECT, checkBody, checkLinks } from "./lib/posting";

const PAGE_SIZE = 25;
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
};

const cardValidator = v.object({
  username: v.string(),
  displayName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  kind: v.union(v.literal("fan"), v.literal("artist")),
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
 * Why `me` may not mail `target`, or null when they may. Self, the house
 * account, banned targets and blocks either way are "Not allowed"; a
 * friends-only target refuses non-friends.
 */
async function refusal(ctx: Ctx, me: Doc<"profiles">, target: Doc<"profiles">): Promise<string | null> {
  if (target._id === me._id || target.isHouse || target.banned) return "Not allowed";
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

/** Turns a page of rows into summaries, dropping rows whose other party is banned or gone. */
async function summarize(
  ctx: QueryCtx,
  rows: Doc<"messages">[],
  otherOf: (m: Doc<"messages">) => Id<"profiles">,
  showUnread: boolean,
): Promise<MessageSummary[]> {
  const cards = new Map<Id<"profiles">, PublicCard | null>();
  const out: MessageSummary[] = [];
  for (const m of rows) {
    const otherId = otherOf(m);
    if (!cards.has(otherId)) {
      const p = await ctx.db.get(otherId);
      cards.set(otherId, p === null || p.banned ? null : toPublicCard(p));
    }
    const other = cards.get(otherId);
    if (!other) continue;
    out.push({ id: m._id, other, subject: m.subject, createdAt: m._creationTime, unread: showUnread && m.unread });
  }
  return out;
}

const cursorArg = { cursor: v.union(v.string(), v.null()) };

/** The viewer's received mail, 25 a page, newest first. Banned senders are dropped, so a page can come back short. */
export const inbox = query({
  args: cursorArg,
  returns: pageValidator,
  handler: async (ctx, { cursor }): Promise<Page> => {
    const me = await viewerProfile(ctx);
    if (me === null) return EMPTY;
    const result = await ctx.db
      .query("messages")
      .withIndex("by_recipient", (q) => q.eq("recipientId", me._id).eq("recipientDeleted", false))
      .order("desc")
      .paginate({ numItems: PAGE_SIZE, cursor });
    const page = await summarize(ctx, result.page, (m) => m.senderId, true);
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
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
    const page = await summarize(ctx, result.page, (m) => m.recipientId, false);
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Opens one of the viewer's own messages and marks it read when the viewer is
 * the recipient. Anyone else, admins included, gets "Not found". A message
 * whose other party is banned still opens, but cannot be replied to.
 */
export const read = mutation({
  args: { id: v.id("messages") },
  returns: viewValidator,
  handler: async (ctx, { id }): Promise<MessageView> => {
    const me = await requireProfile(ctx);
    const m = viewerCopy(await ctx.db.get(id), me);
    if (m === null) throw new ConvexError("Not found");
    const isRecipient = m.recipientId === me._id;
    const [from, to] = await Promise.all([ctx.db.get(m.senderId), ctx.db.get(m.recipientId)]);
    if (from === null || to === null) throw new ConvexError("Not found");
    if (isRecipient && m.unread) await ctx.db.patch(m._id, { unread: false, readAt: Date.now() });

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
      ...(original !== null ? { replyTo: { subject: original.subject } } : {}),
    };
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

/** Unread mail in the viewer's inbox from unbanned senders, reading at most 100 rows. 0 when signed out. */
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
    const banned = new Map<Id<"profiles">, boolean>();
    let count = 0;
    for (const m of rows) {
      if (!banned.has(m.senderId)) {
        const p = await ctx.db.get(m.senderId);
        banned.set(m.senderId, p === null || p.banned);
      }
      if (!banned.get(m.senderId)) count++;
    }
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
