import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { NOW, addProfile, as, befriend, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const KB = 1024;

describe("updateCustomCode", () => {
  test("over 100 KB of UTF-8 bytes in total throws", async () => {
    const t = setup();
    const id = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, id);
    // 40000 chars, but 120000 UTF-8 bytes (three per euro sign).
    const euro = "€".repeat(20000);
    await expect(me.mutation(api.profiles.updateCustomCode, { css: euro, html: euro, js: "" })).rejects.toThrow(
      "Custom code is limited to 100 KB",
    );
  });

  test("exactly 100 KB is fine and is saved", async () => {
    const t = setup();
    const id = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, id);
    await me.mutation(api.profiles.updateCustomCode, { css: "a".repeat(50 * KB), html: "b".repeat(30 * KB), js: "c".repeat(20 * KB) });
    const p = await t.run((ctx) => ctx.db.get(id));
    expect(p!.customCss.length + p!.customHtml.length + p!.customJs.length).toBe(100 * KB);
    await expect(
      me.mutation(api.profiles.updateCustomCode, { css: "a".repeat(100 * KB + 1), html: "", js: "" }),
    ).rejects.toThrow("Custom code is limited to 100 KB");
  });

  test("a fan cannot save html or js but can save css", async () => {
    const t = setup();
    const id = await addProfile(t, "fan");
    const me = await as(t, id);
    await expect(me.mutation(api.profiles.updateCustomCode, { css: "", html: "<b>x</b>", js: "" })).rejects.toThrow(
      "Fans can use CSS only",
    );
    await expect(me.mutation(api.profiles.updateCustomCode, { css: "", html: "", js: "alert(1)" })).rejects.toThrow(
      "Fans can use CSS only",
    );
    await me.mutation(api.profiles.updateCustomCode, { css: "body{color:red}", html: "", js: "" });
    expect((await t.run((ctx) => ctx.db.get(id)))!.customCss).toBe("body{color:red}");
  });

  test("signed out is rejected", async () => {
    await expect(setup().mutation(api.profiles.updateCustomCode, { css: "", html: "", js: "" })).rejects.toThrow();
  });
});

describe("becomeArtist", () => {
  test("switches a fan to artist and is a no-op for artists", async () => {
    const t = setup();
    const id = await addProfile(t, "fan");
    const me = await as(t, id);
    await me.mutation(api.profiles.becomeArtist, {});
    expect((await t.run((ctx) => ctx.db.get(id)))!.kind).toBe("artist");
    await me.mutation(api.profiles.becomeArtist, {});
    expect((await t.run((ctx) => ctx.db.get(id)))!.kind).toBe("artist");
  });
});

describe("updateDetails", () => {
  const fan = { displayName: "  Jess  ", headline: " hi ", location: "Cape Town", aboutMe: "me", whoIdLikeToMeet: "you" };

  test("trims and saves, a fan keeps interests and drops band", async () => {
    const t = setup();
    const id = await addProfile(t, "fan");
    const me = await as(t, id);
    await me.mutation(api.profiles.updateDetails, {
      ...fan,
      gender: " Female ",
      interests: { general: " a ", music: "", movies: "", television: "", books: "", heroes: "" },
      band: { members: "x", influences: "", soundsLike: "", recordLabel: "", labelType: "" },
      genre: "Rock",
    });
    const p = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(p.displayName).toBe("Jess");
    expect(p.headline).toBe("hi");
    expect(p.gender).toBe("Female");
    expect(p.interests?.general).toBe("a");
    expect(p.band).toBeUndefined();
    expect(p.genre).toBeUndefined();
  });

  test("an artist keeps band and genre and drops interests and gender", async () => {
    const t = setup();
    const id = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, id);
    await me.mutation(api.profiles.updateDetails, {
      ...fan,
      genre: "Rock",
      gender: "Male",
      interests: { general: "a", music: "", movies: "", television: "", books: "", heroes: "" },
      band: { members: " Ann ", influences: "", soundsLike: "", recordLabel: "", labelType: "" },
    });
    const p = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(p.band?.members).toBe("Ann");
    expect(p.genre).toBe("Rock");
    expect(p.interests).toBeUndefined();
    expect(p.gender).toBeUndefined();
  });

  test("length limits", async () => {
    const t = setup();
    const id = await addProfile(t, "fan");
    const me = await as(t, id);
    const call = (extra: Record<string, unknown>) => me.mutation(api.profiles.updateDetails, { ...fan, ...extra });
    await expect(call({ displayName: "  " })).rejects.toThrow("Display name is required");
    await expect(call({ displayName: "x".repeat(51) })).rejects.toThrow("Display name is too long");
    await expect(call({ headline: "x".repeat(101) })).rejects.toThrow("Headline is too long");
    await expect(call({ location: "x".repeat(101) })).rejects.toThrow("Location is too long");
    await expect(call({ aboutMe: "x".repeat(5001) })).rejects.toThrow("About me is too long");
    await expect(call({ whoIdLikeToMeet: "x".repeat(5001) })).rejects.toThrow("Who I'd like to meet is too long");
    await expect(call({ gender: "x".repeat(51) })).rejects.toThrow("Gender is too long");
    await expect(
      call({ interests: { general: "x".repeat(501), music: "", movies: "", television: "", books: "", heroes: "" } }),
    ).rejects.toThrow("Interests is too long");
    await call({ aboutMe: "x".repeat(5000), headline: "x".repeat(100) });
  });

  test("band field limit applies to artists", async () => {
    const t = setup();
    const id = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, id);
    await expect(
      me.mutation(api.profiles.updateDetails, {
        ...fan,
        band: { members: "x".repeat(501), influences: "", soundsLike: "", recordLabel: "", labelType: "" },
      }),
    ).rejects.toThrow("Band members is too long");
  });
});

