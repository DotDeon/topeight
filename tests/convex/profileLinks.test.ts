import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicProfile } from "../../lib/profile/types";
import { NOW, addProfile, as, setup, type T } from "./helpers";

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
  venue: "",
  city: "",
  description: "",
};

async function link(t: T, fromId: Id<"profiles">, artistId: Id<"profiles">, type: "venue" | "label", status = "accepted") {
  await t.run((ctx) =>
    ctx.db.insert("links", { fromId, artistId, type, status: status as "accepted" | "pending" }),
  );
}

async function page(t: T, username: string): Promise<PublicProfile> {
  return (await t.query(api.profiles.getPublicProfile, { username })) as PublicProfile;
}

async function world() {
  const t = setup();
  const venue = await addProfile(t, "mercury", { kind: "venue", displayName: "The Mercury", location: "Cape Town" });
  const label = await addProfile(t, "rhythm", { kind: "label", displayName: "Rhythm" });
  const band = await addProfile(t, "gvv", { kind: "artist", displayName: "GvV" });
  const other = await addProfile(t, "lowveld", { kind: "artist" });
  await link(t, venue, band, "venue");
  await link(t, label, band, "label");
  await link(t, label, other, "label", "pending");
  const eventId = await (await as(t, venue)).mutation(api.events.create, { ...gig, lineup: [band] });
  return { t, venue, label, band, other, eventId };
}

describe("profile links and gigs", () => {
  test("a venue's page lists its gigs with lineup, and its roster", async () => {
    const { t, eventId } = await world();
    const p = await page(t, "mercury");
    expect(p.gigs).toMatchObject([
      { eventId, title: "Friday night", date: "2026-10-24", lineup: [{ username: "gvv" }] },
    ]);
    expect(p.roster!.map((c) => c.username)).toEqual(["gvv"]);
  });

  test("a band's shows merge typed shows with venue gigs by date", async () => {
    const { t, band, eventId } = await world();
    await t.run(async (ctx) => {
      await ctx.db.insert("shows", { profileId: band, date: "2026-10-22", venue: "Club", city: "Durban" });
      await ctx.db.insert("shows", { profileId: band, date: "2026-10-30", venue: "Hall", city: "Pretoria" });
    });
    const p = await page(t, "gvv");
    expect(p.shows).toMatchObject([
      { date: "2026-10-22", venue: "Club" },
      { date: "2026-10-24", venue: "The Mercury", city: "Cape Town", eventId, venueUser: { username: "mercury" } },
      { date: "2026-10-30", venue: "Hall" },
    ]);
    expect(p.labels!.map((c) => c.username)).toEqual(["rhythm"]);
  });

  test("a label lists only accepted, unbanned bands", async () => {
    const { t, band } = await world();
    expect((await page(t, "rhythm")).roster!.map((c) => c.username)).toEqual(["gvv"]);
    await t.run((ctx) => ctx.db.patch(band, { banned: true }));
    expect((await page(t, "rhythm")).roster).toEqual([]);
  });

  test("a banned venue's gig leaves the band's shows, and a hidden one does too", async () => {
    const { t, venue, eventId } = await world();
    await t.run((ctx) => ctx.db.patch(venue, { banned: true }));
    expect((await page(t, "gvv")).shows).toEqual([]);
    expect((await page(t, "gvv")).labels!.map((c) => c.username)).toEqual(["rhythm"]);
    await t.run(async (ctx) => {
      await ctx.db.patch(venue, { banned: false });
      await ctx.db.patch(eventId, { hidden: true });
    });
    expect((await page(t, "gvv")).shows).toEqual([]);
  });

  test("fans get none of the new sections", async () => {
    const t = setup();
    await addProfile(t, "jess");
    const p = await page(t, "jess");
    expect(p.gigs).toBeUndefined();
    expect(p.roster).toBeUndefined();
    expect(p.labels).toBeUndefined();
  });
});
