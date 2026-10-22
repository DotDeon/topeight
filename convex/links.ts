import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isBlockedEitherWay, profileForUser, requireProfile, viewerProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { acceptedLinks, dropFromFutureGigs, LINK_DECLINE_COOLDOWN_MS, linkBetween, MAX_LINKS } from "./lib/links";
import { profileByUsername } from "./profiles";

type LinkType = "venue" | "label";
export type LinkCard = PublicCard & { id: Id<"profiles"> };
export type LinkState = "none" | "pending" | "accepted" | "cooldown";

function senderType(p: Doc<"profiles">): LinkType | null {
  return p.kind === "venue" || p.kind === "label" ? p.kind : null;
}

/** A venue asks a band onto its roster, or a label asks to be a band's label. 50 an hour. */
export const request = mutation({
  args: { artist: v.id("profiles") },
  returns: v.literal("sent"),
  handler: async (ctx, { artist }): Promise<"sent"> => {
    const me = await requireProfile(ctx);
    const type = senderType(me);
    if (type === null || artist === me._id) throw new ConvexError("Not allowed");
    const band = await ctx.db.get(artist);
    if (band === null || band.banned) throw new ConvexError("Profile not found");
    if (band.kind !== "artist") throw new ConvexError("Not allowed");
    if (await isBlockedEitherWay(ctx, me._id, artist)) throw new ConvexError("Not allowed");

    const existing = await linkBetween(ctx, me._id, artist);
    if (existing?.status === "accepted") throw new ConvexError("Already linked");
    if (existing?.status === "pending") throw new ConvexError("Request already sent");
    if (existing?.status === "declined") {
      if (Date.now() - (existing.respondedAt ?? 0) < LINK_DECLINE_COOLDOWN_MS) {
        throw new ConvexError("Request already sent");
      }
    }

    const { ok } = await rateLimiter.limit(ctx, "linkRequest", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");

    if (existing !== null) await ctx.db.delete(existing._id);
    await ctx.db.insert("links", { fromId: me._id, artistId: artist, type, status: "pending" });
    return "sent";
  },
});

/** The band accepts or declines a pending request. */
export const respond = mutation({
  args: { linkId: v.id("links"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { linkId, accept }) => {
    const me = await requireProfile(ctx);
    const link = await ctx.db.get(linkId);
    if (link === null || link.artistId !== me._id) throw new ConvexError("Not allowed");
    if (link.status !== "pending") return null;
    if (!accept) {
      await ctx.db.patch(linkId, { status: "declined", respondedAt: Date.now() });
      return null;
    }
    const sender = await ctx.db.get(link.fromId);
    if (sender === null || sender.banned) throw new ConvexError("Profile not found");
    if (await isBlockedEitherWay(ctx, me._id, link.fromId)) throw new ConvexError("Not allowed");
    await ctx.db.patch(linkId, { status: "accepted", respondedAt: Date.now() });
    return null;
  },
});

/**
 * Ends an accepted link, or withdraws a pending one. Either side may call it.
 * Leaving a venue's roster also takes the band off that venue's gigs that
 * haven't started.
 */
export const remove = mutation({
  args: { other: v.id("profiles") },
  returns: v.null(),
  handler: async (ctx, { other }) => {
    const me = await requireProfile(ctx);
    const link = (await linkBetween(ctx, me._id, other)) ?? (await linkBetween(ctx, other, me._id));
    if (link === null || link.status === "declined") return null;
    await ctx.db.delete(link._id);
    if (link.type === "venue" && link.status === "accepted") {
      await dropFromFutureGigs(ctx, link.fromId, link.artistId);
    }
    return null;
  },
});

/**
 * Where the signed-in venue or label stands with an artist, for the request
 * button on the artist's page. Null unless the viewer is a venue or label and
 * the profile is an unbanned artist other than the viewer.
 */
export const status = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<{ type: LinkType; state: LinkState } | null> => {
    const me = await viewerProfile(ctx);
    const type = me === null ? null : senderType(me);
    if (me === null || type === null) return null;
    const band = await profileByUsername(ctx, username);
    if (band === null || band.banned || band.kind !== "artist") return null;
    const link = await linkBetween(ctx, me._id, band._id);
    let state: LinkState = "none";
    if (link?.status === "accepted" || link?.status === "pending") state = link.status;
    else if (link?.status === "declined" && Date.now() - (link.respondedAt ?? 0) < LINK_DECLINE_COOLDOWN_MS) {
      state = "cooldown";
    }
    return { type, state };
  },
});

const toLinkCard = (p: Doc<"profiles">): LinkCard => ({ ...toPublicCard(p), id: p._id });

/**
 * The caller's links for Edit Profile. Venues and labels get their accepted
 * bands (roster) and pending requests (outgoing). Artists get the venues and
 * labels they accepted. Banned profiles are left out. Empty when signed out.
 */
export const mine = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ roster: LinkCard[]; outgoing: LinkCard[]; venues: LinkCard[]; labels: LinkCard[] }> => {
    const out = { roster: [] as LinkCard[], outgoing: [] as LinkCard[], venues: [] as LinkCard[], labels: [] as LinkCard[] };
    const userId = await getAuthUserId(ctx);
    if (userId === null) return out;
    const me = await profileForUser(ctx, userId);
    if (me === null || me.banned) return out;
    if (senderType(me) !== null) {
      out.roster = (await acceptedLinks(ctx, me, "from")).map(({ other }) => toLinkCard(other));
      const pending = await ctx.db
        .query("links")
        .withIndex("by_from_status", (q) => q.eq("fromId", me._id).eq("status", "pending"))
        .take(MAX_LINKS);
      for (const row of pending) {
        const band = await ctx.db.get(row.artistId);
        if (band !== null && !band.banned) out.outgoing.push(toLinkCard(band));
      }
    } else if (me.kind === "artist") {
      for (const { link, other } of await acceptedLinks(ctx, me, "artist")) {
        (link.type === "venue" ? out.venues : out.labels).push(toLinkCard(other));
      }
    }
    return out;
  },
});
