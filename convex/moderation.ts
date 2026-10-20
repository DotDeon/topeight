import { ConvexError, v } from "convex/values";
import { validateUsername } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { isAdmin, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { MAX_SCAN, rateLimiter } from "./lib/limits";
import { MAX_TRACKS } from "./lib/media";
import { storage } from "./lib/r2";
import { adjustRsvpCounts } from "./lib/rsvps";
import { hideReply, transferOwnership } from "./groups";
import { removeTrack } from "./media";

const MAX_REASON = 500;
const QUEUE_SIZE = 50;
const ABOUT_SNIPPET = 300;
/** Most sessions, and refresh tokens per session, a ban deletes. */
const MAX_SESSIONS = 100;
/** Most of a banned member's sent messages a ban marks read, newest first. */
const MAX_BAN_MAIL = 500;

const targetType = v.union(
  v.literal("profile"),
  v.literal("comment"),
  v.literal("bulletin"),
  v.literal("track"),
  v.literal("message"),
  v.literal("blogPost"),
  v.literal("blogComment"),
  v.literal("event"),
  v.literal("group"),
  v.literal("groupTopic"),
  v.literal("groupReply"),
);
type TargetType = Doc<"reports">["targetType"];
const TABLE = {
  profile: "profiles",
  comment: "comments",
  bulletin: "bulletins",
  track: "tracks",
  message: "messages",
  blogPost: "blogPosts",
  blogComment: "blogComments",
  event: "events",
  group: "groups",
  groupTopic: "groupTopics",
  groupReply: "groupReplies",
} as const;

type Ctx = QueryCtx | MutationCtx;

async function requireAdmin(ctx: Ctx): Promise<void> {
  if (!(await isAdmin(ctx))) throw new ConvexError("Not allowed");
}

/** The reported row, or null when the id is malformed or the row is gone. */
async function loadTarget(ctx: Ctx, type: TargetType, targetId: string) {
  const id = ctx.db.normalizeId(TABLE[type], targetId);
  return id === null ? null : await ctx.db.get(id);
}

async function openReportsOn(ctx: Ctx, type: TargetType, targetId: string, limit: number) {
  return await ctx.db
    .query("reports")
    .withIndex("by_target", (q) => q.eq("targetType", type).eq("targetId", targetId).eq("status", "open"))
    .take(limit);
}

/** Marks every open report on the target actioned, at most MAX_SCAN of them. */
async function actionAllOn(ctx: MutationCtx, type: TargetType, targetId: string) {
  for (const r of await openReportsOn(ctx, type, targetId, MAX_SCAN)) {
    await ctx.db.patch(r._id, { status: "actioned" });
  }
}

/** Bans a profile, signs its user out everywhere, marks its sent mail read, and closes the open reports on it. */
async function banProfile(ctx: MutationCtx, profile: Doc<"profiles">) {
  if (profile.isHouse) throw new ConvexError("Not allowed");
  // Banned members drop out of event counts. A repeat ban must not drop them twice.
  if (!profile.banned) await adjustRsvpCounts(ctx, profile._id, -1);
  await ctx.db.patch(profile._id, { banned: true });
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", profile.userId))
    .take(MAX_SESSIONS);
  for (const s of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
      .take(MAX_SESSIONS);
    for (const tok of tokens) await ctx.db.delete(tok._id);
    await ctx.db.delete(s._id);
  }
  // Their mail is hidden from inboxes now; marking it read keeps it from filling
  // the recipients' bounded unread counts.
  const sent = await ctx.db
    .query("messages")
    .withIndex("by_sender", (q) => q.eq("senderId", profile._id))
    .order("desc")
    .take(MAX_BAN_MAIL);
  for (const m of sent) if (m.unread) await ctx.db.patch(m._id, { unread: false });
  await actionAllOn(ctx, "profile", profile._id);
}

/** Lifts a ban and puts the member's RSVPs back in event counts. */
async function unbanProfile(ctx: MutationCtx, profile: Doc<"profiles">) {
  if (!profile.banned) return;
  await ctx.db.patch(profile._id, { banned: false });
  await adjustRsvpCounts(ctx, profile._id, 1);
}

async function profileTracks(ctx: Ctx, profileId: Id<"profiles">) {
  const rows = await ctx.db
    .query("tracks")
    .withIndex("by_profile_order", (q) => q.eq("profileId", profileId))
    .take(MAX_TRACKS);
  return rows.map((t) => ({ id: t._id, title: t.title }));
}

async function cardFor(ctx: Ctx, id: Id<"profiles">): Promise<PublicCard | null> {
  const p = await ctx.db.get(id);
  return p === null ? null : toPublicCard(p);
}

export type ReportPreview =
  | {
      kind: "profile";
      profileId: Id<"profiles">;
      username: string;
      displayName: string;
      headline: string;
      aboutMe: string;
      banned: boolean;
      // No URLs: tracks are private. The admin page asks trackPlaybackUrl to play one.
      tracks: { id: Id<"tracks">; title: string }[];
    }
  | {
      kind: "comment" | "bulletin" | "blogComment";
      body: string;
      authorId: Id<"profiles">;
      author: PublicCard | null;
    }
  | { kind: "blogPost"; title: string; body: string; authorId: Id<"profiles">; author: PublicCard | null }
  // Title and description as reported, from the snapshot. authorId is the host.
  | { kind: "event"; title: string; body: string; authorId: Id<"profiles">; author: PublicCard | null }
  | {
      kind: "track";
      trackId: Id<"tracks">;
      title: string;
      ownerId: Id<"profiles">;
      owner: PublicCard | null;
    }
  // Built from the report's snapshot only. Admins never read the messages table.
  | { kind: "message"; subject: string; body: string; senderId: Id<"profiles"> | null; sender: PublicCard | null }
  // Name and description as reported, from the snapshot. authorId is the owner when reported.
  // Deleted and hidden groups still preview, with their current state.
  | {
      kind: "group";
      groupId: Id<"groups">;
      slug: string;
      title: string;
      body: string;
      deleted: boolean;
      hidden: boolean;
      authorId: Id<"profiles">;
      author: PublicCard | null;
    }
  // A topic shows its title and first post.
  | {
      kind: "groupTopic";
      topicId: Id<"groupTopics">;
      slug: string;
      title: string;
      body: string;
      authorId: Id<"profiles">;
      author: PublicCard | null;
    }
  | {
      kind: "groupReply";
      replyId: Id<"groupReplies">;
      topicId: Id<"groupTopics">;
      slug: string;
      body: string;
      authorId: Id<"profiles">;
      author: PublicCard | null;
    }
  | { kind: "gone" };

async function preview(ctx: Ctx, report: Doc<"reports">): Promise<ReportPreview> {
  const { targetType: type, targetId } = report;
  if (type === "profile") {
    const id = ctx.db.normalizeId("profiles", targetId);
    const p = id && (await ctx.db.get(id));
    if (!p) return { kind: "gone" };
    return {
      kind: "profile",
      profileId: p._id,
      username: p.username,
      displayName: p.displayName,
      headline: p.headline,
      aboutMe: p.aboutMe.slice(0, ABOUT_SNIPPET),
      banned: p.banned,
      tracks: await profileTracks(ctx, p._id),
    };
  }
  if (type === "message") {
    const snap = report.snapshot;
    if (!snap) return { kind: "gone" };
    const senderId = snap.senderId ?? null;
    return {
      kind: "message",
      subject: snap.subject ?? "",
      body: snap.body,
      senderId,
      sender: senderId === null ? null : await cardFor(ctx, senderId),
    };
  }
  if (type === "blogPost" || type === "event") {
    // The snapshot is the post as reported, so later edits or a delete can't scrub it.
    const snap = report.snapshot;
    if (!snap?.authorId) return { kind: "gone" };
    return {
      kind: type,
      title: snap.title ?? "",
      body: snap.body,
      authorId: snap.authorId,
      author: await cardFor(ctx, snap.authorId),
    };
  }
  if (type === "group") {
    const snap = report.snapshot;
    const id = ctx.db.normalizeId("groups", targetId);
    const g = id && (await ctx.db.get(id));
    if (!g || !snap?.authorId) return { kind: "gone" };
    return {
      kind: "group",
      groupId: g._id,
      slug: g.slug,
      title: snap.title ?? "",
      body: snap.body,
      deleted: g.deleted,
      hidden: g.hidden,
      authorId: snap.authorId,
      author: await cardFor(ctx, snap.authorId),
    };
  }
  if (type === "groupTopic") {
    const id = ctx.db.normalizeId("groupTopics", targetId);
    const topic = id && (await ctx.db.get(id));
    const group = topic && (await ctx.db.get(topic.groupId));
    if (!topic || !group) return { kind: "gone" };
    const first = await ctx.db
      .query("groupReplies")
      .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
      .first();
    return {
      kind: "groupTopic",
      topicId: topic._id,
      slug: group.slug,
      title: topic.title,
      body: first?.body ?? "",
      authorId: topic.authorId,
      author: await cardFor(ctx, topic.authorId),
    };
  }
  if (type === "groupReply") {
    const id = ctx.db.normalizeId("groupReplies", targetId);
    const reply = id && (await ctx.db.get(id));
    const topic = reply && (await ctx.db.get(reply.topicId));
    const group = topic && (await ctx.db.get(topic.groupId));
    if (!reply || !topic || !group) return { kind: "gone" };
    return {
      kind: "groupReply",
      replyId: reply._id,
      topicId: topic._id,
      slug: group.slug,
      body: reply.body,
      authorId: reply.authorId,
      author: await cardFor(ctx, reply.authorId),
    };
  }
  if (type === "blogComment") {
    const id = ctx.db.normalizeId("blogComments", targetId);
    const row = id && (await ctx.db.get(id));
    if (!row) return { kind: "gone" };
    return { kind: "blogComment", body: row.body, authorId: row.authorId, author: await cardFor(ctx, row.authorId) };
  }
  if (type === "comment" || type === "bulletin") {
    const id = type === "comment" ? ctx.db.normalizeId("comments", targetId) : ctx.db.normalizeId("bulletins", targetId);
    const row = id && (await ctx.db.get(id));
    if (!row) return { kind: "gone" };
    return { kind: type, body: row.body, authorId: row.authorId, author: await cardFor(ctx, row.authorId) };
  }
  const id = ctx.db.normalizeId("tracks", targetId);
  const t = id && (await ctx.db.get(id));
  if (!t) return { kind: "gone" };
  return {
    kind: "track",
    trackId: t._id,
    title: t.title,
    ownerId: t.profileId,
    owner: await cardFor(ctx, t.profileId),
  };
}

/** True when the track belongs to the profile with this username. Unknown or malformed names are false. */
async function trackIsOn(ctx: Ctx, track: Doc<"tracks">, username: string | undefined): Promise<boolean> {
  if (username === undefined) return false;
  const checked = validateUsername(username);
  if (!checked.ok) return false;
  const owner = await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", checked.username))
    .unique();
  return owner !== null && !owner.banned && owner._id === track.profileId;
}

/**
 * Report a profile, comment, bulletin, track, message, blog post, blog comment, event, group, group
 * topic or group post. A repeat open report
 * by the same member adds nothing. A track report must name the profile it was
 * seen on in `profileUsername`, and the track must belong to it. Only the
 * recipient can report a message, and the report keeps a copy of it. A
 * blog post or event report keeps a copy of the title and body (description), a group report a
 * copy of its name, description and owner.
 */
export const report = mutation({
  args: { targetType, targetId: v.string(), reason: v.string(), profileUsername: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const reason = args.reason.trim();
    if (reason.length < 1 || reason.length > MAX_REASON) {
      throw new ConvexError(`Reason must be 1 to ${MAX_REASON} characters`);
    }
    const target = await loadTarget(ctx, args.targetType, args.targetId);
    if (target === null) throw new ConvexError("Not found");
    if (args.targetType === "track" && !(await trackIsOn(ctx, target as Doc<"tracks">, args.profileUsername))) {
      throw new ConvexError("Not found");
    }
    let snapshot: Doc<"reports">["snapshot"];
    if (args.targetType === "message") {
      const m = target as Doc<"messages">;
      if (m.recipientId !== me._id || m.recipientDeleted) throw new ConvexError("Not found");
      snapshot = { subject: m.subject, body: m.body, senderId: m.senderId };
    } else if (args.targetType === "blogPost") {
      const post = target as Doc<"blogPosts">;
      const body = await ctx.db
        .query("blogBodies")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .first();
      snapshot = { title: post.title, body: body?.body ?? post.excerpt, authorId: post.authorId };
    } else if (args.targetType === "event") {
      const event = target as Doc<"events">;
      snapshot = { title: event.title, body: event.description, authorId: event.hostId };
    } else if (args.targetType === "group") {
      const group = target as Doc<"groups">;
      snapshot = { title: group.name, body: group.description, authorId: group.ownerId };
    }
    const targetId = target._id as string;

    const open = await openReportsOn(ctx, args.targetType, targetId, MAX_SCAN);
    if (open.some((r) => r.reporterId === me._id)) return null;

    const { ok } = await rateLimiter.limit(ctx, "report", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.insert("reports", {
      reporterId: me._id,
      targetType: args.targetType,
      targetId,
      reason,
      status: "open",
      ...(snapshot ? { snapshot } : {}),
    });
    return null;
  },
});

/** Admin: the 50 oldest open reports, each with a preview of what was reported. */
export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("asc")
      .take(QUEUE_SIZE);
    const out = [];
    for (const r of rows) {
      out.push({
        id: r._id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        createdAt: r._creationTime,
        reporter: await cardFor(ctx, r.reporterId),
        preview: await preview(ctx, r),
      });
    }
    return out;
  },
});

