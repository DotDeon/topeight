/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_SCAN } from "../../convex/lib/limits";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");
const NOW = new Date("2026-10-19T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

type T = ReturnType<typeof convexTest>;
const setup = () => convexTest(schema, modules);

async function addProfile(
  t: T,
  username: string,
  extra: Record<string, unknown> = {},
): Promise<Id<"profiles">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: `${username}@example.com`,
      emailVerificationTime: Date.now(),
    });
    return await ctx.db.insert("profiles", {
      userId,
      username,
      displayName: username.toUpperCase(),
      kind: "fan",
      birthDate: "2000-01-01",
      headline: "",
      location: "",
      aboutMe: "",
      whoIdLikeToMeet: "",
      photoKey: `${username}.jpg`,
      hasPhoto: true,
      lastLoginAt: 0,
      customCss: "",
      customHtml: "",
      customJs: "",
      top8: [],
      isHouse: false,
      banned: false,
      ...extra,
    });
  });
}

async function signedIn(t: T, profileId: Id<"profiles">) {
  const p = await t.run((ctx) => ctx.db.get(profileId));
  return t.withIdentity({ subject: `${p!.userId}|s1` });
}

async function befriend(t: T, x: Id<"profiles">, y: Id<"profiles">) {
  const [a, b] = x < y ? [x, y] : [y, x];
  await t.run((ctx) => ctx.db.insert("friendships", { a, b }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://cdn.example.com");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("coolNewPeople", () => {
  test("excludes banned, house, artists and photoless; max 5 newest first", async () => {
    const t = setup();
    for (let i = 1; i <= 7; i++) await addProfile(t, `fan${i}`);
    await addProfile(t, "banned", { banned: true });
    await addProfile(t, "house", { isHouse: true });
    await addProfile(t, "band", { kind: "artist" });
    await addProfile(t, "nophoto", { photoKey: undefined, hasPhoto: false });
    const cards = await t.query(api.home.coolNewPeople, {});
    expect(cards.map((c) => c.username)).toEqual(["fan7", "fan6", "fan5", "fan4", "fan3"]);
    expect(cards[0]).toEqual({
      username: "fan7",
      displayName: "FAN7",
      photoUrl: "https://cdn.example.com/fan7.jpg",
      kind: "fan",
      online: false,
    });
  });

  test("finds a fan with a photo created before 500 photoless fans", async () => {
    const t = setup();
    await addProfile(t, "old");
    for (let i = 0; i < 500; i++) await addProfile(t, `x${i}`, { photoKey: undefined, hasPhoto: false });
    const cards = await t.query(api.home.coolNewPeople, {});
    expect(cards.map((c) => c.username)).toEqual(["old"]);
  });

  test("gives up after 55 rows when the newest are all banned", async () => {
    const t = setup();
    await addProfile(t, "old");
    for (let i = 0; i < 60; i++) await addProfile(t, `b${i}`, { banned: true });
    expect(await t.query(api.home.coolNewPeople, {})).toEqual([]);
  });

  test("returns [] when nobody has a photo", async () => {
    const t = setup();
    await addProfile(t, "nophoto", { photoKey: undefined, hasPhoto: false });
    expect(await t.query(api.home.coolNewPeople, {})).toEqual([]);
  });
});

describe("coolNewMusic", () => {
  test("only unbanned artists with a track, newest first, max 5", async () => {
    const t = setup();
    const withTrack = async (name: string, extra = {}) => {
      const id = await addProfile(t, name, { kind: "artist", hasTracks: true, ...extra });
      await t.run((ctx) =>
        ctx.db.insert("tracks", {
          profileId: id, title: "x", key: "k.mp3", size: 1, order: 0, autoplay: false,
        }),
      );
    };
    await addProfile(t, "silent", { kind: "artist", hasTracks: false });
    for (let i = 1; i <= 6; i++) await withTrack(`band${i}`);
    await withTrack("bannedband", { banned: true });
    const cards = await t.query(api.home.coolNewMusic, {});
    expect(cards.map((c) => c.username)).toEqual(["band6", "band5", "band4", "band3", "band2"]);
  });

  test("finds an artist with tracks created before 500 trackless artists", async () => {
    const t = setup();
    const track = (profileId: Id<"profiles">) =>
      t.run((ctx) =>
        ctx.db.insert("tracks", { profileId, title: "x", key: "k.mp3", size: 1, order: 0, autoplay: false }),
      );
    await track(await addProfile(t, "old", { kind: "artist", hasTracks: true }));
    for (let i = 0; i < 500; i++) await addProfile(t, `x${i}`, { kind: "artist" });
    const cards = await t.query(api.home.coolNewMusic, {});
    expect(cards.map((c) => c.username)).toEqual(["old"]);
  });

  test("allows artists without a photo", async () => {
    const t = setup();
    const id = await addProfile(t, "plain", { kind: "artist", photoKey: undefined, hasPhoto: false, hasTracks: true });
    await t.run((ctx) =>
      ctx.db.insert("tracks", {
        profileId: id, title: "x", key: "k.mp3", size: 1, order: 0, autoplay: false,
      }),
    );
    const cards = await t.query(api.home.coolNewMusic, {});
    expect(cards).toHaveLength(1);
    expect(cards[0].photoUrl).toBeNull();
  });
});

describe("shows.upcoming", () => {
  test("excludes past shows and sorts ascending", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const gone = await addProfile(t, "gone", { kind: "artist", banned: true });
    const show = (profileId: Id<"profiles">, date: string) =>
      t.run((ctx) => ctx.db.insert("shows", { profileId, date, venue: "V", city: "C" }));
    await show(band, "2026-11-02");
    await show(band, "2026-10-18");
    await show(band, "2026-10-19");
    await show(band, "2026-10-24");
    await show(gone, "2026-10-20");
    const rows = await t.query(api.shows.upcoming, { limit: 10 });
    expect(rows.map((r) => r.date)).toEqual(["2026-10-19", "2026-10-24", "2026-11-02"]);
    expect(rows[0].artist.username).toBe("band");
    expect(await t.query(api.shows.upcoming, { limit: 2 })).toHaveLength(2);
  });

  test("clamps limit to 1..20", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 25; i++) {
      await t.run((ctx) =>
        ctx.db.insert("shows", { profileId: band, date: "2026-11-01", venue: "V", city: "C" }),
      );
    }
    expect(await t.query(api.shows.upcoming, { limit: 0 })).toHaveLength(1);
    expect(await t.query(api.shows.upcoming, { limit: -5 })).toHaveLength(1);
    expect(await t.query(api.shows.upcoming, { limit: 1000 })).toHaveLength(20);
  });

  test("stops scanning after MAX_SCAN rows", async () => {
    const t = setup();
    const banned = await addProfile(t, "gone", { kind: "artist", banned: true });
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < MAX_SCAN; i++) {
      await t.run((ctx) =>
        ctx.db.insert("shows", { profileId: banned, date: "2026-10-20", venue: "V", city: "C" }),
      );
    }
    await t.run((ctx) =>
      ctx.db.insert("shows", { profileId: band, date: "2026-10-21", venue: "V", city: "C" }),
    );
    expect(await t.query(api.shows.upcoming, { limit: 5 })).toEqual([]);
  });
});

