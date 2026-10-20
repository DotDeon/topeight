/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");
const NOW = new Date("2026-10-19T12:00:00Z");

type T = ReturnType<typeof convexTest>;
function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

async function addProfile(t: T, username: string, extra: Record<string, unknown> = {}): Promise<Id<"profiles">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: `${username}@example.com`,
      emailVerificationTime: Date.now(),
    });
    return await ctx.db.insert("profiles", {
      userId,
      username,
      displayName: username.toUpperCase(),
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

async function as(t: T, id: Id<"profiles">) {
  const p = await t.run((ctx) => ctx.db.get(id));
  return t.withIdentity({ subject: `${p!.userId}|s1` });
}

async function friendsRows(t: T) {
  return await t.run((ctx) => ctx.db.query("friendships").collect());
}

async function befriend(t: T, x: Id<"profiles">, y: Id<"profiles">) {
  const [a, b] = x < y ? [x, y] : [y, x];
  await t.run((ctx) => ctx.db.insert("friendships", { a, b }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("friend requests", () => {
  test("request then accept creates one friendship", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    expect(await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b })).toBe("sent");
    const dash = await (await as(t, b)).query(api.home.dashboard, {});
    expect(dash!.pendingRequests).toHaveLength(1);
    const requestId = dash!.pendingRequests[0].requestId;
    await (await as(t, b)).mutation(api.social.respondFriendRequest, { requestId, accept: true });
    expect(await friendsRows(t)).toHaveLength(1);
    expect((await (await as(t, b)).query(api.home.dashboard, {}))!.pendingRequests).toHaveLength(0);
  });

  test("decline creates no friendship", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b });
    const dash = await (await as(t, b)).query(api.home.dashboard, {});
    await (await as(t, b)).mutation(api.social.respondFriendRequest, {
      requestId: dash!.pendingRequests[0].requestId,
      accept: false,
    });
    expect(await friendsRows(t)).toHaveLength(0);
  });

  test("only the recipient can respond", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b });
    const dash = await (await as(t, b)).query(api.home.dashboard, {});
    await expect(
      (await as(t, c)).mutation(api.social.respondFriendRequest, {
        requestId: dash!.pendingRequests[0].requestId,
        accept: true,
      }),
    ).rejects.toThrow("Not allowed");
  });

  test("duplicate request and existing friend", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    const asA = await as(t, a);
    await asA.mutation(api.social.sendFriendRequest, { to: b });
    await expect(asA.mutation(api.social.sendFriendRequest, { to: b })).rejects.toThrow("Request already sent");
    await befriend(t, a, c);
    await expect(asA.mutation(api.social.sendFriendRequest, { to: c })).rejects.toThrow("Already friends");
  });

  test("crossing requests are accepted", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await (await as(t, b)).mutation(api.social.sendFriendRequest, { to: a });
    expect(await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b })).toBe("accepted");
    expect(await friendsRows(t)).toHaveLength(1);
  });

  test("blocked users and self cannot request", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await (await as(t, b)).mutation(api.social.block, { other: a });
    await expect((await as(t, a)).mutation(api.social.sendFriendRequest, { to: b })).rejects.toThrow("Not allowed");
    await expect((await as(t, b)).mutation(api.social.sendFriendRequest, { to: a })).rejects.toThrow("Not allowed");
    await expect((await as(t, a)).mutation(api.social.sendFriendRequest, { to: a })).rejects.toThrow("Not allowed");
  });

  test("the 51st request in an hour throws Slow down", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const asA = await as(t, a);
    for (let i = 0; i < 50; i++) {
      const other = await addProfile(t, `user${i}`);
      await asA.mutation(api.social.sendFriendRequest, { to: other });
    }
    const last = await addProfile(t, "last");
    await expect(asA.mutation(api.social.sendFriendRequest, { to: last })).rejects.toThrow("Slow down");
  });
});

async function pendingId(t: T, who: Id<"profiles">) {
  const dash = await (await as(t, who)).query(api.home.dashboard, {});
  return dash!.pendingRequests[0].requestId;
}

