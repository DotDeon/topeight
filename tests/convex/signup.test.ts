/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

const NOW = new Date("2026-10-19T12:00:00Z");

function setup() {
  return convexTest(schema, modules);
}

async function signedInUser(
  t: ReturnType<typeof setup>,
  email = "alice@example.com",
) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email, emailVerificationTime: Date.now() }),
  );
  return t.withIdentity({ subject: `${userId}|session1` });
}

const base = {
  username: "alice",
  displayName: "Alice",
  kind: "fan" as const,
  birthDate: "2000-01-01",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("HOUSE_USERNAME", "tom");
  vi.stubEnv("HOUSE_DISPLAY_NAME", "Tom");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("createMyProfile", () => {
  test("rejects users younger than 13", async () => {
    const t = setup();
    const user = await signedInUser(t);
    await expect(
      user.mutation(api.profiles.createMyProfile, {
        ...base,
        birthDate: "2014-01-01",
      }),
    ).rejects.toThrow("You must be 13 or older");
  });

  test("accepts a user who turns 13 today", async () => {
    const t = setup();
    const user = await signedInUser(t);
    await expect(
      user.mutation(api.profiles.createMyProfile, {
        ...base,
        birthDate: "2013-10-19",
      }),
    ).resolves.toBeDefined();
  });

  test.each(["garbage", "2000-02-30", "2000-1-01", "2099-01-01", ""])(
    "rejects invalid date of birth %j",
    async (birthDate) => {
      const t = setup();
      const user = await signedInUser(t);
      await expect(
        user.mutation(api.profiles.createMyProfile, { ...base, birthDate }),
      ).rejects.toThrow("Invalid date of birth");
    },
  );

  test("rejects a duplicate username in any case", async () => {
    const t = setup();
    const first = await signedInUser(t, "a@example.com");
    const second = await signedInUser(t, "b@example.com");
    await first.mutation(api.profiles.createMyProfile, base);
    await expect(
      second.mutation(api.profiles.createMyProfile, {
        ...base,
        username: "ALICE",
      }),
    ).rejects.toThrow("Username taken");
  });

  test("rejects the house username", async () => {
    const t = setup();
    const user = await signedInUser(t);
    await expect(
      user.mutation(api.profiles.createMyProfile, { ...base, username: "Tom" }),
    ).rejects.toThrow("Username taken");
  });

  test("rejects invalid and reserved usernames", async () => {
    const t = setup();
    const user = await signedInUser(t);
    await expect(
      user.mutation(api.profiles.createMyProfile, { ...base, username: "a!" }),
    ).rejects.toThrow("Usernames are 3 to 20 characters");
    await expect(
      user.mutation(api.profiles.createMyProfile, {
        ...base,
        username: "admin",
      }),
    ).rejects.toThrow("That username is reserved.");
  });

  test("befriends the house profile and puts it in top 8", async () => {
    const t = setup();
    const user = await signedInUser(t);
    const id = await user.mutation(api.profiles.createMyProfile, base);

    const { profile, house, friendships } = await t.run(async (ctx) => ({
      profile: await ctx.db.get(id),
      house: await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", "tom"))
        .unique(),
      friendships: await ctx.db.query("friendships").collect(),
    }));

    expect(house).not.toBeNull();
    expect(house!.displayName).toBe("Tom");
    expect(house!.isHouse).toBe(true);
    expect(profile!.username).toBe("alice");
    expect(profile!.top8).toEqual([house!._id]);
    expect(profile!.isHouse).toBe(false);
    expect(friendships).toHaveLength(1);
    const [a, b] = [id, house!._id].sort();
    expect(friendships[0].a).toBe(a);
    expect(friendships[0].b).toBe(b);
  });

  test("reuses an existing house profile", async () => {
    const t = setup();
    const houseId = await t.mutation(internal.profiles.ensureHouse, {});
    expect(await t.mutation(internal.profiles.ensureHouse, {})).toBe(houseId);
    const user = await signedInUser(t);
    const id = await user.mutation(api.profiles.createMyProfile, base);
    const profile = await t.run((ctx) => ctx.db.get(id));
    expect(profile!.top8).toEqual([houseId]);
    const houses = await t.run((ctx) =>
      ctx.db
        .query("profiles")
        .filter((q) => q.eq(q.field("isHouse"), true))
        .collect(),
    );
    expect(houses).toHaveLength(1);
  });

  test("throws on a second call for the same user", async () => {
    const t = setup();
    const user = await signedInUser(t);
    await user.mutation(api.profiles.createMyProfile, base);
    await expect(
      user.mutation(api.profiles.createMyProfile, {
        ...base,
        username: "alice2",
      }),
    ).rejects.toThrow("Profile already exists");
  });

  test("requires sign in", async () => {
    const t = setup();
    await expect(
      t.mutation(api.profiles.createMyProfile, base),
    ).rejects.toThrow("Not signed in");
  });

  test("requires a verified email", async () => {
    const t = setup();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "u@example.com" }),
    );
    const user = t.withIdentity({ subject: `${userId}|s` });
    await expect(
      user.mutation(api.profiles.createMyProfile, base),
    ).rejects.toThrow("Email not verified");
  });
});

describe("me and touchLogin", () => {
  test("me returns null without a profile and the profile after signup", async () => {
    const t = setup();
    expect(await t.query(api.profiles.me, {})).toBeNull();
    const user = await signedInUser(t);
    expect(await user.query(api.profiles.me, {})).toBeNull();
    const id = await user.mutation(api.profiles.createMyProfile, base);
    expect((await user.query(api.profiles.me, {}))!._id).toBe(id);
  });

  test("touchLogin updates lastLoginAt", async () => {
    const t = setup();
    const user = await signedInUser(t);
    const id = await user.mutation(api.profiles.createMyProfile, base);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await user.mutation(api.profiles.touchLogin, {});
    const profile = await t.run((ctx) => ctx.db.get(id));
    expect(profile!.lastLoginAt).toBe(NOW.getTime() + 60_000);
  });
});

describe("createMyProfile kinds", () => {
  test.each(["venue", "label"] as const)("stores a %s profile", async (kind) => {
    const t = setup();
    const user = await signedInUser(t);
    const id = await user.mutation(api.profiles.createMyProfile, { ...base, kind });
    const p = await t.run((ctx) => ctx.db.get(id));
    expect(p!.kind).toBe(kind);
  });
});
