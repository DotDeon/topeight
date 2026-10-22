import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { canonicalTimeZone, isTimeOfDay, isTimeZone, toUtc } from "../lib/eventTime";
import { isCalendarDate } from "../lib/validation";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { isBlockedEitherWay, profileForUser, requireProfile } from "./lib/access";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { rateLimiter } from "./lib/limits";
import { checkBody, checkLinks } from "./lib/posting";
import { countField } from "./lib/rsvps";
import { profileKind } from "./lib/kinds";

const MAX_TITLE = 100;
const MAX_PLACE = 100;
const MAX_DESCRIPTION = 5000;
const MAX_IMAGE_URL = 500;
/** Rows read from each source (events, shows) per page of upcoming. */
const SOURCE_READ = 100;
const PAGE_SIZE = 50;
/** Going cards on the event page. */
const GRID_SIZE = 24;
/** Going rows read to fill the grid, so banned or blocked members can be skipped. */
const GRID_READ = 100;
/** Upcoming hosted events and RSVPs myEvents reads. */
const MY_HOSTED = 50;
const MY_RSVPS = 200;

type Ctx = QueryCtx | MutationCtx;
type Status = "going" | "maybe";

const cardValidator = v.object({
  username: v.string(),
  displayName: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  kind: profileKind,
});
const statusValidator = v.union(v.literal("going"), v.literal("maybe"));

const eventItem = v.object({
  kind: v.literal("event"),
  id: v.id("events"),
  title: v.string(),
  startsAt: v.number(),
  timeZone: v.string(),
  venue: v.string(),
  city: v.string(),
  host: cardValidator,
  going: v.number(),
  cancelled: v.boolean(),
});
const showItem = v.object({
  kind: v.literal("show"),
  id: v.id("shows"),
  artist: cardValidator,
  date: v.string(),
  /** 00:00 UTC on the show's date. Shows have no time or zone, so they count as all day. */
  startsAt: v.number(),
  venue: v.string(),
  city: v.string(),
});
const cursorValidator = v.object({ startsAt: v.number(), skip: v.number() });

export type EventItem = {
  kind: "event";
  id: Id<"events">;
  title: string;
  startsAt: number;
  timeZone: string;
  venue: string;
  city: string;
  host: PublicCard;
  going: number;
  cancelled: boolean;
};
export type ShowItem = {
  kind: "show";
  id: Id<"shows">;
  artist: PublicCard;
  date: string;
  startsAt: number;
  venue: string;
  city: string;
};
export type UpcomingItem = EventItem | ShowItem;
/**
 * Where the next page starts: the start of the last item shown, and how many
 * items at exactly that start were already shown.
 */
export type UpcomingCursor = { startsAt: number; skip: number };

export type EventView = {
  id: Id<"events">;
  title: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  startsAt: number;
  venue: string;
  city: string;
  description: string;
  imageUrl?: string;
  cancelled: boolean;
  host: PublicCard;
  going: number;
  maybe: number;
  /** Up to 24 members going. */
  attendees: PublicCard[];
  myStatus: Status | null;
  canEdit: boolean;
};

export type MyEvent = EventItem & { role: "host" | Status };

/** The signed-in, unbanned viewer, or null. */
async function viewerProfile(ctx: Ctx): Promise<Doc<"profiles"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const p = await profileForUser(ctx, userId);
  return p === null || p.banned ? null : p;
}

/** The event and its host when it is visible: not hidden, host not banned. */
async function visibleEvent(
  ctx: Ctx,
  id: Id<"events">,
): Promise<{ event: Doc<"events">; host: Doc<"profiles"> } | null> {
  const event = await ctx.db.get(id);
  if (event === null || event.hidden) return null;
  const host = await ctx.db.get(event.hostId);
  if (host === null || host.banned) return null;
  return { event, host };
}

export function cityKeyOf(city: string): string {
  return city.trim().toLowerCase();
}

type EventArgs = {
  title: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  venue: string;
  city: string;
  description: string;
  imageUrl?: string;
};

