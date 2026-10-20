import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { moodIcon } from "./lib/moods";

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    username: v.string(),
    displayName: v.string(),
    kind: v.union(v.literal("fan"), v.literal("artist")),
    birthDate: v.string(),
    headline: v.string(),
    location: v.string(),
    gender: v.optional(v.string()),
    genre: v.optional(v.string()),
    aboutMe: v.string(),
    whoIdLikeToMeet: v.string(),
    interests: v.optional(
      v.object({
        general: v.string(),
        music: v.string(),
        movies: v.string(),
        television: v.string(),
        books: v.string(),
        heroes: v.string(),
      }),
    ),
    band: v.optional(
      v.object({
        members: v.string(),
        influences: v.string(),
        soundsLike: v.string(),
        recordLabel: v.string(),
        labelType: v.string(),
      }),
    ),
    photoKey: v.optional(v.string()),
    /** Kept in step with photoKey and the tracks table by syncMediaFlags. Rows from before the flags exist get them from migrations:backfillMediaFlags. */
    hasPhoto: v.optional(v.boolean()),
    hasTracks: v.optional(v.boolean()),
    /** Legacy. Views live in profileStats so a view never rewrites this doc. */
    profileViews: v.optional(v.number()),
    lastLoginAt: v.number(),
    customCss: v.string(),
    customHtml: v.string(),
    customJs: v.string(),
    top8: v.array(v.id("profiles")),
    isHouse: v.boolean(),
    banned: v.boolean(),
    /** Who may send this member mail. Undefined means friends only. */
    mailFrom: v.optional(v.union(v.literal("friends"), v.literal("anyone"))),
  })
    .index("by_username", ["username"])
    .index("by_user", ["userId"])
    .index("by_kind_creation", ["kind"])
    .index("by_kind_photo", ["kind", "hasPhoto"])
    .index("by_kind_tracks", ["kind", "hasTracks"])
    .searchIndex("search_name", {
      searchField: "displayName",
      filterFields: ["kind", "banned"],
    }),

  /** A member's saved profiles. One row per owner and profile. */
  favorites: defineTable({
    ownerId: v.id("profiles"),
    profileId: v.id("profiles"),
  })
    .index("by_owner", ["ownerId"])
    .index("by_pair", ["ownerId", "profileId"]),

  /** Counters kept off the profiles doc so bumping them doesn't re-run queries that read profiles. */
  profileStats: defineTable({
    profileId: v.id("profiles"),
    views: v.number(),
  }).index("by_profile", ["profileId"]),

  friendRequests: defineTable({
    from: v.id("profiles"),
    to: v.id("profiles"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
    /** When a decline happened, in ms. Accepted requests are deleted instead. */
    respondedAt: v.optional(v.number()),
  })
    .index("by_to_status", ["to", "status"])
    .index("by_pair", ["from", "to"])
    .index("by_pair_status", ["from", "to", "status"]),

  friendships: defineTable({
    a: v.id("profiles"),
    b: v.id("profiles"),
  })
    .index("by_a", ["a"])
    .index("by_b", ["b"])
    .index("by_pair", ["a", "b"]),

  comments: defineTable({
    profileId: v.id("profiles"),
    authorId: v.id("profiles"),
    body: v.string(),
    hidden: v.boolean(),
  }).index("by_profile", ["profileId"]),

  bulletins: defineTable({
    authorId: v.id("profiles"),
    body: v.string(),
    hidden: v.boolean(),
  }).index("by_author", ["authorId"]),

  /** Blog posts. Deleting one hard-deletes its comments too. */
  blogPosts: defineTable({
    authorId: v.id("profiles"),
    title: v.string(),
    body: v.string(),
    mood: v.optional(v.object({ text: v.string(), icon: moodIcon })),
    listening: v.optional(v.string()),
    hidden: v.boolean(),
  }).index("by_author", ["authorId"]),

  blogComments: defineTable({
    postId: v.id("blogPosts"),
    authorId: v.id("profiles"),
    body: v.string(),
    hidden: v.boolean(),
  }).index("by_post", ["postId"]),

  tracks: defineTable({
    profileId: v.id("profiles"),
    title: v.string(),
    key: v.string(),
    size: v.number(),
    order: v.number(),
    autoplay: v.boolean(),
  }).index("by_profile_order", ["profileId", "order"]),

  /** Uploads that have been started but not yet accepted or rejected. */
  uploads: defineTable({
    profileId: v.id("profiles"),
    purpose: v.union(v.literal("photo"), v.literal("track")),
    title: v.optional(v.string()),
    key: v.string(),
    /** Declared by the client and signed into the upload URL. */
    size: v.number(),
    contentType: v.string(),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_profile_purpose", ["profileId", "purpose", "createdAt"]),

  shows: defineTable({
    profileId: v.id("profiles"),
    date: v.string(),
    venue: v.string(),
    city: v.string(),
  })
    .index("by_profile_date", ["profileId", "date"])
    .index("by_date", ["date"]),

  blocks: defineTable({
    blocker: v.id("profiles"),
    blocked: v.id("profiles"),
  })
    .index("by_pair", ["blocker", "blocked"])
    .index("by_blocker", ["blocker"]),

  /**
   * Private mail. Each side deletes its own copy; the row goes when both have.
   * `unread` is the indexed flag, `readAt` is informational.
   */
  messages: defineTable({
    senderId: v.id("profiles"),
    recipientId: v.id("profiles"),
    subject: v.string(),
    body: v.string(),
    unread: v.boolean(),
    readAt: v.optional(v.number()),
    senderDeleted: v.boolean(),
    recipientDeleted: v.boolean(),
    /** A message this one answers. Always one the sender received from the recipient. */
    replyTo: v.optional(v.id("messages")),
  })
    .index("by_recipient", ["recipientId", "recipientDeleted"])
    .index("by_sender", ["senderId", "senderDeleted"])
    .index("by_recipient_unread", ["recipientId", "recipientDeleted", "unread"]),

  reports: defineTable({
    reporterId: v.id("profiles"),
    targetType: v.union(
      v.literal("profile"),
      v.literal("comment"),
      v.literal("bulletin"),
      v.literal("track"),
      v.literal("message"),
      v.literal("blogPost"),
      v.literal("blogComment"),
    ),
    targetId: v.string(),
    reason: v.string(),
    /** A copy of reported mail, so the report outlives both sides deleting it. */
    snapshot: v.optional(
      v.object({
        subject: v.optional(v.string()),
        body: v.string(),
        senderId: v.optional(v.id("profiles")),
      }),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
  })
    .index("by_status", ["status"])
    .index("by_target", ["targetType", "targetId", "status"]),
});
