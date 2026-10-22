import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DAY, NOW, addProfile, as, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const gig = {
  title: "Friday night",
  localDate: "2026-10-24",
  localTime: "20:00",
  timeZone: "Africa/Johannesburg",
  venue: "typed venue",
  city: "typed city",
  description: "",
};

async function link(t: T, venue: Id<"profiles">, band: Id<"profiles">) {
  await t.run((ctx) => ctx.db.insert("links", { fromId: venue, artistId: band, type: "venue", status: "accepted" }));
}

/** A venue in Cape Town with two bands on its roster and one band that isn't. */
async function world() {
  const t = setup();
  const venue = await addProfile(t, "mercury", { kind: "venue", displayName: "The Mercury", location: "Cape Town" });
  const a = await addProfile(t, "gvv", { kind: "artist" });
  const b = await addProfile(t, "lowveld", { kind: "artist" });
  const stranger = await addProfile(t, "other", { kind: "artist" });
  await link(t, venue, a);
  await link(t, venue, b);
  return { t, venue, a, b, stranger };
}

async function lineupRows(t: T, eventId: Id<"events">) {
  const all = await t.run((ctx) => ctx.db.query("gigArtists").collect());
  return all.filter((r) => r.eventId === eventId).sort((x, y) => x.position - y.position);
}

describe("venue gigs", () => {
  test("a venue posts a gig with an ordered lineup, at its own name and city", async () => {
    const { t, venue, a, b } = await world();
    const id = await (await as(t, venue)).mutation(api.events.create, { ...gig, lineup: [b, a] });
    const event = await t.query(api.events.get, { id });
    expect(event!.venue).toBe("The Mercury");
    expect(event!.city).toBe("Cape Town");
    expect(event!.lineup.map((c) => c.username)).toEqual(["lowveld", "gvv"]);
    const list = await t.query(api.events.upcoming, {});
    expect(list.items[0]).toMatchObject({ kind: "event", lineup: [{ username: "lowveld" }, { username: "gvv" }] });
  });

  test("a venue with no city on its profile can't post", async () => {
    const t = setup();
    const venue = await addProfile(t, "mercury", { kind: "venue" });
    await expect((await as(t, venue)).mutation(api.events.create, gig)).rejects.toThrow(
      "Add your city to your profile first",
    );
  });

  test("only venues can add a lineup, and only bands on the roster", async () => {
    const { t, venue, a, stranger } = await world();
    const fan = await addProfile(t, "jess");
    await expect((await as(t, fan)).mutation(api.events.create, { ...gig, lineup: [a] })).rejects.toThrow(
      "Only venues can add a lineup",
    );
    const v = await as(t, venue);
    await expect(v.mutation(api.events.create, { ...gig, lineup: [stranger] })).rejects.toThrow(
      "Only bands on your roster can play",
    );
    await t.run((ctx) => ctx.db.insert("links", { fromId: venue, artistId: stranger, type: "venue", status: "pending" }));
    await expect(v.mutation(api.events.create, { ...gig, lineup: [stranger] })).rejects.toThrow(
      "Only bands on your roster can play",
    );
    await expect(v.mutation(api.events.create, { ...gig, lineup: [a, a] })).rejects.toThrow(
      "Only bands on your roster can play",
    );
    await expect(
      v.mutation(api.events.create, { ...gig, lineup: Array.from({ length: 11 }, () => a) }),
    ).rejects.toThrow("A lineup holds at most 10 bands");
  });

  test("a band can leave one gig, and the venue can't add it back", async () => {
    const { t, venue, a, b } = await world();
    const v = await as(t, venue);
    const id = await v.mutation(api.events.create, { ...gig, lineup: [a, b] });
    await (await as(t, a)).mutation(api.events.leaveLineup, { eventId: id });
    expect((await t.query(api.events.get, { id }))!.lineup.map((c) => c.username)).toEqual(["lowveld"]);
    await expect(v.mutation(api.events.update, { id, ...gig, lineup: [a, b] })).rejects.toThrow(
      "Only bands on your roster can play",
    );
    await expect((await as(t, a)).mutation(api.events.leaveLineup, { eventId: id })).resolves.toBeNull();
  });

  test("a band can't leave a gig that has started", async () => {
    const { t, venue, a } = await world();
    const id = await (await as(t, venue)).mutation(api.events.create, { ...gig, lineup: [a] });
    const event = await t.run((ctx) => ctx.db.get(id));
    vi.setSystemTime(event!.startsAt);
    await expect((await as(t, a)).mutation(api.events.leaveLineup, { eventId: id })).rejects.toThrow(
      "Event has already started",
    );
  });

  test("editing the date moves the lineup rows, and editing the lineup replaces them", async () => {
    const { t, venue, a, b } = await world();
    const v = await as(t, venue);
    const id = await v.mutation(api.events.create, { ...gig, lineup: [a] });
    await v.mutation(api.events.update, { id, ...gig, localDate: "2026-10-30", lineup: [b, a] });
    const event = await t.run((ctx) => ctx.db.get(id));
    const rows = await lineupRows(t, id);
    expect(rows.map((r) => [r.artistId, r.position, r.startsAt])).toEqual([
      [b, 0, event!.startsAt],
      [a, 1, event!.startsAt],
    ]);
  });

  test("leaving the roster drops the band from future gigs but keeps past ones", async () => {
    const { t, venue, a } = await world();
    const future = await (await as(t, venue)).mutation(api.events.create, { ...gig, lineup: [a] });
    const past = await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", {
        hostId: venue,
        title: "old",
        localDate: "2026-10-01",
        localTime: "20:00",
        timeZone: "UTC",
        startsAt: NOW.getTime() - 5 * DAY,
        venue: "The Mercury",
        city: "Cape Town",
        cityKey: "cape town",
        description: "",
        cancelled: false,
        hidden: false,
        goingCount: 0,
        maybeCount: 0,
      });
      await ctx.db.insert("gigArtists", {
        eventId,
        hostId: venue,
        artistId: a,
        position: 0,
        startsAt: NOW.getTime() - 5 * DAY,
      });
      return eventId;
    });
    await (await as(t, a)).mutation(api.links.remove, { other: venue });
    expect(await lineupRows(t, future)).toEqual([]);
    expect(await lineupRows(t, past)).toHaveLength(1);
  });

  test("a non-venue event keeps the venue and city it was given", async () => {
    const t = setup();
    const fan = await addProfile(t, "jess");
    const id = await (await as(t, fan)).mutation(api.events.create, gig);
    const event = await t.query(api.events.get, { id });
    expect(event).toMatchObject({ venue: "typed venue", city: "typed city", lineup: [] });
  });
});

describe("blocks and gigs", () => {
  test.each(["band blocks venue", "venue blocks band"] as const)(
    "a block (%s) takes the band off the venue's future gigs",
    async (who) => {
      const { t, venue, a } = await world();
      const id = await (await as(t, venue)).mutation(api.events.create, { ...gig, lineup: [a] });
      const [blocker, other] = who === "band blocks venue" ? [a, venue] : [venue, a];
      await (await as(t, blocker)).mutation(api.social.block, { other });
      expect(await lineupRows(t, id)).toEqual([]);
    },
  );
});
