import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { ageOn, isCalendarDate, normalizeUsername, validateUsername } from "../lib/validation";
import type { PublicProfile } from "../lib/profile/types";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { profileForUser, requireProfile, requireVerifiedUser } from "./lib/access";
import { BULLETIN_WINDOW_MS } from "./lib/bulletins";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { friendIds, friendshipPair } from "./lib/friendships";
import { MAX_SCAN, rateLimiter } from "./lib/limits";
import { moodIcon } from "./lib/moods";
import { MAX_TRACKS, photoUrl, syncMediaFlags } from "./lib/media";

const MIN_AGE = 13;
const MAX_DISPLAY_NAME = 50;

function blankProfileFields() {
  return {
    headline: "",
    location: "",
    aboutMe: "",
    whoIdLikeToMeet: "",
    customCss: "",
    customHtml: "",
    customJs: "",
    banned: false,
  };
}

/** Returns the house profile, creating it (and its user) from config if missing. */
async function ensureHouseProfile(ctx: MutationCtx): Promise<Id<"profiles">> {
  const username = normalizeUsername(process.env.HOUSE_USERNAME ?? "");
  const displayName = (process.env.HOUSE_DISPLAY_NAME ?? "").trim();
  if (!username || !displayName) {
    throw new ConvexError("HOUSE_USERNAME and HOUSE_DISPLAY_NAME must be set");
  }
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
  if (existing !== null) {
    if (!existing.isHouse) {
      throw new ConvexError(`HOUSE_USERNAME "${username}" belongs to a member`);
    }
    return existing._id;
  }
  const userId = await ctx.db.insert("users", { name: displayName });
  return await ctx.db.insert("profiles", {
    ...blankProfileFields(),
    userId,
    username,
    displayName,
    kind: "fan",
    birthDate: "2003-08-01",
    lastLoginAt: Date.now(),
    top8: [],
    isHouse: true,
  });
}

export const ensureHouse = internalMutation({
  args: {},
  returns: v.id("profiles"),
  handler: async (ctx) => await ensureHouseProfile(ctx),
});

