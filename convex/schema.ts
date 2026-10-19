import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    profileViews: v.number(),
    lastLoginAt: v.number(),
    customCss: v.string(),
    customHtml: v.string(),
    customJs: v.string(),
    top8: v.array(v.id("profiles")),
    isHouse: v.boolean(),
    banned: v.boolean(),
  })
    .index("by_username", ["username"])
    .index("by_user", ["userId"])
    .index("by_kind_creation", ["kind"]),

  friendRequests: defineTable({
    from: v.id("profiles"),
    to: v.id("profiles"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
    ),
  })
    .index("by_to_status", ["to", "status"])
    .index("by_pair", ["from", "to"]),

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

  tracks: defineTable({
    profileId: v.id("profiles"),
    title: v.string(),
    key: v.string(),
    size: v.number(),
    order: v.number(),
    autoplay: v.boolean(),
  }).index("by_profile_order", ["profileId", "order"]),

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

  reports: defineTable({
    reporterId: v.id("profiles"),
    targetType: v.union(
      v.literal("profile"),
      v.literal("comment"),
      v.literal("bulletin"),
      v.literal("track"),
    ),
    targetId: v.string(),
    reason: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
  }).index("by_status", ["status"]),
});