describe("dashboard", () => {
  test("is null when signed out, unverified, profileless or banned", async () => {
    const t = setup();
    expect(await t.query(api.home.dashboard, {})).toBeNull();
    const unverified = await addProfile(t, "unv");
    await t.run(async (ctx) => {
      const p = await ctx.db.get(unverified);
      await ctx.db.patch(p!.userId, { emailVerificationTime: undefined });
    });
    expect(await (await signedIn(t, unverified)).query(api.home.dashboard, {})).toBeNull();
    const bannedId = await addProfile(t, "ban", { banned: true });
    expect(await (await signedIn(t, bannedId)).query(api.home.dashboard, {})).toBeNull();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "np@example.com", emailVerificationTime: Date.now() }),
    );
    expect(await t.withIdentity({ subject: `${userId}|s` }).query(api.home.dashboard, {})).toBeNull();
  });

  test("returns me, pending requests and friend bulletins within 10 days", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const pal = await addProfile(t, "pal");
    const bad = await addProfile(t, "bad", { banned: true });
    const stranger = await addProfile(t, "stranger");
    const asker = await addProfile(t, "asker");
    const askerBanned = await addProfile(t, "askerbanned", { banned: true });
    await befriend(t, me, pal);
    await befriend(t, me, bad);
    await t.run(async (ctx) => {
      await ctx.db.insert("friendRequests", { from: asker, to: me, status: "pending" });
      await ctx.db.insert("friendRequests", { from: askerBanned, to: me, status: "pending" });
      await ctx.db.insert("friendRequests", { from: stranger, to: me, status: "declined" });
    });
    const post = (authorId: Id<"profiles">, body: string, hidden = false) =>
      t.run((ctx) => ctx.db.insert("bulletins", { authorId, body, hidden }));
    await post(pal, "old");
    // "old" falls outside the 10 day window once the clock moves on.
    vi.setSystemTime(new Date(NOW.getTime() + 11 * DAY));
    await post(pal, "first");
    await post(pal, "hidden", true);
    await post(bad, "from banned");
    await post(stranger, "from stranger");
    await post(me, "mine");
    await post(pal, "second");

    const dash = (await (await signedIn(t, me)).query(api.home.dashboard, {}))!;
    expect(dash.me.username).toBe("me");
    expect(dash.pendingRequests.map((c) => c.username)).toEqual(["asker"]);
    expect(dash.bulletins.map((b) => b.body)).toEqual(["second", "first"]);
    expect(dash.bulletins[0].author.username).toBe("pal");
  });
});
