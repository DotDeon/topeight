import { v } from "convex/values";
import { query } from "./_generated/server";
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
