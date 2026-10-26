import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { moodIcon } from "./lib/moods";
import { profileKind } from "./lib/kinds";

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    username: v.string(),
    displayName: v.string(),
    kind: profileKind,
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
    /** Venues only: the street address. */
    address: v.optional(v.string()),
    /** Labels only: an http(s) link to the label's own site. */
    website: v.optional(v.string()),
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
    /** The profile mood line: an icon and up to 40 characters of text. */
    mood: v.optional(v.object({ icon: moodIcon, text: v.string() })),
    /** Show the Online Now! badge. Undefined means yes; false means never show and never store presence. */
    showOnline: v.optional(v.boolean()),
    /**
     * Fans only: only friends (and admins) see the full page. Strangers get the
     * restricted card from lib/access.ts canSeeFull. Undefined means public.
     * becomeArtist clears it.
     */
    private: v.optional(v.boolean()),
    /**
     * The member's profile song: another artist's track, or their own. Read through
     * lib/profileSongs.ts profileSongFor, which hides it when the track is gone, the
     * artist is banned or the artist turned sharing off. Never cleared when the track
     * is deleted: the pick just reads as unavailable.
     */
    profileSong: v.optional(v.id("tracks")),
    /** Artists: let other members pick these songs. Undefined means yes. */
    shareSongs: v.optional(v.boolean()),
    /**
     * Test fixtures only: a creation time to use for the group-creation age check,
     * since _creationTime can't be patched. Written only by internal fixture mutations
     * in testing.ts, never by a public function.
     */
    createdAtOverride: v.optional(v.number()),
  })
    .index("by_username", ["username"])
    .index("by_user", ["userId"])
    .index("by_kind_creation", ["kind"])
    .index("by_kind_photo", ["kind", "hasPhoto"])
    .index("by_kind_tracks", ["kind", "hasTracks"])
    .index("by_profile_song", ["profileSong"])
    .searchIndex("search_name", {
      searchField: "displayName",
      filterFields: ["kind", "banned"],
    }),

  /**
   * One row per member with a profile song, kept in step with profiles.profileSong
   * by lib/profileSongs.ts setPick and clearPick. Lets usageCount count an artist's
   * picks without loading whole profile docs. profiles.profileSong stays the render path.
   */
  songPicks: defineTable({
    pickerId: v.id("profiles"),
    artistId: v.id("profiles"),
    trackId: v.id("tracks"),
  })
    .index("by_picker", ["pickerId"])
    .index("by_artist", ["artistId"]),

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

  /**
   * A venue's roster or a label's band. The venue or label (fromId) asks, the
   * artist answers. Accepted links show on both profiles. A decline is kept,
   * with respondedAt, so the sender waits 7 days before asking again. Removing
   * an accepted link deletes the row. type matches the sender's kind.
   */
  links: defineTable({
    fromId: v.id("profiles"),
    artistId: v.id("profiles"),
    type: v.union(v.literal("venue"), v.literal("label")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
    respondedAt: v.optional(v.number()),
  })
    .index("by_pair", ["fromId", "artistId"])
    .index("by_artist_status", ["artistId", "status"])
    .index("by_from_status", ["fromId", "status"]),

  /** One row per member who shares Online Now!, written only by presence.heartbeat. */
  presence: defineTable({
    profileId: v.id("profiles"),
    lastSeenAt: v.number(),
  }).index("by_profile", ["profileId"]),

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

  /**
   * Blog posts. The body lives in blogBodies so lists, the feed and the
   * profile box never load it. Deleting a post hard-deletes its body and comments.
   */
  blogPosts: defineTable({
    authorId: v.id("profiles"),
    title: v.string(),
    /** The first 200 characters of the body, for list previews. */
    excerpt: v.string(),
    mood: v.optional(v.object({ text: v.string(), icon: moodIcon })),
    listening: v.optional(v.string()),
    hidden: v.boolean(),
  }).index("by_author", ["authorId"]),

  /** One row per blog post, holding its full body. */
  blogBodies: defineTable({
    postId: v.id("blogPosts"),
    body: v.string(),
  }).index("by_post", ["postId"]),

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
    purpose: v.union(v.literal("photo"), v.literal("track"), v.literal("groupPhoto")),
    /** The group a groupPhoto upload is for. */
    groupId: v.optional(v.id("groups")),
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

  /**
   * Events anyone can post. The host's local date, time and IANA zone are kept
   * as entered; startsAt is the UTC instant they name. goingCount and
   * maybeCount are kept in step by events.rsvp and by bans (moderation).
   */
  events: defineTable({
    hostId: v.id("profiles"),
    title: v.string(),
    localDate: v.string(),
    localTime: v.string(),
    timeZone: v.string(),
    startsAt: v.number(),
    venue: v.string(),
    city: v.string(),
    /** The city lowercased and trimmed, for the city filter. */
    cityKey: v.string(),
    description: v.string(),
    imageUrl: v.optional(v.string()),
    cancelled: v.boolean(),
    hidden: v.boolean(),
    goingCount: v.number(),
    maybeCount: v.number(),
    /** Venue gigs: bands that took themselves off this lineup. The venue can't add them back. */
    optedOut: v.optional(v.array(v.id("profiles"))),
  })
    .index("by_start", ["startsAt"])
    .index("by_city_start", ["cityKey", "startsAt"])
    .index("by_host", ["hostId", "startsAt"]),

  /**
   * A venue gig's lineup, one row per band, in position order. startsAt and
   * hostId copy the event's, so a band's gigs and a venue's future gigs with a
   * band are one index read. events.create and events.update rewrite the rows.
   */
  gigArtists: defineTable({
    eventId: v.id("events"),
    hostId: v.id("profiles"),
    artistId: v.id("profiles"),
    position: v.number(),
    startsAt: v.number(),
  })
    .index("by_event", ["eventId", "position"])
    .index("by_artist_start", ["artistId", "startsAt"])
    .index("by_host_artist", ["hostId", "artistId", "startsAt"]),

  /** One row per member and event they answered. Clearing an answer deletes the row. */
  rsvps: defineTable({
    eventId: v.id("events"),
    profileId: v.id("profiles"),
    status: v.union(v.literal("going"), v.literal("maybe")),
  })
    .index("by_event_status", ["eventId", "status"])
    .index("by_pair", ["profileId", "eventId"])
    // Newest first with order("desc"), for a member's RSVP list.
    .index("by_profile", ["profileId"]),

  /**
   * Public groups. The slug is set from the name at creation and never changes.
   * memberCount counts non-banned memberships and is kept in step by groups.ts.
   * Deleted groups are kept so an admin can restore them.
   */
  groups: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.union(
      v.literal("music"),
      v.literal("local"),
      v.literal("hobbies"),
      v.literal("fanclubs"),
      v.literal("other"),
    ),
    photoKey: v.optional(v.string()),
    ownerId: v.id("profiles"),
    deleted: v.boolean(),
    hidden: v.boolean(),
    memberCount: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_category", ["category"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["deleted", "hidden", "category"],
    }),

  /** One row per member and group. A group ban keeps the row with banned: true so they can't rejoin. */
  groupMembers: defineTable({
    groupId: v.id("groups"),
    profileId: v.id("profiles"),
    banned: v.boolean(),
  })
    .index("by_group", ["groupId"])
    .index("by_group_banned", ["groupId", "banned"])
    .index("by_pair", ["groupId", "profileId"])
    .index("by_profile", ["profileId"]),

  /** Board topics. The first post is the topic's oldest groupReplies row, so replyCount starts at 1. */
  groupTopics: defineTable({
    groupId: v.id("groups"),
    authorId: v.id("profiles"),
    title: v.string(),
    lastReplyAt: v.number(),
    replyCount: v.number(),
    hidden: v.boolean(),
  }).index("by_group_last", ["groupId", "lastReplyAt"]),

  groupReplies: defineTable({
    topicId: v.id("groupTopics"),
    authorId: v.id("profiles"),
    body: v.string(),
    hidden: v.boolean(),
  }).index("by_topic", ["topicId"]),

  /**
   * An email invite. The token is the secret in the join link and the
   * unsubscribe link. It works once: acceptedBy is set when someone joins with it.
   */
  invites: defineTable({
    inviterId: v.id("profiles"),
    /** Trimmed and lowercased. */
    email: v.string(),
    token: v.string(),
    message: v.optional(v.string()),
    acceptedBy: v.optional(v.id("profiles")),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_inviter", ["inviterId"]),

  /** Addresses that asked never to get another invite. */
  inviteOptOuts: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),

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
      v.literal("event"),
      v.literal("group"),
      v.literal("groupTopic"),
      v.literal("groupReply"),
    ),
    targetId: v.string(),
    reason: v.string(),
    /**
     * A copy of reported mail, a reported blog post, event or group, so the report outlives
     * deletion and later edits. A group keeps its name as the title and its owner as the author.
     */
    snapshot: v.optional(
      v.object({
        subject: v.optional(v.string()),
        /** Blog posts, events and groups. */
        title: v.optional(v.string()),
        authorId: v.optional(v.id("profiles")),
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
