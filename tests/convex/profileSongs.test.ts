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

async function addTrack(
  t: T,
  profileId: Id<"profiles">,
  title = "Red Dust",
  order = 0,
) {
  return await t.run((ctx) =>
    ctx.db.insert("tracks", {
      profileId,
      title,
      key: `tracks/${profileId}/${order}`,
      size: 1,
      order,
      autoplay: order === 0,
    }),
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
      artist: {
        username: "band",
        displayName: "BAND",
        photoUrl: null,
        kind: "artist",
      },
    });
    await mia.mutation(api.profileSongs.clear, {});
    expect((await t.run((ctx) => ctx.db.get(me)))!.profileSong).toBeUndefined();
    expect(await songOf(t, "mia")).toBeNull();
  });

  test("needs a signed-in profile", async () => {
    const { t, track } = await world();
    await expect(
      t.mutation(api.profileSongs.pick, { trackId: track }),
    ).rejects.toThrow("Not signed in");
    await expect(t.mutation(api.profileSongs.clear, {})).rejects.toThrow(
      "Not signed in",
    );
  });

  test("an artist may pick their own song", async () => {
    const { t, band, track } = await world();
    await (
      await as(t, band)
    ).mutation(api.profileSongs.pick, { trackId: track });
    expect(await songOf(t, "band")).toMatchObject({
      id: track,
      artist: { username: "band" },
    });
  });

  test("refuses a deleted track, a banned artist and an artist with sharing off", async () => {
    const { t, band, track, mia } = await world();
    const gone = await addTrack(t, band, "Gone", 1);
    await t.run((ctx) => ctx.db.delete(gone));
    await expect(
      mia.mutation(api.profileSongs.pick, { trackId: gone }),
    ).rejects.toThrow("Song not available");

    await t.run((ctx) => ctx.db.patch(band, { shareSongs: false }));
    await expect(
      mia.mutation(api.profileSongs.pick, { trackId: track }),
    ).rejects.toThrow("Song not available");

    await t.run((ctx) =>
      ctx.db.patch(band, { shareSongs: true, banned: true }),
    );
    await expect(
      mia.mutation(api.profileSongs.pick, { trackId: track }),
    ).rejects.toThrow("Song not available");
  });

  test("refuses a song when either side has blocked the other", async () => {
    const { t, band, me, track, mia } = await world();
    await block(t, band, me);
    await expect(
      mia.mutation(api.profileSongs.pick, { trackId: track }),
    ).rejects.toThrow("Song not available");
  });

  test("pick is limited to 20 an hour", async () => {
    const { track, mia } = await world();
    for (let i = 0; i < 20; i++)
      await mia.mutation(api.profileSongs.pick, { trackId: track });
    await expect(
      mia.mutation(api.profileSongs.pick, { trackId: track }),
    ).rejects.toThrow("Slow down");
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
    expect(await songOf(t, "mia")).toMatchObject({
      id: track,
      title: "Red Dust",
    });
  });
});

describe("profileSongs.setShareSongs", () => {
  test("is for artists only", async () => {
    const { mia } = await world();
    await expect(
      mia.mutation(api.profileSongs.setShareSongs, { value: false }),
    ).rejects.toThrow("Only artists can share songs");
  });

  test("stores the setting", async () => {
    const { t, band } = await world();
    await (
      await as(t, band)
    ).mutation(api.profileSongs.setShareSongs, { value: false });
    expect((await t.run((ctx) => ctx.db.get(band)))!.shareSongs).toBe(false);
  });
});

