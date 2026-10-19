import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { ageOn, isCalendarDate, normalizeUsername, validateUsername } from "../lib/validation";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { profileForUser, requireVerifiedUser } from "./lib/access";
import { friendshipPair } from "./lib/friendships";

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
