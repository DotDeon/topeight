import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { ageOn, isCalendarDate, normalizeUsername, validateUsername } from "../lib/validation";
import type { PublicProfile } from "../lib/profile/types";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { profileForUser, requireVerifiedUser } from "./lib/access";
import { BULLETIN_WINDOW_MS } from "./lib/bulletins";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { friendIds, friendshipPair } from "./lib/friendships";
import { MAX_SCAN } from "./lib/limits";
import { MAX_TRACKS, photoUrl, trackUrl } from "./lib/media";

const MIN_AGE = 13;
const MAX_DISPLAY_NAME = 50;

function blankProfileFields() {
  return {
    headline: "",
    location: "",
    aboutMe: "",
    whoIdLikeToMeet: "",
    profileViews: 0,
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
    if (profile !== null) {
      await ctx.db.patch(profile._id, { lastLoginAt: Date.now() });
    }
    return null;
  },
});

// ---------------------------------------------------------------- public profile

const PROFILE_COMMENTS = 10;
/** Comments are counted up to this many; the renderer shows more than 1000 as "1000+". */
const COMMENT_COUNT_CAP = 1001;
const MAX_SHOWS = 20;

async function profileByUsername(ctx: QueryCtx | MutationCtx, raw: string): Promise<Doc<"profiles"> | null> {
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

/**
 * Everything the public profile page shows. Null when the username does not
 * exist, { unavailable: true } when the profile is banned. Every read is
 * bounded. Nothing private (email, birth date, ids) is returned.
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

    const tracks: PublicProfile["tracks"] = [];
    const trackRows = await ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", p._id))
      .take(MAX_TRACKS);
    for (const t of trackRows) {
      const url = trackUrl(t.key);
      if (url) tracks.push({ title: t.title, url, autoplay: t.autoplay });
    }

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
      location: p.location,
      gender: p.gender,
      genre: p.genre,
      aboutMe: p.aboutMe,
      whoIdLikeToMeet: p.whoIdLikeToMeet,
      interests: p.interests,
      band: p.band,
      photoUrl: photoUrl(p.photoKey),
      profileViews: p.profileViews,
      lastLoginAt: p.lastLoginAt,
      memberSince: p._creationTime,
      friendCount: (await friendIds(ctx, p._id)).length,
      top8,
      comments: await profileComments(ctx, p),
      commentCount: counted.filter((c) => !c.hidden).length,
      latestBulletin: bulletin ? { body: bulletin.body, createdAt: bulletin._creationTime } : null,
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

/** Counts one view. The profile page calls this once per page load; no sign-in needed. */
export const recordView = mutation({
  args: { username: v.string() },
  returns: v.null(),
  handler: async (ctx, { username }) => {
    const p = await profileByUsername(ctx, username);
    if (p !== null && !p.banned) {
      await ctx.db.patch(p._id, { profileViews: p.profileViews + 1 });
    }
    return null;
  },
});