describe("profileSongs.usageCount", () => {
  async function picks(t: T, n: number, trackId: Id<"tracks">) {
    for (let i = 0; i < n; i++)
      await (
        await as(t, await addProfile(t, `fan${trackId.slice(-4)}${i}`))
      ).mutation(api.profileSongs.pick, { trackId });
  }

  test("counts the members who picked any of the artist's songs", async () => {
    const { t, band, track } = await world();
    const second = await addTrack(t, band, "Blue Smoke", 1);
    await picks(t, 2, track);
    await picks(t, 1, second);
    const other = await addProfile(t, "other", { kind: "artist" });
    await picks(t, 1, await addTrack(t, other));
    expect(
      await (await as(t, band)).query(api.profileSongs.usageCount, {}),
    ).toBe(3);
    expect(
      await (await as(t, other)).query(api.profileSongs.usageCount, {}),
    ).toBe(1);
  });

  test("pick keeps one row per member, clear removes it", async () => {
    const { t, band, track, me, mia } = await world();
    const second = await addTrack(t, band, "Blue Smoke", 1);
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    await mia.mutation(api.profileSongs.pick, { trackId: second });
    const rows = await t.run((ctx) => ctx.db.query("songPicks").collect());
    expect(rows).toEqual([
      expect.objectContaining({
        pickerId: me,
        artistId: band,
        trackId: second,
      }),
    ]);
    expect(
      await (await as(t, band)).query(api.profileSongs.usageCount, {}),
    ).toBe(1);
    await mia.mutation(api.profileSongs.clear, {});
    expect(await t.run((ctx) => ctx.db.query("songPicks").collect())).toEqual(
      [],
    );
    expect(
      await (await as(t, band)).query(api.profileSongs.usageCount, {}),
    ).toBe(0);
  });

  test("leaves out self-picks and deleted tracks, and is 0 with sharing off", async () => {
    const { t, band, track, mia } = await world();
    const artist = await as(t, band);
    await artist.mutation(api.profileSongs.pick, { trackId: track });
    expect(await artist.query(api.profileSongs.usageCount, {})).toBe(0);
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    expect(await artist.query(api.profileSongs.usageCount, {})).toBe(1);
    await artist.mutation(api.profileSongs.setShareSongs, { value: false });
    expect(await artist.query(api.profileSongs.usageCount, {})).toBe(0);
    await artist.mutation(api.profileSongs.setShareSongs, { value: true });
    await t.run((ctx) => ctx.db.delete(track));
    expect(await artist.query(api.profileSongs.usageCount, {})).toBe(0);
  });

  test("is 0 for fans and signed-out callers", async () => {
    const { t, mia } = await world();
    expect(await mia.query(api.profileSongs.usageCount, {})).toBe(0);
    expect(await t.query(api.profileSongs.usageCount, {})).toBe(0);
  });

  test("stops counting at 1001 picks in total across the artist's tracks", async () => {
    const { t, band, track, me } = await world();
    const second = await addTrack(t, band, "Blue Smoke", 1);
    await t.run(async (ctx) => {
      for (let i = 0; i < 1005; i++) {
        await ctx.db.insert("songPicks", {
          pickerId: me,
          artistId: band,
          trackId: i % 2 ? track : second,
        });
      }
    });
    expect(
      await (await as(t, band)).query(api.profileSongs.usageCount, {}),
    ).toBe(1001);
  }, 30_000);
});

describe("blocking cuts the profile song tie", () => {
  test("a fan who picked the artist's song loses it when the artist blocks them, and unblocking doesn't restore it", async () => {
    const { t, band, track, me, mia } = await world();
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    const artist = await as(t, band);
    await artist.mutation(api.social.block, { other: me });
    expect((await t.run((ctx) => ctx.db.get(me)))!.profileSong).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("songPicks").collect())).toEqual(
      [],
    );
    await artist.mutation(api.social.unblock, { other: me });
    expect(await songOf(t, "mia")).toBeNull();
  });

  test("a fan who blocks the artist loses the artist's song", async () => {
    const { t, band, track, me, mia } = await world();
    await mia.mutation(api.profileSongs.pick, { trackId: track });
    await mia.mutation(api.social.block, { other: band });
    expect((await t.run((ctx) => ctx.db.get(me)))!.profileSong).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("songPicks").collect())).toEqual(
      [],
    );
    await mia.mutation(api.social.unblock, { other: band });
    expect(await songOf(t, "mia")).toBeNull();
  });

  test("an artist loses a picked song by the artist they block, and keeps unrelated picks", async () => {
    const { t, band, track } = await world();
    const other = await addProfile(t, "other", { kind: "artist" });
    const theirs = await addTrack(t, other, "Theirs");
    const bandSession = await as(t, band);
    await bandSession.mutation(api.profileSongs.pick, { trackId: theirs });
    const third = await addProfile(t, "third");
    await (
      await as(t, third)
    ).mutation(api.profileSongs.pick, { trackId: track });
    await bandSession.mutation(api.social.block, { other: third });
    // band's pick belongs to "other", not "third", so it stays; third's pick of band's song goes.
    expect((await t.run((ctx) => ctx.db.get(band)))!.profileSong).toBe(theirs);
    expect(
      (await t.run((ctx) => ctx.db.get(third)))!.profileSong,
    ).toBeUndefined();
    await bandSession.mutation(api.social.block, { other: other });
    expect(
      (await t.run((ctx) => ctx.db.get(band)))!.profileSong,
    ).toBeUndefined();
  });
});
