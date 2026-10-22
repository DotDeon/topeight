import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { profileForUser } from "./lib/access";
import { friendBulletins } from "./lib/bulletins";
import { toPublicCard, toPublicCardOnline, type PublicCard } from "./lib/cards";
import { onlineAsOf } from "./lib/presence";

const CARD_COUNT = 5;
const DASHBOARD_BULLETINS = 5;
/** Rows read per box: the cards plus room to skip banned and house accounts. */
const SCAN_LIMIT = CARD_COUNT + 50;

/**
 * The 5 newest unbanned fans with a photo. The house account is left out.
 * `asOf` is the caller's current minute, for the online flags only.
 */
export const coolNewPeople = query({
  args: { asOf: v.optional(v.number()) },
  handler: async (ctx, { asOf }): Promise<PublicCard[]> => {
    const cards: PublicCard[] = [];
    const now = onlineAsOf(asOf);
    const fans = ctx.db
      .query("profiles")
      .withIndex("by_kind_photo", (q) => q.eq("kind", "fan").eq("hasPhoto", true))
      .order("desc");
    let scanned = 0;
    for await (const p of fans) {
      if (++scanned > SCAN_LIMIT) break;
      if (p.banned || p.isHouse) continue;
      cards.push(await toPublicCardOnline(ctx, p, now));
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
    const artists = ctx.db
      .query("profiles")
      .withIndex("by_kind_tracks", (q) => q.eq("kind", "artist").eq("hasTracks", true))
      .order("desc");
    let scanned = 0;
    for await (const p of artists) {
      if (++scanned > SCAN_LIMIT) break;
      if (p.banned || p.isHouse) continue;
      cards.push(toPublicCard(p));
      if (cards.length === CARD_COUNT) break;
    }
    return cards;
  },
});

/** Signed-in homepage data, or null when signed out, unverified, without a profile or banned. */
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null || user.emailVerificationTime === undefined) return null;
    const me = await profileForUser(ctx, userId);
    if (me === null || me.banned) return null;
    const pending = await ctx.db
      .query("friendRequests")
      .withIndex("by_to_status", (q) => q.eq("to", me._id).eq("status", "pending"))
      .order("desc")
      .take(20);
    const pendingRequests: (PublicCard & { requestId: Id<"friendRequests"> })[] = [];
    for (const r of pending) {
      const from = await ctx.db.get(r.from);
      if (from !== null && !from.banned) pendingRequests.push({ ...toPublicCard(from), requestId: r._id });
    }
    const pendingLinks = await ctx.db
      .query("links")
      .withIndex("by_artist_status", (q) => q.eq("artistId", me._id).eq("status", "pending"))
      .order("desc")
      .take(20);
    const linkRequests: (PublicCard & { linkId: Id<"links">; type: "venue" | "label" })[] = [];
    for (const r of pendingLinks) {
      const from = await ctx.db.get(r.fromId);
      if (from !== null && !from.banned) linkRequests.push({ ...toPublicCard(from), linkId: r._id, type: r.type });
    }
    return {
      me: toPublicCard(me),
      pendingRequests,
      linkRequests,
      bulletins: await friendBulletins(ctx, me._id, { limit: DASHBOARD_BULLETINS }),
    };
  },
});