describe("request lifecycle", () => {
  test("accepting deletes the request row", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b });
    await (await as(t, b)).mutation(api.social.respondFriendRequest, { requestId: await pendingId(t, b), accept: true });
    expect(await t.run((ctx) => ctx.db.query("friendRequests").collect())).toHaveLength(0);
    expect(await friendsRows(t)).toHaveLength(1);
  });

  test("re-request after a decline is rejected for 7 days, then allowed", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const asA = await as(t, a);
    await asA.mutation(api.social.sendFriendRequest, { to: b });
    await (await as(t, b)).mutation(api.social.respondFriendRequest, { requestId: await pendingId(t, b), accept: false });
    const rows = await t.run((ctx) => ctx.db.query("friendRequests").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("declined");
    expect(rows[0].respondedAt).toBe(NOW.getTime());

    await expect(asA.mutation(api.social.sendFriendRequest, { to: b })).rejects.toThrow("Request already sent");
    expect(await t.run((ctx) => ctx.db.query("friendRequests").collect())).toHaveLength(1);

    vi.setSystemTime(NOW.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);
    await expect(asA.mutation(api.social.sendFriendRequest, { to: b })).rejects.toThrow("Request already sent");

    vi.setSystemTime(NOW.getTime() + 7 * 24 * 60 * 60 * 1000 + 1000);
    expect(await asA.mutation(api.social.sendFriendRequest, { to: b })).toBe("sent");
    const after = await t.run((ctx) => ctx.db.query("friendRequests").collect());
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("pending");
  });

  test("accepting after a block is rejected", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b });
    const requestId = await pendingId(t, b);
    await t.run((ctx) => ctx.db.insert("blocks", { blocker: b, blocked: a }));
    await expect(
      (await as(t, b)).mutation(api.social.respondFriendRequest, { requestId, accept: true }),
    ).rejects.toThrow("Not allowed");
    expect(await friendsRows(t)).toHaveLength(0);
  });

  test("accepting a banned sender's request throws Profile not found", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: b });
    const requestId = await pendingId(t, b);
    await t.run((ctx) => ctx.db.patch(a, { banned: true }));
    await expect(
      (await as(t, b)).mutation(api.social.respondFriendRequest, { requestId, accept: true }),
    ).rejects.toThrow("Profile not found");
    expect(await friendsRows(t)).toHaveLength(0);
  });

  test("a banned actor cannot send requests or set Top 8", async () => {
    const t = setup();
    const a = await addProfile(t, "alice", { banned: true });
    const b = await addProfile(t, "bob");
    const asA = await as(t, a);
    await expect(asA.mutation(api.social.sendFriendRequest, { to: b })).rejects.toThrow("Account banned");
    await expect(asA.mutation(api.social.setTop8, { ids: [] })).rejects.toThrow("Account banned");
  });

  test("setTop8 with own id and removeFriend of self are rejected", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const asA = await as(t, a);
    await expect(asA.mutation(api.social.setTop8, { ids: [a] })).rejects.toThrow("Top 8 can only include friends");
    await expect(asA.mutation(api.social.removeFriend, { other: a })).rejects.toThrow("Not allowed");
  });
});

