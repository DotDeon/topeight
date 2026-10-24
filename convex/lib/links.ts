import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_SCAN } from "./limits";

type Ctx = QueryCtx | MutationCtx;

/** Most accepted links read for one profile: a roster, a label's bands or a band's venues and labels. */
export const MAX_LINKS = MAX_SCAN;

/** Days a declined venue or label waits before asking the same band again. */
export const LINK_DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** The link row between a venue or label and an artist, whatever its status. One row per pair. */
export async function linkBetween(ctx: Ctx, fromId: Id<"profiles">, artistId: Id<"profiles">) {
  return await ctx.db
    .query("links")
    .withIndex("by_pair", (q) => q.eq("fromId", fromId).eq("artistId", artistId))
    .first();
}

/** True when the artist accepted this venue's or label's request. */
export async function isLinked(ctx: Ctx, fromId: Id<"profiles">, artistId: Id<"profiles">): Promise<boolean> {
  return (await linkBetween(ctx, fromId, artistId))?.status === "accepted";
}

/**
 * The unbanned profiles on the other side of `profile`'s accepted links, oldest
 * link first. `side` is the side `profile` is on: "from" for a venue or label
 * (gives its bands), "artist" for a band (gives its venues and labels).
 */
export async function acceptedLinks(
  ctx: Ctx,
  profile: Doc<"profiles">,
  side: "from" | "artist",
  max = MAX_LINKS,
): Promise<Array<{ link: Doc<"links">; other: Doc<"profiles"> }>> {
  const rows =
    side === "from"
      ? await ctx.db
          .query("links")
          .withIndex("by_from_status", (q) => q.eq("fromId", profile._id).eq("status", "accepted"))
          .take(max)
      : await ctx.db
          .query("links")
          .withIndex("by_artist_status", (q) => q.eq("artistId", profile._id).eq("status", "accepted"))
          .take(max);
  const out: Array<{ link: Doc<"links">; other: Doc<"profiles"> }> = [];
  for (const link of rows) {
    const other = await ctx.db.get(side === "from" ? link.artistId : link.fromId);
    if (other !== null && !other.banned) out.push({ link, other });
  }
  return out;
}

/**
 * Deletes every link row between two profiles, in either direction, and takes
 * the band off the venue's gigs that haven't started, as leaving the roster does. For blocks.
 */
export async function deleteLinksBetween(ctx: MutationCtx, a: Id<"profiles">, b: Id<"profiles">): Promise<void> {
  for (const [from, artist] of [
    [a, b],
    [b, a],
  ] as const) {
    const row = await linkBetween(ctx, from, artist);
    if (row === null) continue;
    await ctx.db.delete(row._id);
    if (row.type === "venue") await dropFromFutureGigs(ctx, from, artist);
  }
}

/** Most future gigs one roster removal takes a band off. */
const MAX_DROPPED_GIGS = MAX_SCAN;

/** Takes a band off a venue's gigs that haven't started. Past gigs keep it. */
export async function dropFromFutureGigs(
  ctx: MutationCtx,
  venueId: Id<"profiles">,
  artistId: Id<"profiles">,
): Promise<void> {
  const rows = await ctx.db
    .query("gigArtists")
    .withIndex("by_host_artist", (q) =>
      q.eq("hostId", venueId).eq("artistId", artistId).gt("startsAt", Date.now()),
    )
    .take(MAX_DROPPED_GIGS);
  for (const row of rows) await ctx.db.delete(row._id);
}
