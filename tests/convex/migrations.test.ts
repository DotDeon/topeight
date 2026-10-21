import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { storage } from "../../convex/lib/r2";
import { NOW, addProfile, befriend, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function legacyWorld(t: T) {
  const photo = await addProfile(t, "photo", { photoKey: "a.jpg" });
  const plain = await addProfile(t, "plain");
  const band = await addProfile(t, "band", { kind: "artist" });
  await t.run((ctx) =>
    ctx.db.insert("tracks", { profileId: band, title: "x", key: "k", size: 1, order: 0, autoplay: true }),
  );
  return { photo, plain, band };
}

const flagsOf = (t: T, id: Id<"profiles">) =>
  t.run(async (ctx) => {
    const p = await ctx.db.get(id);
    return [p!.hasPhoto, p!.hasTracks];
  });

async function runAll(t: T) {
  await t.mutation(internal.migrations.backfillMediaFlags, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("backfillMediaFlags", () => {
  test("sets correct flags on legacy rows and is idempotent", async () => {
    const t = setup();
    const { photo, plain, band } = await legacyWorld(t);
    await runAll(t);
    expect(await flagsOf(t, photo)).toEqual([true, false]);
    expect(await flagsOf(t, plain)).toEqual([false, false]);
    expect(await flagsOf(t, band)).toEqual([false, true]);
    await runAll(t);
    expect(await flagsOf(t, photo)).toEqual([true, false]);
    expect(await flagsOf(t, band)).toEqual([false, true]);
  });

  test("one invocation touches at most 100 rows and the rest finish through the schedule", async () => {
    const t = setup();
    const ids: Id<"profiles">[] = [];
    for (let i = 0; i < 250; i++) ids.push(await addProfile(t, `u${i}`, { photoKey: "p.jpg" }));
    await t.mutation(internal.migrations.backfillMediaFlags, {});
    const done = async () =>
      (await t.run((ctx) => ctx.db.query("profiles").collect())).filter((p) => p.hasPhoto === true).length;
    expect(await done()).toBe(100);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await done()).toBe(250);
  });
});

describe("moveTracksToAudioBucket", () => {
  /** Objects per bucket, as a stubbed R2 sees them. */
  let buckets: Record<string, Set<string>>;
  let copies: string[];
  let deletes: string[];

  beforeEach(() => {
    buckets = { "test-bucket": new Set(), "test-audio-bucket": new Set() };
    copies = [];
    deletes = [];
    vi.spyOn(storage, "head").mockImplementation(async (key: string, bucket: string) =>
      buckets[bucket]?.has(key) ? { size: 1, contentType: "audio/mpeg" } : null,
    );
    vi.spyOn(storage, "copyToAudio").mockImplementation(async (key: string) => {
      copies.push(key);
      buckets["test-audio-bucket"].add(key);
    });
    vi.spyOn(storage, "removeLegacyPublic").mockImplementation(async (_ctx, key: string) => {
      deletes.push(key);
      buckets["test-bucket"].delete(key);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function addTracks(t: T, n: number, where: "public" | "audio") {
    const band = await addProfile(t, `band${where}`, { kind: "artist" });
    const keys: string[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        const key = `tracks/${band}/${where}-${i}`;
        keys.push(key);
        await ctx.db.insert("tracks", { profileId: band, title: `s${i}`, key, size: 1, order: i, autoplay: i === 0 });
      }
    });
    for (const k of keys) buckets[where === "public" ? "test-bucket" : "test-audio-bucket"].add(k);
    return keys;
  }

  async function runAll(t: T) {
    await t.action(internal.migrations.moveTracksToAudioBucket, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  test("copies each legacy track to the audio bucket, then deletes the public copy", async () => {
    const t = setup();
    const legacy = await addTracks(t, 3, "public");
    await runAll(t);
    expect(copies).toEqual(legacy);
    expect(deletes).toEqual(legacy);
    expect([...buckets["test-audio-bucket"]]).toEqual(legacy);
    expect(buckets["test-bucket"].size).toBe(0);
  });

  test("skips tracks already in the audio bucket, and a second run does nothing", async () => {
    const t = setup();
    await addTracks(t, 2, "audio");
    const legacy = await addTracks(t, 1, "public");
    await runAll(t);
    expect(copies).toEqual(legacy);
    expect(deletes).toEqual(legacy);
    copies = [];
    deletes = [];
    await runAll(t);
    expect(copies).toEqual([]);
    expect(deletes).toEqual([]);
  });

  test("a run handles at most 50 tracks and schedules itself for the rest", async () => {
    const t = setup();
    const legacy = await addTracks(t, 120, "public");
    await t.action(internal.migrations.moveTracksToAudioBucket, {});
    expect(copies).toHaveLength(50);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(copies.sort()).toEqual([...legacy].sort());
  });

  test("a 403 from R2 halts the run with a message naming the buckets", async () => {
    const t = setup();
    await addTracks(t, 3, "public");
    vi.mocked(storage.copyToAudio).mockImplementation(async () => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    });
    await expect(t.action(internal.migrations.moveTracksToAudioBucket, {})).rejects.toThrow(
      /access denied.*Object Read & Write.*test-bucket.*test-audio-bucket/,
    );
    expect(deletes).toEqual([]);
    expect(vi.mocked(storage.copyToAudio)).toHaveBeenCalledTimes(1);
  });

  test("a 403 from HEAD halts the run too", async () => {
    const t = setup();
    await addTracks(t, 2, "public");
    vi.mocked(storage.head).mockImplementation(async () => {
      throw Object.assign(new Error("Forbidden"), { $metadata: { httpStatusCode: 403 } });
    });
    await expect(t.action(internal.migrations.moveTracksToAudioBucket, {})).rejects.toThrow("access denied");
    expect(copies).toEqual([]);
  });

  test("logs moved, skipped and failed counts per page and at the end", async () => {
    const t = setup();
    await addTracks(t, 1, "audio");
    await addTracks(t, 2, "public");
    // A track in neither bucket cannot be copied.
    const band = await addProfile(t, "ghost", { kind: "artist" });
    await t.run((ctx) =>
      ctx.db.insert("tracks", { profileId: band, title: "x", key: "tracks/ghost/x", size: 1, order: 0, autoplay: true }),
    );
    vi.mocked(storage.copyToAudio).mockImplementation(async (key: string) => {
      if (key === "tracks/ghost/x") throw new Error("NoSuchKey");
      copies.push(key);
      buckets["test-audio-bucket"].add(key);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // The ghost has no object in the audio bucket, so head returns null and copy throws.
    await runAll(t);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("page moved=2 skipped=1 failed=1"))).toBe(true);
    expect(lines.some((l) => l.includes("done. moved=2 skipped=1 failed=1"))).toBe(true);
  });
});

describe("backfillSongPicks", () => {
  test("writes one row per existing pick across pages, skips deleted tracks, and is idempotent", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const track = await t.run((ctx) =>
      ctx.db.insert("tracks", { profileId: band, title: "x", key: "k", size: 1, order: 0, autoplay: true }),
    );
    const gone = await t.run((ctx) =>
      ctx.db.insert("tracks", { profileId: band, title: "y", key: "k2", size: 1, order: 1, autoplay: false }),
    );
    await t.run((ctx) => ctx.db.delete(gone));
    for (let i = 0; i < 45; i++) await addProfile(t, `fan${i}`, { profileSong: track });
    await addProfile(t, "stale", { profileSong: gone });
    await addProfile(t, "none");
    const run = async () => {
      await t.mutation(internal.migrations.backfillSongPicks, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    await run();
    await run();
    const rows = await t.run((ctx) => ctx.db.query("songPicks").collect());
    expect(rows).toHaveLength(45);
    expect(rows.every((r) => r.artistId === band && r.trackId === track)).toBe(true);
    expect(new Set(rows.map((r) => r.pickerId)).size).toBe(45);
  });
});

describe("moveHouseTo", () => {
  async function houseWorld(t: T) {
    const house = await addProfile(t, "topeight", { isHouse: true });
    const deon = await addProfile(t, "deon");
    const amy = await addProfile(t, "amy");
    const ben = await addProfile(t, "ben");
    for (const id of [deon, amy, ben]) await befriend(t, id, house);
    await befriend(t, ben, deon);
    await t.run(async (ctx) => {
      await ctx.db.patch(deon, { top8: [house] });
      await ctx.db.patch(amy, { top8: [house, ben] });
      await ctx.db.patch(ben, { top8: [house, deon] });
    });
    return { house, deon, amy, ben };
  }

  const friendCount = (t: T, id: Id<"profiles">) =>
    t.run(async (ctx) => {
      const rows = await ctx.db.query("friendships").collect();
      return rows.filter((f) => f.a === id || f.b === id).length;
    });

  test("moves friends and Top 8 spots to the new house and deletes the old one", async () => {
    const t = setup();
    const { house, deon, amy, ben } = await houseWorld(t);
    const userId = await t.run(async (ctx) => (await ctx.db.get(house))!.userId);

    const r = await t.mutation(internal.migrations.moveHouseTo, { from: "topeight", to: "deon" });
    expect(r).toEqual({ friendsMoved: 2 });

    const after = await t.run(async (ctx) => ({
      house: await ctx.db.get(house),
      user: await ctx.db.get(userId),
      deon: await ctx.db.get(deon),
      amy: await ctx.db.get(amy),
      ben: await ctx.db.get(ben),
    }));
    expect(after.house).toBeNull();
    expect(after.user).toBeNull();
    expect(after.deon).toMatchObject({ isHouse: true, top8: [] });
    expect(after.amy!.top8).toEqual([deon, ben]);
    expect(after.ben!.top8).toEqual([deon]);
    expect(await friendCount(t, house)).toBe(0);
    expect(await friendCount(t, deon)).toBe(2);
  });

  test("refuses when from is not the house or to is not a plain member", async () => {
    const t = setup();
    await houseWorld(t);
    await addProfile(t, "gone", { banned: true });
    await expect(t.mutation(internal.migrations.moveHouseTo, { from: "amy", to: "deon" })).rejects.toThrow(
      "is not the house account",
    );
    await expect(t.mutation(internal.migrations.moveHouseTo, { from: "topeight", to: "gone" })).rejects.toThrow(
      "can't become the house account",
    );
    await expect(t.mutation(internal.migrations.moveHouseTo, { from: "topeight", to: "nobody" })).rejects.toThrow(
      "can't become the house account",
    );
  });
});

describe("deleteUnverifiedUser", () => {
  async function stuckUser(t: T, email: string, verified = false) {
    return await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email,
        ...(verified ? { emailVerificationTime: NOW.getTime() } : {}),
      });
      const accountId = await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: email,
      });
      await ctx.db.insert("authVerificationCodes", {
        accountId,
        provider: "password",
        code: "hash",
        expirationTime: NOW.getTime() + 60_000,
      });
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: NOW.getTime() + 60_000 });
      await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: NOW.getTime() + 60_000 });
      return userId;
    });
  }

  const counts = (t: T) =>
    t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      accounts: (await ctx.db.query("authAccounts").collect()).length,
      codes: (await ctx.db.query("authVerificationCodes").collect()).length,
      sessions: (await ctx.db.query("authSessions").collect()).length,
      tokens: (await ctx.db.query("authRefreshTokens").collect()).length,
    }));

  test("deletes an unverified account with its login, codes and sessions", async () => {
    const t = setup();
    await stuckUser(t, "stuck@example.com");
    await stuckUser(t, "keep@example.com");
    await t.mutation(internal.migrations.deleteUnverifiedUser, { email: " Stuck@Example.com " });
    expect(await counts(t)).toEqual({ users: 1, accounts: 1, codes: 1, sessions: 1, tokens: 1 });
  });

  test("refuses verified accounts, accounts with a profile and unknown emails", async () => {
    const t = setup();
    await stuckUser(t, "real@example.com", true);
    const userId = await stuckUser(t, "joiner@example.com");
    const profile = await addProfile(t, "member");
    await t.run((ctx) => ctx.db.patch(profile, { userId }));
    await expect(t.mutation(internal.migrations.deleteUnverifiedUser, { email: "real@example.com" })).rejects.toThrow(
      "is verified",
    );
    await expect(t.mutation(internal.migrations.deleteUnverifiedUser, { email: "joiner@example.com" })).rejects.toThrow(
      "has a profile",
    );
    await expect(t.mutation(internal.migrations.deleteUnverifiedUser, { email: "nobody@example.com" })).rejects.toThrow(
      "No account",
    );
  });
});