async function openReport(ctx: MutationCtx, reportId: Id<"reports">) {
  const r = await ctx.db.get(reportId);
  if (r === null) throw new ConvexError("Report not found");
  return r;
}

/**
 * Admin: acts on the reported content. Comments, bulletins, blog posts, blog comments, events, groups,
 * group topics and group posts are hidden (a group post that opens its topic hides the topic),
 * tracks deleted, profiles banned, messages deleted for both sides. Closes
 * every open report on that target.
 */
export const hide = mutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    await requireAdmin(ctx);
    const r = await openReport(ctx, reportId);
    const type = r.targetType;
    if (type === "comment") {
      const id = ctx.db.normalizeId("comments", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "bulletin") {
      const id = ctx.db.normalizeId("bulletins", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "blogPost") {
      const id = ctx.db.normalizeId("blogPosts", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "blogComment") {
      const id = ctx.db.normalizeId("blogComments", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "event") {
      const id = ctx.db.normalizeId("events", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "group") {
      // Hides the whole group: page, board and listings.
      const id = ctx.db.normalizeId("groups", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "groupTopic") {
      const id = ctx.db.normalizeId("groupTopics", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { hidden: true });
    } else if (type === "groupReply") {
      const id = ctx.db.normalizeId("groupReplies", r.targetId);
      const reply = id && (await ctx.db.get(id));
      // Same as the owner removing it: a first post takes its topic with it.
      if (reply) await hideReply(ctx, reply);
    } else if (type === "message") {
      const id = ctx.db.normalizeId("messages", r.targetId);
      if (id && (await ctx.db.get(id))) await ctx.db.delete(id);
    } else if (type === "track") {
      const id = ctx.db.normalizeId("tracks", r.targetId);
      const track = id && (await ctx.db.get(id));
      if (track) await removeTrack(ctx, track);
    } else {
      const id = ctx.db.normalizeId("profiles", r.targetId);
      const profile = id && (await ctx.db.get(id));
      if (profile) await banProfile(ctx, profile);
    }
    await ctx.db.patch(r._id, { status: "actioned" });
    await actionAllOn(ctx, type, r.targetId);
    return null;
  },
});

/** Admin: un-deletes and un-hides a group. */
export const restoreGroup = mutation({
  args: { groupId: v.id("groups") },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    await requireAdmin(ctx);
    const group = await ctx.db.get(groupId);
    if (group === null) throw new ConvexError("Not found");
    await ctx.db.patch(groupId, { deleted: false, hidden: false });
    return null;
  },
});

/** Admin: hands a group to one of its current, non-banned members, for when the owner is banned or gone. */
export const setGroupOwner = mutation({
  args: { groupId: v.id("groups"), username: v.string() },
  returns: v.null(),
  handler: async (ctx, { groupId, username }) => {
    await requireAdmin(ctx);
    const group = await ctx.db.get(groupId);
    if (group === null) throw new ConvexError("Not found");
    await transferOwnership(ctx, group, username);
    return null;
  },
});

/** Admin: closes a report without touching the content. */
export const dismiss = mutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    await requireAdmin(ctx);
    const r = await openReport(ctx, reportId);
    await ctx.db.patch(r._id, { status: "dismissed" });
    return null;
  },
});

