/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");
type T = ReturnType<typeof convexTest>;
const setup = () => convexTest(schema, modules);

async function addProfile(t: T, username: string, extra: Record<string, unknown> = {}) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: `${username}@example.com` });
    return await ctx.db.insert("profiles", {
      userId,
      username,
      displayName: username,
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
      ...extra,
    });
  });
}

describe("search.people", () => {
  test("finds by display name and by exact username, exact match first", async () => {
    const t = setup();
    await addProfile(t, "tom", { displayName: "Tom Anderson" });
    await addProfile(t, "other", { displayName: "tom" });
    await addProfile(t, "zed", { displayName: "Zed Zed" });
    const byName = await t.query(api.search.people, { q: "anderson", cursor: null });
    expect(byName.page.map((c) => c.username)).toEqual(["tom"]);
    const both = await t.query(api.search.people, { q: "  TOM ", cursor: null });
    expect(both.page.map((c) => c.username)).toEqual(["tom", "other"]);
    const byUsername = await t.query(api.search.people, { q: "zed", cursor: null });
    expect(byUsername.page.map((c) => c.username)).toEqual(["zed"]);
  });

  test("empty query returns an empty page", async () => {
    const t = setup();
    await addProfile(t, "tom");
    const r = await t.query(api.search.people, { q: "   ", cursor: null });
    expect(r.page).toEqual([]);
    expect(r.isDone).toBe(true);
  });

  test("banned profiles never appear, even by exact username", async () => {
    const t = setup();
    await addProfile(t, "badguy", { displayName: "Bad Guy", banned: true });
    const r = await t.query(api.search.people, { q: "bad", cursor: null });
    expect(r.page).toEqual([]);
    const exact = await t.query(api.search.people, { q: "badguy", cursor: null });
    expect(exact.page).toEqual([]);
  });

  test("the house profile appears like anyone else", async () => {
    const t = setup();
    await addProfile(t, "houseacct", { displayName: "House Tom", isHouse: true });
    const r = await t.query(api.search.people, { q: "tom", cursor: null });
    expect(r.page.map((c) => c.username)).toEqual(["houseacct"]);
    const exact = await t.query(api.search.people, { q: "houseacct", cursor: null });
    expect(exact.page.map((c) => c.username)).toEqual(["houseacct"]);
  });

  test("kind artist excludes fans, including the exact username match", async () => {
    const t = setup();
    await addProfile(t, "bandx", { displayName: "Band X", kind: "artist" });
    await addProfile(t, "fanx", { displayName: "Band Fan" });
    const artists = await t.query(api.search.people, { q: "band", kind: "artist", cursor: null });
    expect(artists.page.map((c) => c.username)).toEqual(["bandx"]);
    const exactFan = await t.query(api.search.people, { q: "fanx", kind: "artist", cursor: null });
    expect(exactFan.page).toEqual([]);
    const fans = await t.query(api.search.people, { q: "band", kind: "fan", cursor: null });
    expect(fans.page.map((c) => c.username)).toEqual(["fanx"]);
  });
});

describe("search.browse", () => {
  test("lists newest first, hides banned, shows the house, filters by kind", async () => {
    const t = setup();
    await addProfile(t, "a1");
    await addProfile(t, "gone", { banned: true });
    await addProfile(t, "h", { isHouse: true });
    await addProfile(t, "band", { kind: "artist" });
    await addProfile(t, "a2");
    const all = await t.query(api.search.browse, { cursor: null });
    expect(all.page.map((c) => c.username)).toEqual(["a2", "band", "h", "a1"]);
    const artists = await t.query(api.search.browse, { kind: "artist", cursor: null });
    expect(artists.page.map((c) => c.username)).toEqual(["band"]);
  });

  test("location and genre match case-insensitively as substrings", async () => {
    const t = setup();
    await addProfile(t, "cpt", { location: "Cape Town, ZA", genre: "Indie Rock", kind: "artist" });
    await addProfile(t, "jhb", { location: "Johannesburg", genre: "Jazz", kind: "artist" });
    const loc = await t.query(api.search.browse, { location: " cape ", cursor: null });
    expect(loc.page.map((c) => c.username)).toEqual(["cpt"]);
    const genre = await t.query(api.search.browse, { genre: "JAZZ", cursor: null });
    expect(genre.page.map((c) => c.username)).toEqual(["jhb"]);
  });

  test("pages 40 at a time and continues with the cursor", async () => {
    const t = setup();
    for (let i = 0; i < 45; i++) await addProfile(t, `user${i}`);
    const first = await t.query(api.search.browse, { cursor: null });
    expect(first.page).toHaveLength(40);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.search.browse, { cursor: first.continueCursor });
    expect(second.page).toHaveLength(5);
    expect(second.isDone).toBe(true);
  });
});