describe("shows", () => {
  test("add validates date, kind and venue/city", async () => {
    const t = setup();
    const artist = await addProfile(t, "band", { kind: "artist" });
    const fanId = await addProfile(t, "fan");
    const me = await as(t, artist);
    const add = (extra: Record<string, unknown>) =>
      me.mutation(api.shows.add, { date: "2026-10-19", venue: "Bassline", city: "Joburg", ...extra });
    await add({});
    for (const date of ["2026-10-18", "2026-02-30", "tomorrow", "2026-13-01", "26-10-19", ""]) {
      await expect(add({ date })).rejects.toThrow("Invalid date");
    }
    await expect(add({ venue: " " })).rejects.toThrow("Venue is required");
    await expect(add({ venue: "x".repeat(101) })).rejects.toThrow("Venue is too long");
    await expect(add({ city: "x".repeat(101) })).rejects.toThrow("City is too long");
    await expect((await as(t, fanId)).mutation(api.shows.add, { date: "2026-12-01", venue: "v", city: "c" })).rejects.toThrow(
      "Only artists can add shows",
    );
  });

  test("at most 50 upcoming shows; past ones do not count", async () => {
    const t = setup();
    const artist = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, artist);
    await t.run(async (ctx) => {
      await ctx.db.insert("shows", { profileId: artist, date: "2020-01-01", venue: "old", city: "old" });
      for (let i = 0; i < 49; i++) {
        await ctx.db.insert("shows", { profileId: artist, date: "2026-11-01", venue: "v", city: "c" });
      }
    });
    await me.mutation(api.shows.add, { date: "2026-12-01", venue: "v", city: "c" });
    await expect(me.mutation(api.shows.add, { date: "2026-12-02", venue: "v", city: "c" })).rejects.toThrow("Too many shows");
  });

  test("remove is owner only and mine lists upcoming", async () => {
    const t = setup();
    const artist = await addProfile(t, "band", { kind: "artist" });
    const other = await addProfile(t, "other", { kind: "artist" });
    const me = await as(t, artist);
    await me.mutation(api.shows.add, { date: "2026-12-01", venue: "v", city: "c" });
    const [show] = await me.query(api.shows.mine, {});
    expect(show).toMatchObject({ date: "2026-12-01", venue: "v", city: "c" });
    await expect((await as(t, other)).mutation(api.shows.remove, { showId: show.id })).rejects.toThrow("Not allowed");
    await me.mutation(api.shows.remove, { showId: show.id });
    expect(await me.query(api.shows.mine, {})).toEqual([]);
  });
});

describe("myFriendsForTop8", () => {
  test("returns ids with cards for my friends only", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const a = await addProfile(t, "amy");
    await addProfile(t, "stranger");
    await befriend(t, me, a);
    const rows = await (await as(t, me)).query(api.social.myFriendsForTop8, {});
    expect(rows).toEqual([{ id: a, card: expect.objectContaining({ username: "amy" }) }]);
    expect(await setup().query(api.social.myFriendsForTop8, {})).toEqual([]);
  });
});

describe("myTracks", () => {
  test("lists my tracks in order", async () => {
    const t = setup();
    const id = await addProfile(t, "band", { kind: "artist" });
    await t.run(async (ctx) => {
      await ctx.db.insert("tracks", { profileId: id, title: "B", key: "k2", size: 1, order: 1, autoplay: false });
      await ctx.db.insert("tracks", { profileId: id, title: "A", key: "k1", size: 1, order: 0, autoplay: true });
    });
    const rows = await (await as(t, id)).query(api.media.myTracks, {});
    expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
    expect(rows[0].autoplay).toBe(true);
  });
});