describe("top 8", () => {
  test("rejects non-friends, more than 8, duplicates; accepts friends", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const asMe = await as(t, me);
    const friends: Id<"profiles">[] = [];
    for (let i = 0; i < 9; i++) {
      const f = await addProfile(t, `f${i}`);
      await befriend(t, me, f);
      friends.push(f);
    }
    const stranger = await addProfile(t, "stranger");
    await expect(asMe.mutation(api.social.setTop8, { ids: [stranger] })).rejects.toThrow("Top 8 can only include friends");
    await expect(asMe.mutation(api.social.setTop8, { ids: friends })).rejects.toThrow("Top 8 holds at most 8");
    await expect(asMe.mutation(api.social.setTop8, { ids: [friends[0], friends[0]] })).rejects.toThrow("Top 8 can only include friends");
    await asMe.mutation(api.social.setTop8, { ids: friends.slice(0, 3) });
    expect((await t.run((ctx) => ctx.db.get(me)))!.top8).toEqual(friends.slice(0, 3));
  });

  test("removeFriend clears both Top 8 lists", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    await befriend(t, a, b);
    await (await as(t, a)).mutation(api.social.setTop8, { ids: [b] });
    await (await as(t, b)).mutation(api.social.setTop8, { ids: [a] });
    await (await as(t, a)).mutation(api.social.removeFriend, { other: b });
    expect(await friendsRows(t)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(a)))!.top8).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(b)))!.top8).toEqual([]);
  });

  test("banned friends are omitted from top8 cards", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    await befriend(t, a, b);
    await befriend(t, a, c);
    await (await as(t, a)).mutation(api.social.setTop8, { ids: [b, c] });
    await t.run((ctx) => ctx.db.patch(b, { banned: true }));
    const p = await t.query(api.profiles.getPublicProfile, { username: "alice" });
    expect(p && !("unavailable" in p) && p.top8.map((x) => x.username)).toEqual(["carol"]);
  });
});

describe("block", () => {
  test("removes friendship, top 8 entries and pending requests; unblock only removes the block", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    await befriend(t, a, b);
    await (await as(t, a)).mutation(api.social.setTop8, { ids: [b] });
    await (await as(t, b)).mutation(api.social.setTop8, { ids: [a] });
    const d = await addProfile(t, "dave");
    await (await as(t, c)).mutation(api.social.sendFriendRequest, { to: a }); // incoming to alice
    await (await as(t, a)).mutation(api.social.sendFriendRequest, { to: d }); // outgoing from alice
    expect(await t.run((ctx) => ctx.db.query("friendRequests").collect())).toHaveLength(2);
    await (await as(t, a)).mutation(api.social.block, { other: b });
    await (await as(t, a)).mutation(api.social.block, { other: c });
    await (await as(t, a)).mutation(api.social.block, { other: d });
    expect(await t.run((ctx) => ctx.db.query("friendRequests").collect())).toHaveLength(0);
    expect(await friendsRows(t)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(a)))!.top8).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(b)))!.top8).toEqual([]);
    expect((await (await as(t, a)).query(api.home.dashboard, {}))!.pendingRequests).toHaveLength(0);
    await (await as(t, a)).mutation(api.social.unblock, { other: b });
    expect(await t.run((ctx) => ctx.db.query("blocks").collect())).toHaveLength(2);
    expect(await friendsRows(t)).toHaveLength(0);
  });

  test("block is idempotent", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const asA = await as(t, a);
    await asA.mutation(api.social.block, { other: b });
    await asA.mutation(api.social.block, { other: b });
    expect(await t.run((ctx) => ctx.db.query("blocks").collect())).toHaveLength(1);
  });

  test("the house profile cannot be blocked or unfriended", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const house = await addProfile(t, "house", { isHouse: true });
    await befriend(t, a, house);
    const asA = await as(t, a);
    await expect(asA.mutation(api.social.block, { other: house })).rejects.toThrow("Not allowed");
    await expect(asA.mutation(api.social.removeFriend, { other: house })).rejects.toThrow("Not allowed");
  });
});

describe("listFriends", () => {
  test("lists friends, omits banned, returns total", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    const d = await addProfile(t, "dave", { banned: true });
    for (const x of [b, c, d]) await befriend(t, a, x);
    const res = await t.query(api.social.listFriends, { username: "alice" });
    expect(res).not.toBeNull();
    expect(res!.friends.map((f) => f.username).sort()).toEqual(["bob", "carol"]);
    expect(res!.total).toBe(2);
  });

  test("unknown username gives null", async () => {
    const t = setup();
    expect(await t.query(api.social.listFriends, { username: "nobody" })).toBeNull();
  });
});

