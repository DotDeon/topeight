import { v } from "convex/values";
import { query } from "./_generated/server";
import { toPublicCard, type PublicCard } from "./lib/cards";

/** Shows from today onward, soonest first. Banned artists are left out. */
export const upcoming = query({
  args: { limit: v.number() },
  handler: async (
    ctx,
    { limit },
  ): Promise<Array<{ date: string; venue: string; city: string; artist: PublicCard }>> => {
    const today = new Date().toISOString().slice(0, 10);
    const rows: Array<{ date: string; venue: string; city: string; artist: PublicCard }> = [];
    const shows = ctx.db.query("shows").withIndex("by_date", (q) => q.gte("date", today));
    for await (const s of shows) {
      const artist = await ctx.db.get(s.profileId);
      if (artist === null || artist.banned) continue;
      rows.push({ date: s.date, venue: s.venue, city: s.city, artist: toPublicCard(artist) });
      if (rows.length >= Math.max(0, Math.floor(limit))) break;
    }
    return rows;
  },
});