/** Admin: bans a profile and signs its user out. The house profile cannot be banned. */
export const ban = mutation({
  args: { profileId: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    await requireAdmin(ctx);
    const profile = await ctx.db.get(profileId);
    if (profile === null) throw new ConvexError("Profile not found");
    await banProfile(ctx, profile);
    return null;
  },
});

/** Admin: lifts a ban by profile id. */
export const unban = mutation({
  args: { profileId: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    await requireAdmin(ctx);
    const profile = await ctx.db.get(profileId);
    if (profile === null) throw new ConvexError("Profile not found");
    await unbanProfile(ctx, profile);
    return null;
  },
});

/** Admin: lifts a ban by username, for the Unban box on /admin. */
export const unbanByUsername = mutation({
  args: { username: v.string() },
  returns: v.null(),
  handler: async (ctx, { username }) => {
    await requireAdmin(ctx);
    const checked = validateUsername(username);
    const profile = checked.ok
      ? await ctx.db
          .query("profiles")
          .withIndex("by_username", (q) => q.eq("username", checked.username))
          .unique()
      : null;
    if (profile === null) throw new ConvexError("Profile not found");
    await unbanProfile(ctx, profile);
    return null;
  },
});

/** Admin: deletes any track and its object. */
export const deleteTrack = mutation({
  args: { trackId: v.id("tracks") },
  returns: v.null(),
  handler: async (ctx, { trackId }) => {
    await requireAdmin(ctx);
    const track = await ctx.db.get(trackId);
    if (track === null) return null;
    await removeTrack(ctx, track);
    await actionAllOn(ctx, "track", trackId);
    return null;
  },
});

/** Admin only: the key of any track, banned owners included. Null when the track is gone. */
export const trackKeyForAdmin = internalQuery({
  args: { trackId: v.id("tracks") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { trackId }) => {
    await requireAdmin(ctx);
    return (await ctx.db.get(trackId))?.key ?? null;
  },
});

/** Admin: a 15 minute playback URL for any track, even on a banned profile. Null when the track is gone. */
export const trackPlaybackUrl = action({
  args: { trackId: v.id("tracks") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { trackId }): Promise<string | null> => {
    const key: string | null = await ctx.runQuery(internal.moderation.trackKeyForAdmin, { trackId });
    return key === null ? null : await storage.playbackUrl(key);
  },
});

/** True when the caller may use the admin page. Not an admin function, so it never throws. */
export const canModerate = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await isAdmin(ctx),
});
