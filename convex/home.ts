import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { profileForUser } from "./lib/access";
import { friendBulletins } from "./lib/bulletins";
import { toPublicCard, toPublicCardOnline, type PublicCard } from "./lib/cards";
import { onlineAsOf } from "./lib/presence";

const CARD_COUNT = 5;
const DASHBOARD_BULLETINS = 5;
/** Rows read per box: the cards plus room to skip banned and house accounts. */
const SCAN_LIMIT = CARD_COUNT + 50;

/**
 * The newest unbanned, non-house profiles of one kind with the flag set or unset,
 * newest first. Reads at most SCAN_LIMIT rows per index range. An unset flag also
 * matches rows where the flag was never written.
 */
async function newest(
  ctx: QueryCtx,
  kind: "fan" | "artist",
  flag: "hasPhoto" | "hasTracks",
  value: boolean,
  limit: number,
): Promise<Doc<"profiles">[]> {
  const read = (v: boolean | undefined) =>
    (flag === "hasPhoto"
      ? ctx.db.query("profiles").withIndex("by_kind_photo", (q) => q.eq("kind", kind).eq("hasPhoto", v))
      : ctx.db.query("profiles").withIndex("by_kind_tracks", (q) => q.eq("kind", kind).eq("hasTracks", v))
    )
      .order("desc")
      .take(SCAN_LIMIT);
  const rows = value ? await read(true) : [...(await read(false)), ...(await read(undefined))];
  return rows
    .filter((p) => !p.banned && !p.isHouse)
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, limit);
}

/** Up to 5 profiles with the flag set, then the newest without it to fill the rest. */
async function newestFilled(
  ctx: QueryCtx,
  kind: "fan" | "artist",
  flag: "hasPhoto" | "hasTracks",
): Promise<Doc<"profiles">[]> {
  const rows = await newest(ctx, kind, flag, true, CARD_COUNT);
  if (rows.length < CARD_COUNT) rows.push(...(await newest(ctx, kind, flag, false, CARD_COUNT - rows.length)));
  return rows;
}

/**
 * The 5 newest unbanned fans. Fans with a photo come first; photoless fans
 * fill any slots left over. The house account is left out.
 * `asOf` is the caller's current minute, for the online flags only.
 */
export const coolNewPeople = query({
  args: { asOf: v.optional(v.number()) },
  handler: async (ctx, { asOf }): Promise<PublicCard[]> => {
    const now = onlineAsOf(asOf);
    const fans = await newestFilled(ctx, "fan", "hasPhoto");
    return await Promise.all(fans.map((p) => toPublicCardOnline(ctx, p, now)));
  },
});

/**
 * The 5 newest unbanned artists. Artists with at least one track come first;
 * artists without tracks fill any slots left over.
 */
export const coolNewMusic = query({
  args: {},
  handler: async (ctx): Promise<PublicCard[]> => {
    const artists = await newestFilled(ctx, "artist", "hasTracks");
    return artists.map(toPublicCard);
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