/** Checked, trimmed event columns. Throws on any limit, a bad date, time or zone, a past start, or the link rule. */
function checkEvent(me: Doc<"profiles">, args: EventArgs) {
  const title = checkBody(args.title, "Title", MAX_TITLE);
  const venue = checkBody(args.venue, "Venue", MAX_PLACE);
  const city = checkBody(args.city, "City", MAX_PLACE);
  const description = args.description.trim();
  if (description.length > MAX_DESCRIPTION) throw new ConvexError("Description is too long");
  if (!isCalendarDate(args.localDate)) throw new ConvexError("Invalid date");
  if (!isTimeOfDay(args.localTime)) throw new ConvexError("Invalid time");
  if (!isTimeZone(args.timeZone)) throw new ConvexError("Invalid timezone");
  const timeZone = canonicalTimeZone(args.timeZone);
  const startsAt = toUtc(args.localDate, args.localTime, timeZone);
  if (startsAt <= Date.now()) throw new ConvexError("Event must be in the future");
  const imageUrl = args.imageUrl?.trim() || undefined;
  if (imageUrl !== undefined && !isImageUrl(imageUrl)) {
    throw new ConvexError("Image link must start with http:// or https://");
  }
  checkLinks(me, description);
  if (imageUrl !== undefined) checkLinks(me, imageUrl);
  return {
    title,
    localDate: args.localDate,
    localTime: args.localTime,
    timeZone,
    startsAt,
    venue,
    city,
    cityKey: cityKeyOf(city),
    description,
    imageUrl,
  };
}

