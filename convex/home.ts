import { query } from "./_generated/server";
import { requireProfile } from "./lib/access";
import { friendBulletins } from "./lib/bulletins";
import { toPublicCard, type PublicCard } from "./lib/cards";

const CARD_COUNT = 5;
const DASHBOARD_BULLETINS = 5;

/** The 5 newest unbanned fans with a photo. The house account is left out. */
export const coolNewPeople = query({
  args: {},
  handler: async (ctx): Promise<PublicCard[]> => {
    const cards: PublicCard[] = [];
    const fans = ctx.db.query("profiles").withIndex("by_kind_creation", (q) => q.eq("kind", "fan")).order("desc");
    for await (const p of fans) {
      if (p.banned || p.isHouse || !p.photoKey) continue;
      cards.push(toPublicCard(p));
      if (cards.length === CARD_COUNT) break;
    }
    return cards;
  },
});

/** The 5 newest unbanned artists with at least one track. */
export const coolNewMusic = query({
  args: {},
  handler: async (ctx): Promise<PublicCard[]> => {
    const cards: PublicCard[] = [];
    const artists = ctx.db.query("profiles").withIndex("by_kind_creation", (q) => q.eq("kind", "artist")).order("desc");
    for await (const p of artists) {
      if (p.banned || p.isHouse) continue;
      const track = await ctx.db
        .query("tracks")
        .withIndex("by_profile_order", (q) => q.eq("profileId", p._id))
        .first();
      if (track === null) continue;
      cards.push(toPublicCard(p));
      if (cards.length === CARD_COUNT) break;
    }
    return cards;
  },
});

/** Signed-in homepage data. Throws when signed out, so clients skip it then. */
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireProfile(ctx);
    const pending = await ctx.db
      .query("friendRequests")
      .withIndex("by_to_status", (q) => q.eq("to", me._id).eq("status", "pending"))
      .order("desc")
      .take(20);
    const pendingRequests: PublicCard[] = [];
    for (const r of pending) {
      const from = await ctx.db.get(r.from);
      if (from !== null && !from.banned) pendingRequests.push(toPublicCard(from));
    }
    return {
      me: toPublicCard(me),
      pendingRequests,
      bulletins: await friendBulletins(ctx, me._id, { limit: DASHBOARD_BULLETINS }),
    };
  },
});
