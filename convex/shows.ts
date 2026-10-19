import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { isCalendarDate } from "../lib/validation";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { profileForUser, requireProfile } from "./lib/access";
import { MAX_SCAN } from "./lib/limits";
import { toPublicCard, type PublicCard } from "./lib/cards";

/** Shows from today onward, soonest first. Banned artists are left out. */
export const upcoming = query({
  args: { limit: v.number() },
  handler: async (
    ctx,
    { limit },
  ): Promise<Array<{ date: string; venue: string; city: string; artist: PublicCard }>> => {
    const want = Math.min(20, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1)));
    const today = new Date().toISOString().slice(0, 10);
    const rows: Array<{ date: string; venue: string; city: string; artist: PublicCard }> = [];
    const shows = await ctx.db
      .query("shows")
      .withIndex("by_date", (q) => q.gte("date", today))
      .take(MAX_SCAN);
    for (const s of shows) {
      const artist = await ctx.db.get(s.profileId);
      if (artist === null || artist.banned) continue;
      rows.push({ date: s.date, venue: s.venue, city: s.city, artist: toPublicCard(artist) });
      if (rows.length >= want) break;
    }
    return rows;
  },
});

const MAX_UPCOMING = 50;

function place(raw: string, label: string): string {
  const value = raw.trim();
  if (value === "") throw new ConvexError(`${label} is required`);
  if (value.length > 100) throw new ConvexError(`${label} is too long`);
  return value;
}

/** The caller's upcoming shows, soonest first. */
export const mine = query({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"shows">; date: string; venue: string; city: string }>> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const profile = await profileForUser(ctx, userId);
    if (profile === null) return [];
    const today = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db
      .query("shows")
      .withIndex("by_profile_date", (q) => q.eq("profileId", profile._id).gte("date", today))
      .take(MAX_UPCOMING);
    return rows.map((s) => ({ id: s._id, date: s.date, venue: s.venue, city: s.city }));
  },
});

export const add = mutation({
  args: { date: v.string(), venue: v.string(), city: v.string() },
  returns: v.id("shows"),
  handler: async (ctx, { date, venue, city }) => {
    const me = await requireProfile(ctx);
    if (me.kind !== "artist") throw new ConvexError("Only artists can add shows");
    const today = new Date().toISOString().slice(0, 10);
    if (!isCalendarDate(date) || date < today) throw new ConvexError("Invalid date");
    const cleanVenue = place(venue, "Venue");
    const cleanCity = place(city, "City");
    const upcoming = await ctx.db
      .query("shows")
      .withIndex("by_profile_date", (q) => q.eq("profileId", me._id).gte("date", today))
      .take(MAX_UPCOMING);
    if (upcoming.length >= MAX_UPCOMING) throw new ConvexError("Too many shows");
    return await ctx.db.insert("shows", { profileId: me._id, date, venue: cleanVenue, city: cleanCity });
  },
});

export const remove = mutation({
  args: { showId: v.id("shows") },
  returns: v.null(),
  handler: async (ctx, { showId }) => {
    const me = await requireProfile(ctx);
    const show = await ctx.db.get(showId);
    if (show === null || show.profileId !== me._id) throw new ConvexError("Not allowed");
    await ctx.db.delete(showId);
    return null;
  },
});
