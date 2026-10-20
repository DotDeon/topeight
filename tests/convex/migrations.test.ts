import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { storage } from "../../convex/lib/r2";
import { NOW, addProfile, setup, type T } from "./helpers";

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
});