export const createMyProfile = mutation({
  args: {
    username: v.string(),
    displayName: v.string(),
    kind: v.union(v.literal("fan"), v.literal("artist")),
    birthDate: v.string(),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    if ((await profileForUser(ctx, user._id)) !== null) {
      throw new ConvexError("Profile already exists");
    }

    const checked = validateUsername(args.username);
    if (!checked.ok) throw new ConvexError(checked.reason);
    const username = checked.username;

    const displayName = args.displayName.trim();
    if (!displayName) throw new ConvexError("Display name is required");
    if (displayName.length > MAX_DISPLAY_NAME) {
      throw new ConvexError(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer`);
    }

    const now = new Date();
    const age = ageOn(args.birthDate, now);
    if (!isCalendarDate(args.birthDate) || !(age >= 0)) {
      throw new ConvexError("Invalid date of birth");
    }
    if (age < MIN_AGE) throw new ConvexError("You must be 13 or older");

    const houseId = await ensureHouseProfile(ctx);

    const taken = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (taken !== null) throw new ConvexError("Username taken");

    const profileId = await ctx.db.insert("profiles", {
      ...blankProfileFields(),
      userId: user._id,
      username,
      displayName,
      kind: args.kind,
      birthDate: args.birthDate,
      lastLoginAt: now.getTime(),
      top8: [houseId],
      isHouse: false,
    });
    await ctx.db.insert("friendships", friendshipPair(profileId, houseId));
    return profileId;
  },
});

/** The signed-in user's profile, or null if signed out or not yet created. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await profileForUser(ctx, userId);
  },
});

/** Records a login. The client calls this once per browser session. */
export const touchLogin = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await profileForUser(ctx, userId);
    if (profile !== null && !profile.banned) {
      await ctx.db.patch(profile._id, { lastLoginAt: Date.now() });
    }
    return null;
  },
});

// ---------------------------------------------------------------- editing

const MAX_CODE_BYTES = 100 * 1024;

function clean(raw: string, label: string, max: number): string {
  const value = raw.trim();
  if (value.length > max) throw new ConvexError(`${label} is too long`);
  return value;
}

const interestsValidator = v.object({
  general: v.string(),
  music: v.string(),
  movies: v.string(),
  television: v.string(),
  books: v.string(),
  heroes: v.string(),
});

const bandValidator = v.object({
  members: v.string(),
  influences: v.string(),
  soundsLike: v.string(),
  recordLabel: v.string(),
  labelType: v.string(),
});

/**
 * Saves the editable profile fields, trimmed and length checked. Fans keep
 * gender and interests, artists keep genre and band; the other group is ignored.
 */
export const updateDetails = mutation({
  args: {
    displayName: v.string(),
    headline: v.string(),
    location: v.string(),
    aboutMe: v.string(),
    whoIdLikeToMeet: v.string(),
    gender: v.optional(v.string()),
    genre: v.optional(v.string()),
    interests: v.optional(interestsValidator),
    band: v.optional(bandValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const displayName = clean(args.displayName, "Display name", MAX_DISPLAY_NAME);
    if (displayName === "") throw new ConvexError("Display name is required");
    const patch: Partial<Doc<"profiles">> = {
      displayName,
      headline: clean(args.headline, "Headline", 100),
      location: clean(args.location, "Location", 100),
      aboutMe: clean(args.aboutMe, "About me", 5000),
      whoIdLikeToMeet: clean(args.whoIdLikeToMeet, "Who I'd like to meet", 5000),
    };
    if (me.kind === "artist") {
      patch.genre = args.genre === undefined ? undefined : clean(args.genre, "Genre", 50);
      const b = args.band;
      patch.band =
        b === undefined
          ? undefined
          : {
              members: clean(b.members, "Band members", 500),
              influences: clean(b.influences, "Influences", 500),
              soundsLike: clean(b.soundsLike, "Sounds like", 500),
              recordLabel: clean(b.recordLabel, "Record label", 500),
              labelType: clean(b.labelType, "Label type", 500),
            };
    } else {
      patch.gender = args.gender === undefined ? undefined : clean(args.gender, "Gender", 50);
      const i = args.interests;
      patch.interests =
        i === undefined
          ? undefined
          : {
              general: clean(i.general, "Interests", 500),
              music: clean(i.music, "Interests", 500),
              movies: clean(i.movies, "Interests", 500),
              television: clean(i.television, "Interests", 500),
              books: clean(i.books, "Interests", 500),
              heroes: clean(i.heroes, "Interests", 500),
            };
    }
    await ctx.db.patch(me._id, patch);
    return null;
  },
});

/** Saves custom CSS, HTML and JS. 100 KB of UTF-8 in total; fans may save CSS only. */
export const updateCustomCode = mutation({
  args: { css: v.string(), html: v.string(), js: v.string() },
  returns: v.null(),
  handler: async (ctx, { css, html, js }) => {
    const me = await requireProfile(ctx);
    if (me.kind !== "artist" && (html !== "" || js !== "")) {
      throw new ConvexError("Fans can use CSS only");
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(html).length + encoder.encode(css).length + encoder.encode(js).length;
    if (bytes > MAX_CODE_BYTES) throw new ConvexError("Custom code is limited to 100 KB");
    await ctx.db.patch(me._id, { customCss: css, customHtml: html, customJs: js });
    return null;
  },
});

const MAX_MOOD = 40;

/**
 * Sets the profile mood line. A null icon clears it. Text is trimmed and at most
 * 40 characters; leaving the icon out keeps the current one. 30 an hour.
 */
export const setMood = mutation({
  args: { icon: v.optional(v.union(moodIcon, v.null())), text: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { icon, text }) => {
    const me = await requireProfile(ctx);
    const trimmed = (text ?? "").trim();
    if (trimmed.length > MAX_MOOD) throw new ConvexError("Mood is too long");
    const chosen = icon === undefined ? me.mood?.icon : icon;
    if (chosen === undefined) throw new ConvexError("Pick a mood");
    const { ok } = await rateLimiter.limit(ctx, "mood", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    if (chosen === null) {
      await ctx.db.patch(me._id, { mood: undefined });
      return null;
    }
    await ctx.db.patch(me._id, {
      mood: { icon: chosen, text: text === undefined && me.mood ? me.mood.text : trimmed },
    });
    return null;
  },
});

/** Switches a fan to an artist profile. Does nothing for artists. */
export const becomeArtist = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const me = await requireProfile(ctx);
    if (me.kind !== "artist") await ctx.db.patch(me._id, { kind: "artist" });
    await syncMediaFlags(ctx, me._id);
    return null;
  },
});

// ---------------------------------------------------------------- public profile

const PROFILE_COMMENTS = 10;
/** Comments are counted up to this many; the renderer shows more than 1000 as "1000+". */
const COMMENT_COUNT_CAP = 1001;
const MAX_SHOWS = 20;

export async function profileByUsername(ctx: QueryCtx | MutationCtx, raw: string): Promise<Doc<"profiles"> | null> {
  const checked = validateUsername(raw);
  if (!checked.ok) return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", checked.username))
    .unique();
}

/** Newest visible comments. Skips banned authors and authors the owner blocked. Scans at most MAX_SCAN rows. */
async function profileComments(ctx: QueryCtx, owner: Doc<"profiles">): Promise<PublicProfile["comments"]> {
  const rows = await ctx.db
    .query("comments")
    .withIndex("by_profile", (q) => q.eq("profileId", owner._id))
    .order("desc")
    .take(MAX_SCAN);
  const authors = new Map<Id<"profiles">, PublicCard | null>();
  const out: PublicProfile["comments"] = [];
  for (const row of rows) {
    if (row.hidden) continue;
    if (!authors.has(row.authorId)) {
      const author = await ctx.db.get(row.authorId);
      const blocked =
        author !== null &&
        (await ctx.db
          .query("blocks")
          .withIndex("by_pair", (q) => q.eq("blocker", owner._id).eq("blocked", row.authorId))
          .first()) !== null;
      authors.set(row.authorId, author === null || author.banned || blocked ? null : toPublicCard(author));
    }
    const card = authors.get(row.authorId);
    if (!card) continue;
    out.push({ author: card, body: row.body, createdAt: row._creationTime });
    if (out.length === PROFILE_COMMENTS) break;
  }
  return out;
}

/** Just enough to decide whether a profile page exists: null when missing. */
export const profileHeader = query({
  args: { username: v.string() },
  handler: async (
    ctx,
    { username },
  ): Promise<{ displayName: string; kind: "fan" | "artist"; banned: boolean } | null> => {
    const p = await profileByUsername(ctx, username);
    if (p === null) return null;
    return { displayName: p.displayName, kind: p.kind, banned: p.banned === true };
  },
});

/** Id and title of an unbanned profile's tracks, for the Report dialog. */
export const profileTrackTitles = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<Array<{ id: Id<"tracks">; title: string }>> => {
    const p = await profileByUsername(ctx, username);
    if (p === null || p.banned) return [];
    const rows = await ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", p._id))
      .take(MAX_TRACKS);
    return rows.map((t) => ({ id: t._id, title: t.title }));
  },
});

/**
 * Everything the public profile page shows. Null when the username does not
 * exist, { unavailable: true } when the profile is banned. Every read is
 * bounded. Nothing private (email, birth date, user or profile ids) is
 * returned. Track ids are public, for the player's Report links.
 */
export const getPublicProfile = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<PublicProfile | { unavailable: true } | null> => {
    const p = await profileByUsername(ctx, username);
    if (p === null) return null;
    if (p.banned) return { unavailable: true };

    const top8: PublicCard[] = [];
    for (const id of p.top8.slice(0, 8)) {
      const friend = await ctx.db.get(id);
      if (friend !== null && !friend.banned) top8.push(toPublicCard(friend));
    }

    const counted = await ctx.db
      .query("comments")
      .withIndex("by_profile", (q) => q.eq("profileId", p._id))
      .take(COMMENT_COUNT_CAP);

    const recentBulletins = await ctx.db
      .query("bulletins")
      .withIndex("by_author", (q) =>
        q.eq("authorId", p._id).gte("_creationTime", Date.now() - BULLETIN_WINDOW_MS),
      )
      .order("desc")
      .take(MAX_SCAN);
    const bulletin = recentBulletins.find((b) => !b.hidden);

    // Post rows carry no body, and this stops at the first visible one.
    let blog: Doc<"blogPosts"> | null = null;
    let scanned = 0;
    for await (const post of ctx.db
      .query("blogPosts")
      .withIndex("by_author", (q) => q.eq("authorId", p._id))
      .order("desc")) {
      if (!post.hidden) {
        blog = post;
        break;
      }
      if (++scanned >= MAX_SCAN) break;
    }

    const tracks: PublicProfile["tracks"] = [];
    const trackRows = await ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", p._id))
      .take(MAX_TRACKS);
    // No URLs here: tracks live in a private bucket, and the usercontent route
    // signs short-lived playback URLs at render time (media.playbackUrls).
    for (const t of trackRows) tracks.push({ id: t._id, title: t.title, url: null, autoplay: t.autoplay });

    const today = new Date().toISOString().slice(0, 10);
    const shows = await ctx.db
      .query("shows")
      .withIndex("by_profile_date", (q) => q.eq("profileId", p._id).gte("date", today))
      .take(MAX_SHOWS);

    const isArtist = p.kind === "artist";
    return {
      username: p.username,
      displayName: p.displayName,
      kind: p.kind,
      headline: p.headline,
      mood: p.mood ?? null,
      location: p.location,
      gender: p.gender,
      ...(isArtist || !isCalendarDate(p.birthDate) ? {} : { age: ageOn(p.birthDate, new Date()) }),
      genre: p.genre,
      aboutMe: p.aboutMe,
      whoIdLikeToMeet: p.whoIdLikeToMeet,
      interests: p.interests,
      band: p.band,
      photoUrl: photoUrl(p.photoKey),
      profileViews: (await statsFor(ctx, p._id))?.views ?? 0,
      lastLoginAt: p.lastLoginAt,
      memberSince: p._creationTime,
      friendCount: (await friendIds(ctx, p._id)).length,
      top8,
      comments: await profileComments(ctx, p),
      commentCount: counted.filter((c) => !c.hidden).length,
      latestBulletin: bulletin ? { body: bulletin.body, createdAt: bulletin._creationTime } : null,
      latestBlog: blog ? { id: blog._id, title: blog.title, createdAt: blog._creationTime } : null,
      tracks,
      shows: shows.map((s) => ({ date: s.date, venue: s.venue, city: s.city })),
      // Fans get CSS only. The renderer drops fan html and js too.
      custom: {
        css: p.customCss,
        html: isArtist ? p.customHtml : "",
        js: isArtist ? p.customJs : "",
      },
    };
  },
});

async function statsFor(ctx: QueryCtx | MutationCtx, profileId: Id<"profiles">) {
  return await ctx.db
    .query("profileStats")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

/**
 * Counts one view. The profile page calls this once per page load; no sign-in
 * needed. Writes only to profileStats, so queries reading profile docs don't
 * re-run. Signed-in viewers are limited per profile, anonymous ones share one
 * bucket split across 10 shards (600/min total). Over the limit the view is dropped without an error.
 */
export const recordView = mutation({
  args: { username: v.string() },
  returns: v.null(),
  handler: async (ctx, { username }) => {
    const p = await profileByUsername(ctx, username);
    if (p === null || p.banned) return null;
    const userId = await getAuthUserId(ctx);
    const viewer = userId === null ? null : await profileForUser(ctx, userId);
    const { ok } =
      viewer === null
        ? await rateLimiter.limit(ctx, "anonView")
        : await rateLimiter.limit(ctx, "view", { key: viewer._id });
    if (!ok) return null;
    const stats = await statsFor(ctx, p._id);
    if (stats === null) {
      await ctx.db.insert("profileStats", { profileId: p._id, views: 1 });
    } else {
      await ctx.db.patch(stats._id, { views: stats.views + 1 });
    }
    return null;
  },
});