function isImageUrl(value: string): boolean {
  if (value.length > MAX_IMAGE_URL || !/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** The visible event if `me` hosts it. Hidden events are "Not found" to their host too. */
async function ownEvent(ctx: MutationCtx, me: Doc<"profiles">, id: Id<"events">): Promise<Doc<"events">> {
  const event = await ctx.db.get(id);
  if (event === null || event.hidden) throw new ConvexError("Not found");
  if (event.hostId !== me._id) throw new ConvexError("Not allowed");
  return event;
}

function toEventItem(event: Doc<"events">, host: Doc<"profiles">): EventItem {
  return {
    kind: "event",
    id: event._id,
    title: event.title,
    startsAt: event.startsAt,
    timeZone: event.timeZone,
    venue: event.venue,
    city: event.city,
    host: toPublicCard(host),
    going: event.goingCount,
    cancelled: event.cancelled,
  };
}

const eventArgs = {
  title: v.string(),
  localDate: v.string(),
  localTime: v.string(),
  timeZone: v.string(),
  venue: v.string(),
  city: v.string(),
  description: v.string(),
  imageUrl: v.optional(v.string()),
};

/** Posts an event. Five a day; refused events cost no quota. */
export const create = mutation({
  args: eventArgs,
  returns: v.id("events"),
  handler: async (ctx, args) => {
    const me = await requireProfile(ctx);
    const fields = checkEvent(me, args);
    const { ok } = await rateLimiter.limit(ctx, "eventCreate", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    return await ctx.db.insert("events", {
      hostId: me._id,
      ...fields,
      cancelled: false,
      hidden: false,
      goingCount: 0,
      maybeCount: 0,
    });
  },
});

/** Replaces an event's fields. An image left out is removed. Host only, 30 an hour. */
export const update = mutation({
  args: { id: v.id("events"), ...eventArgs },
  returns: v.null(),
  handler: async (ctx, { id, ...args }) => {
    const me = await requireProfile(ctx);
    await ownEvent(ctx, me, id);
    const fields = checkEvent(me, args);
    const { ok } = await rateLimiter.limit(ctx, "eventEdit", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");
    await ctx.db.patch(id, fields);
    return null;
  },
});

/** Marks an event cancelled. It stays listed, flagged. Host only. */
export const cancel = mutation({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const me = await requireProfile(ctx);
    const event = await ownEvent(ctx, me, id);
    if (!event.cancelled) await ctx.db.patch(id, { cancelled: true });
    return null;
  },
});

/**
 * Sets or clears the viewer's answer. A new answer needs an event that is
 * visible, not cancelled and not started, and no block either way with the
 * host. Clearing always works on a visible event.
 */
export const rsvp = mutation({
  args: { eventId: v.id("events"), status: v.union(statusValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, { eventId, status }) => {
    const me = await requireProfile(ctx);
    const found = await visibleEvent(ctx, eventId);
    if (found === null) throw new ConvexError("Not found");
    const { event, host } = found;
    if (status !== null) {
      if (event.cancelled) throw new ConvexError("Event is cancelled");
      if (event.startsAt <= Date.now()) throw new ConvexError("Event has already started");
      if (host._id !== me._id && (await isBlockedEitherWay(ctx, me._id, host._id))) {
        throw new ConvexError("Not allowed");
      }
    }
    const row = await ctx.db
      .query("rsvps")
      .withIndex("by_pair", (q) => q.eq("profileId", me._id).eq("eventId", eventId))
      .unique();
    const old = row?.status ?? null;
    if (old === status) return null;
    const { ok } = await rateLimiter.limit(ctx, "rsvp", { key: me._id });
    if (!ok) throw new ConvexError("Slow down");

    const counts = { goingCount: event.goingCount, maybeCount: event.maybeCount };
    if (old !== null) counts[countField(old)] = Math.max(0, counts[countField(old)] - 1);
    if (status !== null) counts[countField(status)] += 1;
    await ctx.db.patch(eventId, counts);

    if (row === null) await ctx.db.insert("rsvps", { eventId, profileId: me._id, status: status! });
    else if (status === null) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, { status });
    return null;
  },
});

/**
 * One event, or null when the id is malformed, the event is hidden or its
 * host is banned. Counts are kept on the event and leave out banned members.
 * The grid holds up to 24 members going, skipping banned members and, for a
 * signed-in viewer, anyone blocked either way.
 */
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.object({
      id: v.id("events"),
      title: v.string(),
      localDate: v.string(),
      localTime: v.string(),
      timeZone: v.string(),
      startsAt: v.number(),
      venue: v.string(),
      city: v.string(),
      description: v.string(),
      imageUrl: v.optional(v.string()),
      cancelled: v.boolean(),
      host: cardValidator,
      going: v.number(),
      maybe: v.number(),
      attendees: v.array(cardValidator),
      myStatus: v.union(statusValidator, v.null()),
      canEdit: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }): Promise<EventView | null> => {
    const eventId = ctx.db.normalizeId("events", id);
    if (eventId === null) return null;
    const found = await visibleEvent(ctx, eventId);
    if (found === null) return null;
    const { event, host } = found;
    const viewer = await viewerProfile(ctx);

    const going = await ctx.db
      .query("rsvps")
      .withIndex("by_event_status", (q) => q.eq("eventId", eventId).eq("status", "going"))
      .take(GRID_READ);
    const attendees: PublicCard[] = [];
    for (const r of going) {
      if (attendees.length >= GRID_SIZE) break;
      const p = await ctx.db.get(r.profileId);
      if (p === null || p.banned) continue;
      if (viewer !== null && p._id !== viewer._id && (await isBlockedEitherWay(ctx, viewer._id, p._id))) continue;
      attendees.push(toPublicCard(p));
    }

    let myStatus: Status | null = null;
    if (viewer !== null) {
      const mine = await ctx.db
        .query("rsvps")
        .withIndex("by_pair", (q) => q.eq("profileId", viewer._id).eq("eventId", eventId))
        .unique();
      myStatus = mine?.status ?? null;
    }

    return {
      id: event._id,
      title: event.title,
      localDate: event.localDate,
      localTime: event.localTime,
      timeZone: event.timeZone,
      startsAt: event.startsAt,
      venue: event.venue,
      city: event.city,
      description: event.description,
      ...(event.imageUrl ? { imageUrl: event.imageUrl } : {}),
      cancelled: event.cancelled,
      host: toPublicCard(host),
      going: event.goingCount,
      maybe: event.maybeCount,
      attendees,
      myStatus,
      canEdit: viewer !== null && viewer._id === event.hostId,
    };
  },
});

/** 00:00 UTC on a "YYYY-MM-DD" date. */
function showStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Upcoming events (not yet started) and artist shows (from today, UTC),
 * soonest first, 50 a page. With `city`, both are filtered on the lowercased,
 * trimmed city. Cancelled events stay in, flagged; hidden events, banned hosts
 * and banned artists are left out.
 *
 * Each page reads at most 100 rows per source from the cursor on. When a
 * source fills its 100, the page stops before that source's last start, since
 * rows after it are unread. Ties sort events before shows, then by creation,
 * and the cursor's `skip` counts the items already shown at its start. A run
 * of more than 100 rows at one instant in one source is skipped past rather
 * than shown in full.
 */
export const upcoming = query({
  args: { city: v.optional(v.string()), cursor: v.optional(cursorValidator) },
  returns: v.object({
    items: v.array(v.union(eventItem, showItem)),
    nextCursor: v.union(cursorValidator, v.null()),
  }),
  handler: async (ctx, { city, cursor }): Promise<{ items: UpcomingItem[]; nextCursor: UpcomingCursor | null }> => {
    if (cursor && !Number.isFinite(cursor.startsAt)) return { items: [], nextCursor: null };
    const now = Date.now();
    const cityKey = city === undefined ? "" : cityKeyOf(city);
    const today = new Date(now).toISOString().slice(0, 10);
    const from = cursor?.startsAt ?? 0;
    const skip = cursor && Number.isFinite(cursor.skip) ? Math.max(0, Math.floor(cursor.skip)) : 0;

    const eventFrom = Math.max(now, from);
    const eventRows = await (cityKey
      ? ctx.db
          .query("events")
          .withIndex("by_city_start", (q) => q.eq("cityKey", cityKey).gte("startsAt", eventFrom))
      : ctx.db.query("events").withIndex("by_start", (q) => q.gte("startsAt", eventFrom))
    ).take(SOURCE_READ);

    const fromDate = cursor ? new Date(from).toISOString().slice(0, 10) : today;
    const showFrom = fromDate > today ? fromDate : today;
    const showRows = await ctx.db
      .query("shows")
      .withIndex("by_date", (q) => q.gte("date", showFrom))
      .take(SOURCE_READ);

    // Rows past the last start of a full source might sort before rows it never read,
    // so the page stops before that start. When a full source read nothing but that
    // one instant, the page includes it instead of stalling.
    const eventsFull = eventRows.length === SOURCE_READ;
    const showsFull = showRows.length === SOURCE_READ;
    let limit = Infinity;
    if (eventsFull) limit = Math.min(limit, eventRows[eventRows.length - 1].startsAt);
    if (showsFull) limit = Math.min(limit, showStart(showRows[showRows.length - 1].date));
    // Only when nothing was read before the cut. Otherwise the earlier rows fill the page and the
    // next one starts at the cut, where it reads every source afresh.
    const firstStarts = [
      ...(eventRows.length > 0 ? [eventRows[0].startsAt] : []),
      ...(showRows.length > 0 ? [showStart(showRows[0].date)] : []),
    ];
    const inclusive = limit !== Infinity && Math.min(...firstStarts) === limit;

    const profiles = new Map<Id<"profiles">, Doc<"profiles"> | null>();
    const profile = async (id: Id<"profiles">) => {
      if (!profiles.has(id)) {
        const p = await ctx.db.get(id);
        profiles.set(id, p === null || p.banned ? null : p);
      }
      return profiles.get(id)!;
    };

    const merged: UpcomingItem[] = [];
    for (const e of eventRows) {
      if (e.hidden) continue;
      const host = await profile(e.hostId);
      if (host === null) continue;
      merged.push(toEventItem(e, host));
    }
    for (const s of showRows) {
      if (cityKey && cityKeyOf(s.city) !== cityKey) continue;
      const startsAt = showStart(s.date);
      if (startsAt < from) continue;
      const artist = await profile(s.profileId);
      if (artist === null) continue;
      merged.push({
        kind: "show",
        id: s._id,
        artist: toPublicCard(artist),
        date: s.date,
        startsAt,
        venue: s.venue,
        city: s.city,
      });
    }
    // Stable, so ties keep events first and each source's index order.
    merged.sort((a, b) => a.startsAt - b.startsAt);

    let skipped = 0;
    const ready = merged.filter((item) => {
      if (inclusive ? item.startsAt > limit : item.startsAt >= limit) return false;
      if (cursor && item.startsAt === from && skipped < skip) {
        skipped++;
        return false;
      }
      return true;
    });

    const items = ready.slice(0, PAGE_SIZE);
    if (ready.length <= PAGE_SIZE) {
      if (limit === Infinity) return { items, nextCursor: null };
      // Everything before the cut is shown. An inclusive page moves past its instant.
      return { items, nextCursor: { startsAt: inclusive ? limit + 1 : limit, skip: 0 } };
    }
    const last = items[items.length - 1].startsAt;
    let atLast = items.filter((i) => i.startsAt === last).length;
    if (cursor && last === from) atLast += skip;
    return { items, nextCursor: { startsAt: last, skip: atLast } };
  },
});

/**
 * The viewer's upcoming events: ones they host (up to 50) and ones they
 * answered (up to 200 of their RSVPs), soonest first. Hidden events and
 * banned hosts are left out. Empty when signed out.
 */
export const myEvents = query({
  args: {},
  returns: v.array(
    v.object({
      ...eventItem.fields,
      role: v.union(v.literal("host"), v.literal("going"), v.literal("maybe")),
    }),
  ),
  handler: async (ctx): Promise<MyEvent[]> => {
    const me = await viewerProfile(ctx);
    if (me === null) return [];
    const now = Date.now();
    const out = new Map<Id<"events">, MyEvent>();
    const hosted = await ctx.db
      .query("events")
      .withIndex("by_host", (q) => q.eq("hostId", me._id).gte("startsAt", now))
      .take(MY_HOSTED);
    for (const e of hosted) {
      if (!e.hidden) out.set(e._id, { ...toEventItem(e, me), role: "host" });
    }
    const answered = await ctx.db
      .query("rsvps")
      .withIndex("by_profile", (q) => q.eq("profileId", me._id))
      .order("desc")
      .take(MY_RSVPS);
    for (const r of answered) {
      if (out.has(r.eventId)) continue;
      const found = await visibleEvent(ctx, r.eventId);
      if (found === null || found.event.startsAt < now) continue;
      out.set(r.eventId, { ...toEventItem(found.event, found.host), role: r.status });
    }
    return [...out.values()].sort((a, b) => a.startsAt - b.startsAt);
  },
});
