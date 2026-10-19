/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
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
      profileViews: 0,
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

async function befriend(t: T, x: Id<"profiles">, y: Id<"profiles">) {
  const [a, b] = x < y ? [x, y] : [y, x];
  await t.run((ctx) => ctx.db.insert("friendships", { a, b }));
}

async function comment(t: T, profileId: Id<"profiles">, authorId: Id<"profiles">, body: string, hidden = false) {
  await t.run((ctx) => ctx.db.insert("comments", { profileId, authorId, body, hidden }));
}

const get = (t: T, username: string) => t.query(api.profiles.getPublicProfile, { username });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://cdn.example.com");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getPublicProfile", () => {
  test("returns null for missing or invalid usernames", async () => {
    const t = setup();
    expect(await get(t, "nobody")).toBeNull();
    expect(await get(t, "../admin")).toBeNull();
  });

  test("returns { unavailable: true } for banned profiles", async () => {
    const t = setup();
    await addProfile(t, "gone", { banned: true });
    expect(await get(t, "gone")).toEqual({ unavailable: true });
  });

  test("normalises the username", async () => {
    const t = setup();
    await addProfile(t, "jess");
    const p = await get(t, " Jess ");
    expect(p && "username" in p && p.username).toBe("jess");
  });

  test("assembles public fields and leaves private ones out", async () => {
    const t = setup();
    const id = await addProfile(t, "band", {
      kind: "artist",
      headline: "loud",
      genre: "Rock",
      band: { members: "a", influences: "b", soundsLike: "c", recordLabel: "d", labelType: "Indie" },
      profileViews: 41,
      lastLoginAt: 123,
      customCss: "body{}",
      customHtml: "<b>hi</b>",
      customJs: "1+1",
    });
    const p = await get(t, "band");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p).toMatchObject({
      username: "band",
      displayName: "BAND",
      kind: "artist",
      headline: "loud",
      genre: "Rock",
      band: { labelType: "Indie" },
      photoUrl: "https://cdn.example.com/band.jpg",
      profileViews: 41,
      lastLoginAt: 123,
      friendCount: 0,
      top8: [],
      comments: [],
      commentCount: 0,
      latestBulletin: null,
      tracks: [],
      shows: [],
      custom: { css: "body{}", html: "<b>hi</b>", js: "1+1" },
    });
    const created = await t.run(async (ctx) => (await ctx.db.get(id))!._creationTime);
    expect(p.memberSince).toBe(created);
    for (const key of ["birthDate", "userId", "_id", "banned", "isHouse", "photoKey", "customJs"]) {
      expect(p).not.toHaveProperty(key);
    }
  });

  test("fans never get custom html or js back", async () => {
    const t = setup();
    await addProfile(t, "fan", { customCss: "a{}", customHtml: "<i>x</i>", customJs: "alert(1)" });
    const p = await get(t, "fan");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.custom).toEqual({ css: "a{}", html: "", js: "" });
  });

  test("top8 keeps order and skips banned and missing friends", async () => {
    const t = setup();
    const a = await addProfile(t, "aaa");
    const b = await addProfile(t, "bbb", { banned: true });
    const c = await addProfile(t, "ccc", { kind: "artist" });
    const gone = await addProfile(t, "gone");
    await t.run((ctx) => ctx.db.delete(gone));
    const me = await addProfile(t, "mine", { top8: [c, gone, b, a] });
    await befriend(t, me, a);
    await befriend(t, me, b);
    await befriend(t, me, c);
    const p = await get(t, "mine");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.top8.map((f) => f.username)).toEqual(["ccc", "aaa"]);
    expect(p.top8[0]).toEqual({
      username: "ccc",
      displayName: "CCC",
      photoUrl: "https://cdn.example.com/ccc.jpg",
      kind: "artist",
    });
    expect(p.friendCount).toBe(3);
  });

  test("comments: newest 10, no hidden, no banned or blocked authors", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const pal = await addProfile(t, "pal");
    const banned = await addProfile(t, "banned", { banned: true });
    const pest = await addProfile(t, "pest");
    await t.run((ctx) => ctx.db.insert("blocks", { blocker: me, blocked: pest }));
    for (let i = 0; i < 12; i++) await comment(t, me, pal, `c${i}`);
    await comment(t, me, pal, "hidden", true);
    await comment(t, me, banned, "from banned");
    await comment(t, me, pest, "from pest");
    const p = await get(t, "mine");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.comments.map((c) => c.body)).toEqual(
      ["c11", "c10", "c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2"],
    );
    expect(p.comments[0].author.username).toBe("pal");
    expect(typeof p.comments[0].createdAt).toBe("number");
    // Count is non-hidden comments.
    expect(p.commentCount).toBe(14);
  });

  test("comments scan stops after MAX_SCAN rows", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const pal = await addProfile(t, "pal");
    const pest = await addProfile(t, "pest");
    await t.run((ctx) => ctx.db.insert("blocks", { blocker: me, blocked: pest }));
    await comment(t, me, pal, "old");
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_SCAN; i++) {
        await ctx.db.insert("comments", { profileId: me, authorId: pest, body: "x", hidden: false });
      }
    });
    const p = await get(t, "mine");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.comments).toEqual([]);
  });

  test("commentCount stops at 1001", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const pal = await addProfile(t, "pal");
    await t.run(async (ctx) => {
      for (let i = 0; i < 1005; i++) {
        await ctx.db.insert("comments", { profileId: me, authorId: pal, body: "x", hidden: false });
      }
    });
    const p = await get(t, "mine");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.commentCount).toBe(1001);
  });

  test("latestBulletin is the newest visible one from the last 10 days", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const post = (body: string, hidden = false) =>
      t.run((ctx) => ctx.db.insert("bulletins", { authorId: me, body, hidden }));
    // convex-test creation times only move forward, so age posts by moving the clock on.
    await post("too old");
    vi.setSystemTime(NOW.getTime() + 9 * DAY);
    await post("recent");
    vi.setSystemTime(NOW.getTime() + 10 * DAY);
    await post("hidden", true);
    vi.setSystemTime(NOW.getTime() + 11 * DAY);
    const p = await get(t, "mine");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.latestBulletin?.body).toBe("recent");
  });

  test("latestBulletin is null when only old bulletins exist", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    await t.run((ctx) => ctx.db.insert("bulletins", { authorId: me, body: "too old", hidden: false }));
    vi.setSystemTime(NOW.getTime() + 11 * DAY);
    const p = await get(t, "mine");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.latestBulletin).toBeNull();
  });

  test("tracks are ordered with public URLs", async () => {
    const t = setup();
    const me = await addProfile(t, "band", { kind: "artist" });
    await t.run(async (ctx) => {
      await ctx.db.insert("tracks", { profileId: me, title: "Two", key: "t/2.mp3", size: 1, order: 1, autoplay: true });
      await ctx.db.insert("tracks", { profileId: me, title: "One", key: "t/1.mp3", size: 1, order: 0, autoplay: false });
    });
    const p = await get(t, "band");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.tracks).toEqual([
      { title: "One", url: "https://cdn.example.com/t/1.mp3", autoplay: false },
      { title: "Two", url: "https://cdn.example.com/t/2.mp3", autoplay: true },
    ]);
  });

  test("shows are today onward, soonest first, at most 20", async () => {
    const t = setup();
    const me = await addProfile(t, "band", { kind: "artist" });
    await t.run(async (ctx) => {
      await ctx.db.insert("shows", { profileId: me, date: "2026-10-18", venue: "Past", city: "X" });
      await ctx.db.insert("shows", { profileId: me, date: "2026-10-19", venue: "Today", city: "X" });
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("shows", { profileId: me, date: `2027-01-${String(i + 1).padStart(2, "0")}`, venue: `V${i}`, city: "Y" });
      }
    });
    const p = await get(t, "band");
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    expect(p.shows).toHaveLength(20);
    expect(p.shows[0]).toEqual({ date: "2026-10-19", venue: "Today", city: "X" });
    expect(p.shows[1].venue).toBe("V0");
  });
});