describe("resolve", () => {
  test("finds a profile id by username", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    expect(await t.query(api.social.profileIdByUsername, { username: "alice" })).toBe(a);
    expect(await t.query(api.social.profileIdByUsername, { username: "nobody" })).toBeNull();
  });
});

describe("relationship", () => {
  test("reports friends, self, pending and blocked for the viewer", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    const d = await addProfile(t, "dave");
    await befriend(t, a, b);
    const asA = await as(t, a);
    await asA.mutation(api.social.sendFriendRequest, { to: c });
    await asA.mutation(api.social.block, { other: d });
    const none = { signedIn: true, self: false, friends: false, pendingOut: false, blocked: false };
    expect(await asA.query(api.social.relationship, { username: "bob" })).toEqual({ ...none, friends: true });
    expect(await asA.query(api.social.relationship, { username: "alice" })).toEqual({ ...none, self: true });
    expect(await asA.query(api.social.relationship, { username: "carol" })).toEqual({ ...none, pendingOut: true });
    expect(await asA.query(api.social.relationship, { username: "dave" })).toEqual({ ...none, blocked: true });
    // The other side does not see a block or a pending request as theirs.
    expect(await (await as(t, d)).query(api.social.relationship, { username: "alice" })).toEqual(none);
    expect(await (await as(t, c)).query(api.social.relationship, { username: "alice" })).toEqual(none);
  });

  test("signed out, no profile, missing and banned", async () => {
    const t = setup();
    await addProfile(t, "alice");
    await addProfile(t, "gone", { banned: true });
    const off = { signedIn: false, self: false, friends: false, pendingOut: false, blocked: false };
    expect(await t.query(api.social.relationship, { username: "alice" })).toEqual(off);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "x@example.com", emailVerificationTime: Date.now() }),
    );
    const noProfile = t.withIdentity({ subject: `${userId}|s1` });
    expect(await noProfile.query(api.social.relationship, { username: "alice" })).toEqual({ ...off, signedIn: true });
    expect(await t.query(api.social.relationship, { username: "nobody" })).toBeNull();
    expect(await t.query(api.social.relationship, { username: "gone" })).toBeNull();
    expect(await t.query(api.social.relationship, { username: "!!" })).toBeNull();
  });
});

describe("myBlocked and myFriendsForTop8", () => {
  test("myBlocked lists only the caller's blocks", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const b = await addProfile(t, "bob");
    const c = await addProfile(t, "carol");
    await (await as(t, a)).mutation(api.social.block, { other: b });
    await (await as(t, b)).mutation(api.social.block, { other: c });
    const mine = await (await as(t, a)).query(api.social.myBlocked, {});
    expect(mine.map((r) => r.card.username)).toEqual(["bob"]);
    expect(mine[0].id).toBe(b);
    expect(await t.query(api.social.myBlocked, {})).toEqual([]);
    await (await as(t, a)).mutation(api.social.unblock, { other: b });
    expect(await (await as(t, a)).query(api.social.myBlocked, {})).toEqual([]);
  });

  test("myFriendsForTop8 flags the house profile", async () => {
    const t = setup();
    const a = await addProfile(t, "alice");
    const h = await addProfile(t, "house", { isHouse: true });
    const b = await addProfile(t, "bob");
    await befriend(t, a, h);
    await befriend(t, a, b);
    const rows = await (await as(t, a)).query(api.social.myFriendsForTop8, {});
    expect(rows.map((r) => [r.card.username, r.isHouse])).toEqual([
      ["bob", false],
      ["house", true],
    ]);
  });
});

describe("isHouseProfile", () => {
  test("true only for the house profile", async () => {
    const t = setup();
    await addProfile(t, "house", { isHouse: true });
    await addProfile(t, "bob");
    expect(await t.query(api.social.isHouseProfile, { username: "house" })).toBe(true);
    expect(await t.query(api.social.isHouseProfile, { username: "bob" })).toBe(false);
    expect(await t.query(api.social.isHouseProfile, { username: "nobody" })).toBe(false);
  });
});
