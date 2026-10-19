/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("seed.run", () => {
  beforeEach(() => {
    vi.stubEnv("OPENSPACE_ALLOW_SEED", "1");
    vi.stubEnv("HOUSE_USERNAME", "openspace");
    vi.stubEnv("HOUSE_DISPLAY_NAME", "OpenSpace");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("is idempotent and leaves 8 fans, 5 artists with tracks and shows, 20+ comments", async () => {
    const t = setup();
    await t.mutation(internal.profiles.ensureHouse, {});
    await t.mutation(internal.seed.run, {});
    await t.mutation(internal.seed.run, {});

    const snapshot = await t.run(async (ctx) => {
      const all = (await ctx.db.query("profiles").collect()).filter((p) => !p.isHouse);
      const fans = all.filter((p) => p.kind === "fan");
      const artists = all.filter((p) => p.kind === "artist");
      const tracks = await ctx.db.query("tracks").collect();
      const shows = await ctx.db.query("shows").collect();
      const today = new Date().toISOString().slice(0, 10);
      return {
        fans: fans.length,
        artists: artists.length,
        artistsWithTracks: artists.filter((a) => tracks.some((t) => t.profileId === a._id)).length,
        artistsWithShows: artists.filter((a) => shows.some((s) => s.profileId === a._id)).length,
        allShowsUpcoming: shows.every((s) => s.date > today),
        comments: (await ctx.db.query("comments").collect()).length,
        bulletins: (await ctx.db.query("bulletins").collect()).length,
        profiles: all.length,
        users: (await ctx.db.query("users").collect()).length,
        usersWithEmail: (await ctx.db.query("users").collect()).filter((u) => u.email).length,
        top8Filled: all.every((p) => p.top8.length > 0 && p.top8.length <= 8),
        withPhoto: all.every((p) => p.photoKey === `seed/avatar-${p.username}.png`),
        trackKeys: [...new Set(tracks.map((t) => t.key))].sort(),
      };
    });

    expect(snapshot.fans).toBe(8);
    expect(snapshot.artists).toBe(5);
    expect(snapshot.artistsWithTracks).toBe(5);
    expect(snapshot.artistsWithShows).toBe(5);
    expect(snapshot.allShowsUpcoming).toBe(true);
    expect(snapshot.comments).toBeGreaterThanOrEqual(20);
    expect(snapshot.bulletins).toBeGreaterThanOrEqual(3);
    expect(snapshot.users).toBe(snapshot.profiles + 1); // plus the house user
    expect(snapshot.usersWithEmail).toBe(0);
    expect(snapshot.top8Filled).toBe(true);
    expect(snapshot.withPhoto).toBe(true);
    expect(snapshot.trackKeys.every((k) => /^seed\/silence-[123]\.mp3$/.test(k))).toBe(true);
  });

  test("friendships are unique pairs", async () => {
    const t = setup();
    await t.mutation(internal.seed.run, {});
    await t.mutation(internal.seed.run, {});
    const dupes = await t.run(async (ctx) => {
      const rows = await ctx.db.query("friendships").collect();
      const keys = rows.map((f) => `${f.a}:${f.b}`);
      return { total: keys.length, unique: new Set(keys).size, ordered: rows.every((f) => f.a < f.b) };
    });
    expect(dupes.total).toBeGreaterThan(20);
    expect(dupes.unique).toBe(dupes.total);
    expect(dupes.ordered).toBe(true);
  });

  test("throws unless OPENSPACE_ALLOW_SEED is 1", async () => {
    vi.stubEnv("OPENSPACE_ALLOW_SEED", "");
    const t = setup();
    await expect(t.mutation(internal.seed.run, {})).rejects.toThrow("Seeding is disabled");
  });
});