describe("recordView", () => {
  test("increments profileViews without signing in", async () => {
    const t = setup();
    const id = await addProfile(t, "jess", { profileViews: 5 });
    await t.mutation(api.profiles.recordView, { username: "jess" });
    await t.mutation(api.profiles.recordView, { username: "Jess" });
    expect((await t.run((ctx) => ctx.db.get(id)))!.profileViews).toBe(7);
  });

  test("counts the house profile and ignores missing or banned ones", async () => {
    const t = setup();
    const house = await addProfile(t, "house", { isHouse: true });
    const banned = await addProfile(t, "gone", { banned: true });
    await t.mutation(api.profiles.recordView, { username: "house" });
    await t.mutation(api.profiles.recordView, { username: "gone" });
    await t.mutation(api.profiles.recordView, { username: "nobody" });
    expect((await t.run((ctx) => ctx.db.get(house)))!.profileViews).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(banned)))!.profileViews).toBe(0);
  });
});

describe("seedSandboxFixture", () => {
  test("creates the sandboxtest artist once", async () => {
    vi.stubEnv("OPENSPACE_TEST_FIXTURES", "1");
    const t = setup();
    await t.mutation(internal.testing.seedSandboxFixture, {});
    await t.mutation(internal.testing.seedSandboxFixture, {});
    const rows = await t.run((ctx) =>
      ctx.db.query("profiles").withIndex("by_username", (q) => q.eq("username", "sandboxtest")).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("artist");
    expect(rows[0].customJs).toContain("document.title");
    const p = await get(t, "sandboxtest");
    expect(p && "username" in p).toBe(true);
  });

  test("refuses to run unless OPENSPACE_TEST_FIXTURES is 1", async () => {
    const t = setup();
    await expect(t.mutation(internal.testing.seedSandboxFixture, {})).rejects.toThrow(/OPENSPACE_TEST_FIXTURES/);
    vi.stubEnv("OPENSPACE_TEST_FIXTURES", "true");
    await expect(t.mutation(internal.testing.seedSandboxFixture, {})).rejects.toThrow(/OPENSPACE_TEST_FIXTURES/);
    const count = await t.run(async (ctx) => (await ctx.db.query("profiles").collect()).length);
    expect(count).toBe(0);
  });

  test.each(["sandboxtest", "sandboxfan"])("never overwrites a real member named %s", async (username) => {
    vi.stubEnv("OPENSPACE_TEST_FIXTURES", "1");
    const t = setup();
    const id = await addProfile(t, username, { customJs: "real code" });
    await expect(t.mutation(internal.testing.seedSandboxFixture, {})).rejects.toThrow(/real member/);
    expect((await t.run((ctx) => ctx.db.get(id)))!.customJs).toBe("real code");
  });
});
