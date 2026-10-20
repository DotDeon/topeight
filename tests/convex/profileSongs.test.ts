import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { addProfile, as, block, NOW, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function addTrack(t: T, profileId: Id<"profiles">, title = "Red Dust", order = 0) {
  return await t.run((ctx) =>
    ctx.db.insert("tracks", { profileId, title, key: `tracks/${profileId}/${order}`, size: 1, order, autoplay: order === 0 }),
  );
}

async function songOf(t: T, username: string) {
  const p = await t.query(api.profiles.getPublicProfile, { username });
  if (!p || "unavailable" in p) throw new Error("expected a profile");
  return p.profileSong;
}

async function world() {
  const t = setup();
  const band = await addProfile(t, "band", { kind: "artist" });
  const track = await addTrack(t, band);
  const me = await addProfile(t, "mia");
  return { t, band, track, me, mia: await as(t, me) };
}

describe("profileSongs.pick and clear", () => {
  test("pick sets the song, getPublicProfile resolves it, clear removes it", async () => {
    const { t, track, me, mia } = await world();
    expect(await songOf(t, "mia")).toBeNull();
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    expect((await t.run((ctx) => ctx.db.get(me)))!.profileSong).toBe(track);
    expect(await songOf(t, "mia")).toEqual({
      id: track,
      title: "Red Dust",
      url: null,
      artist: { username: "band", displayName: "BAND", photoUrl: null, kind: "artist" },
    });
    await mia.mutation(api.profileSongs.clear, {});
    expect((await t.run((ctx) => ctx.db.get(me)))!.profileSong).toBeUndefined();
    expect(await songOf(t, "mia")).toBeNull();
  });

  test("needs a signed-in profile", async () => {
    const { t, track } = await world();
    await expect(t.mutation(api.profileSongs.pick, { trackId: track })).rejects.toThrow("Not signed in");
    await expect(t.mutation(api.profileSongs.clear, {})).rejects.toThrow("Not signed in");
  });

  test("an artist may pick their own song", async () => {
    const { t, band, track } = await world();
    await (await as(t, band)).mutation(api.profileSongs.pick, { trackId: track });
    expect(await songOf(t, "band")).toMatchObject({ id: track, artist: { username: "band" } });
  });

  test("refuses a deleted track, a banned artist and an artist with sharing off", async () => {
    const { t, band, track, mia } = await world();
    const gone = await addTrack(t, band, "Gone", 1);
    await t.run((ctx) => ctx.db.delete(gone));
    await expect(mia.mutation(api.profileSongs.pick, { trackId: gone })).rejects.toThrow("Song not available");

    await t.run((ctx) => ctx.db.patch(band, { shareSongs: false }));
    await expect(mia.mutation(api.profileSongs.pick, { trackId: track })).rejects.toThrow("Song not available");

    await t.run((ctx) => ctx.db.patch(band, { shareSongs: true, banned: true }));
    await expect(mia.mutation(api.profileSongs.pick, { trackId: track })).rejects.toThrow("Song not available");
  });

  test("refuses a song when either side has blocked the other", async () => {
    const { t, band, me, track, mia } = await world();
    await block(t, band, me);
    await expect(mia.mutation(api.profileSongs.pick, { trackId: track })).rejects.toThrow("Song not available");
  });

  test("pick is limited to 20 an hour", async () => {
    const { track, mia } = await world();
    for (let i = 0; i < 20; i++) await mia.mutation(api.profileSongs.pick, { trackId: track });
    await expect(mia.mutation(api.profileSongs.pick, { trackId: track })).rejects.toThrow("Slow down");
  });
});

describe("profile song availability at read time", () => {
  test("a deleted track reads as no song and the pick stays", async () => {
    const { t, track, me, mia } = await world();
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    await t.run((ctx) => ctx.db.delete(track));
    expect(await songOf(t, "mia")).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(me)))!.profileSong).toBe(track);
  });

  test("a banned artist reads as no song, and unbanning brings it back", async () => {
    const { t, band, track, mia } = await world();
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    await t.run((ctx) => ctx.db.patch(band, { banned: true }));
    expect(await songOf(t, "mia")).toBeNull();
    await t.run((ctx) => ctx.db.patch(band, { banned: false }));
    expect(await songOf(t, "mia")).toMatchObject({ id: track });
  });

  test("sharing off hides the song, sharing back on restores it", async () => {
    const { t, band, track, mia } = await world();
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    const artist = await as(t, band);
    await artist.mutation(api.profileSongs.setShareSongs, { value: false });
    expect(await songOf(t, "mia")).toBeNull();
    await artist.mutation(api.profileSongs.setShareSongs, { value: true });
    expect(await songOf(t, "mia")).toMatchObject({ id: track, title: "Red Dust" });
  });
});

describe("profileSongs.setShareSongs", () => {
  test("is for artists only", async () => {
    const { mia } = await world();
    await expect(mia.mutation(api.profileSongs.setShareSongs, { value: false })).rejects.toThrow(
      "Only artists can share songs",
    );
  });

  test("stores the setting", async () => {
    const { t, band } = await world();
    await (await as(t, band)).mutation(api.profileSongs.setShareSongs, { value: false });
    expect((await t.run((ctx) => ctx.db.get(band)))!.shareSongs).toBe(false);
  });
});

describe("profileSongs.usageCount", () => {
  test("counts the profiles that picked any of the artist's songs", async () => {
    const { t, band, track } = await world();
    const second = await addTrack(t, band, "Blue Smoke", 1);
    for (const [i, id] of [track, track, second].entries()) {
      await addProfile(t, `fan${i}`, { profileSong: id });
    }
    const other = await addProfile(t, "other", { kind: "artist" });
    await addProfile(t, "elsewhere", { profileSong: await addTrack(t, other) });
    expect(await (await as(t, band)).query(api.profileSongs.usageCount, {})).toBe(3);
    expect(await (await as(t, other)).query(api.profileSongs.usageCount, {})).toBe(1);
  });

  test("is 0 for fans and signed-out callers", async () => {
    const { t, mia } = await world();
    expect(await mia.query(api.profileSongs.usageCount, {})).toBe(0);
    expect(await t.query(api.profileSongs.usageCount, {})).toBe(0);
  });

  test("stops counting a track at 1001", async () => {
    const { t, band, track } = await world();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "x@example.com" });
      for (let i = 0; i < 1005; i++) {
        await ctx.db.insert("profiles", {
          userId,
          username: `bulk${i}`,
          displayName: "Bulk",
          kind: "fan",
          birthDate: "2000-01-01",
          headline: "",
          location: "",
          aboutMe: "",
          whoIdLikeToMeet: "",
          lastLoginAt: 0,
          customCss: "",
          customHtml: "",
          customJs: "",
          top8: [],
          isHouse: false,
          banned: false,
          profileSong: track,
        });
      }
    });
    expect(await (await as(t, band)).query(api.profileSongs.usageCount, {})).toBe(1001);
  }, 30_000);
});
