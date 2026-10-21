import { MAX_TRACKS } from "../../convex/lib/media";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { rateLimiter } from "../../convex/lib/limits";
import { addProfile, as, NOW, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://cdn.example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function addTracks(t: T, profileId: Id<"profiles">, n: number) {
  return await t.run(async (ctx) => {
    const ids: Id<"tracks">[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await ctx.db.insert("tracks", {
          profileId,
          title: `Song ${i}`,
          key: `tracks/${profileId}/${i}`,
          size: 1,
          order: i,
          autoplay: i === 0,
        }),
      );
    }
    return ids;
  });
}

describe("media.playbackUrls", () => {
  test("signs a 15 minute GET on the audio bucket for each track, in play order", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const ids = await addTracks(t, band, 2);
    const urls = await t.action(api.media.playbackUrls, { username: "band" });
    expect(urls.map((u) => u.id)).toEqual(ids);
    for (const [i, { url }] of urls.entries()) {
      const u = new URL(url);
      expect(u.host).toBe("test-audio-bucket.test-account.r2.cloudflarestorage.com");
      expect(u.pathname).toBe(`/tracks/${band}/${i}`);
      expect(u.searchParams.get("X-Amz-Expires")).toBe("900");
      expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("returns [] for a banned or missing profile", async () => {
    const t = setup();
    const gone = await addProfile(t, "gone", { kind: "artist", banned: true });
    await addTracks(t, gone, 2);
    expect(await t.action(api.media.playbackUrls, { username: "gone" })).toEqual([]);
    expect(await t.action(api.media.playbackUrls, { username: "nobody" })).toEqual([]);
    expect(await t.action(api.media.playbackUrls, { username: "Not a username!" })).toEqual([]);
  });

  test("returns [] silently after 120 calls a minute for one username", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    await addTracks(t, band, 1);
    for (let i = 0; i < 120; i++) {
      expect(await t.action(api.media.playbackUrls, { username: "band" })).toHaveLength(1);
    }
    expect(await t.action(api.media.playbackUrls, { username: " Band " })).toEqual([]);
    const other = await addProfile(t, "other", { kind: "artist" });
    await addTracks(t, other, 1);
    expect(await t.action(api.media.playbackUrls, { username: "other" })).toHaveLength(1);
  });

  test("invalid or overlong usernames return [] without touching the limiter", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    await addTracks(t, band, 1);
    const spy = vi.spyOn(rateLimiter, "limit");
    for (const username of ["ab", "x".repeat(500), "Not a username!", "admin"]) {
      expect(await t.action(api.media.playbackUrls, { username })).toEqual([]);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(await t.action(api.media.playbackUrls, { username: "band" })).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("signs at most MAX_TRACKS", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    await addTracks(t, band, 12);
    expect(await t.action(api.media.playbackUrls, { username: "band" })).toHaveLength(MAX_TRACKS);
  });

  test("returns [] when the audio bucket is not configured", async () => {
    vi.stubEnv("R2_AUDIO_BUCKET", "");
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    await addTracks(t, band, 1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await t.action(api.media.playbackUrls, { username: "band" })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("R2 audio bucket not configured");
    warn.mockRestore();
  });
});

describe("media.playbackUrls profile song", () => {
  async function fanWithSong(t: T) {
    const band = await addProfile(t, "band", { kind: "artist" });
    const [track] = await addTracks(t, band, 1);
    await addProfile(t, "mia", { profileSong: track });
    return { band, track };
  }

  test("signs the picked song against the artist's key, flagged profileSong", async () => {
    const t = setup();
    const { band, track } = await fanWithSong(t);
    const urls = await t.action(api.media.playbackUrls, { username: "mia" });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatchObject({ id: track, profileSong: true });
    const u = new URL(urls[0].url);
    expect(u.host).toBe("test-audio-bucket.test-account.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(`/tracks/${band}/0`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("900");
  });

  test("signs nothing for the song once it is unavailable", async () => {
    const t = setup();
    const { band, track } = await fanWithSong(t);
    await t.run((ctx) => ctx.db.patch(band, { shareSongs: false }));
    expect(await t.action(api.media.playbackUrls, { username: "mia" })).toEqual([]);
    await t.run((ctx) => ctx.db.patch(band, { shareSongs: undefined, banned: true }));
    expect(await t.action(api.media.playbackUrls, { username: "mia" })).toEqual([]);
    await t.run((ctx) => ctx.db.patch(band, { banned: false }));
    await t.run((ctx) => ctx.db.delete(track));
    expect(await t.action(api.media.playbackUrls, { username: "mia" })).toEqual([]);
  });

  test("an artist gets the picked song as an extra entry on top of MAX_TRACKS own tracks", async () => {
    const t = setup();
    const other = await addProfile(t, "other", { kind: "artist" });
    const [picked] = await addTracks(t, other, 1);
    const band = await addProfile(t, "band", { kind: "artist", profileSong: picked });
    const own = await addTracks(t, band, 12);
    const urls = await t.action(api.media.playbackUrls, { username: "band" });
    expect(urls).toHaveLength(MAX_TRACKS + 1);
    expect(urls[0]).toMatchObject({ id: picked, profileSong: true });
    expect(urls.slice(1).map((u) => u.id)).toEqual(own.slice(0, MAX_TRACKS));
    expect(urls.slice(1).every((u) => u.profileSong === undefined)).toBe(true);
  });

  test("a banned fan's picked song is not signed", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const [track] = await addTracks(t, band, 1);
    await addProfile(t, "mia", { profileSong: track, banned: true });
    expect(await t.action(api.media.playbackUrls, { username: "mia" })).toEqual([]);
  });
});

describe("getPublicProfile tracks", () => {
  test("carry no URL, even with a public media base", async () => {
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const [id] = await addTracks(t, band, 1);
    const p = await t.query(api.profiles.getPublicProfile, { username: "band" });
    if (!p || "unavailable" in p || "restricted" in p) throw new Error("expected a profile");
    expect(p.tracks).toEqual([{ id, title: "Song 0", url: null, autoplay: true }]);
  });
});

describe("moderation.trackPlaybackUrl", () => {
  test("is admin-only", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    const t = setup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const fan = await addProfile(t, "fan");
    const [track] = await addTracks(t, band, 1);
    await expect(t.action(api.moderation.trackPlaybackUrl, { trackId: track })).rejects.toThrow("Not allowed");
    await expect((await as(t, fan)).action(api.moderation.trackPlaybackUrl, { trackId: track })).rejects.toThrow(
      "Not allowed",
    );
    await expect((await as(t, band)).action(api.moderation.trackPlaybackUrl, { trackId: track })).rejects.toThrow(
      "Not allowed",
    );
  });

  test("signs a 15 minute URL for an admin, even on a banned profile", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    const t = setup();
    const boss = await addProfile(t, "boss");
    const band = await addProfile(t, "band", { kind: "artist", banned: true });
    const [track] = await addTracks(t, band, 1);
    const url = await (await as(t, boss)).action(api.moderation.trackPlaybackUrl, { trackId: track });
    const u = new URL(url!);
    expect(u.pathname).toBe(`/tracks/${band}/0`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("900");
  });

  test("returns null for a deleted track", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    const t = setup();
    const boss = await addProfile(t, "boss");
    const band = await addProfile(t, "band", { kind: "artist" });
    const [track] = await addTracks(t, band, 1);
    await t.run((ctx) => ctx.db.delete(track));
    expect(await (await as(t, boss)).action(api.moderation.trackPlaybackUrl, { trackId: track })).toBeNull();
  });
});
