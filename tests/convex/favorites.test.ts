/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

type T = ReturnType<typeof convexTest>;
function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

async function addProfile(t: T, username: string, extra: Record<string, unknown> = {}): Promise<Id<"profiles">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: `${username}@example.com`, emailVerificationTime: Date.now() });
    return await ctx.db.insert("profiles", {
      userId, username, displayName: username.toUpperCase(), kind: "fan", birthDate: "2000-01-01",
      headline: "", location: "", aboutMe: "", whoIdLikeToMeet: "", lastLoginAt: 0,
      customCss: "", customHtml: "", customJs: "", top8: [], isHouse: false, banned: false, ...extra,
    });
  });
}

async function as(t: T, id: Id<"profiles">) {
  const p = await t.run((ctx) => ctx.db.get(id));
  return t.withIdentity({ subject: `${p!.userId}|s1` });
}

describe("favorites", () => {
  test("add is idempotent", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    await addProfile(t, "tom");
    const a = await as(t, me);
    expect(await a.mutation(api.favorites.add, { username: "tom" })).toBe("added");
    expect(await a.mutation(api.favorites.add, { username: "tom" })).toBe("exists");
    expect((await a.query(api.favorites.list, {})).map((c) => c.username)).toEqual(["tom"]);
    expect(await a.query(api.favorites.isFavorite, { username: "tom" })).toBe(true);
    expect(await a.query(api.favorites.isFavorite, { username: "mine" })).toBe(false);
  });

  test("cannot favorite yourself or a missing profile", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const a = await as(t, me);
    await expect(a.mutation(api.favorites.add, { username: "mine" })).rejects.toThrow("Not allowed");
    await expect(a.mutation(api.favorites.add, { username: "ghost" })).rejects.toThrow("Profile not found");
  });

  test("stops at 500", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const other = await addProfile(t, "extra");
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        const p = await ctx.db.insert("profiles", {
          userId: (await ctx.db.insert("users", {})), username: `f${i}`, displayName: `F${i}`, kind: "fan",
          birthDate: "2000-01-01", headline: "", location: "", aboutMe: "", whoIdLikeToMeet: "", lastLoginAt: 0,
          customCss: "", customHtml: "", customJs: "", top8: [], isHouse: false, banned: false,
        });
        await ctx.db.insert("favorites", { ownerId: me, profileId: p });
      }
    });
    const a = await as(t, me);
    await expect(a.mutation(api.favorites.add, { username: "extra" })).rejects.toThrow("Favorites are full");
    expect(other).toBeTruthy();
  });

  test("list omits banned profiles", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const tom = await addProfile(t, "tom");
    await addProfile(t, "ann");
    const a = await as(t, me);
    await a.mutation(api.favorites.add, { username: "tom" });
    await a.mutation(api.favorites.add, { username: "ann" });
    await t.run((ctx) => ctx.db.patch(tom, { banned: true }));
    expect((await a.query(api.favorites.list, {})).map((c) => c.username)).toEqual(["ann"]);
  });

  test("remove works and signed out reads are empty", async () => {
    const t = setup();
    const me = await addProfile(t, "mine");
    const tom = await addProfile(t, "tom");
    const a = await as(t, me);
    await a.mutation(api.favorites.add, { username: "tom" });
    await a.mutation(api.favorites.remove, { profileId: tom });
    expect(await a.query(api.favorites.list, {})).toEqual([]);
    expect(await t.query(api.favorites.list, {})).toEqual([]);
    await expect(t.mutation(api.favorites.add, { username: "tom" })).rejects.toThrow("Not signed in");
  });
});
