import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { onlineAsOf } from "../../convex/lib/presence";
import { addProfile, as, befriend, NOW, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const MIN = 60_000;
const presenceOf = (t: T, id: string) =>
  t.run((ctx) =>
    ctx.db
      .query("presence")
      .collect()
      .then((rows) => rows.filter((r) => r.profileId === id)),
  );

describe("presence.heartbeat", () => {
  test("writes only the presence row and leaves the profile doc alone", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    const before = await t.run((ctx) => ctx.db.get(id));
    const mia = await as(t, id);
    await mia.mutation(api.presence.heartbeat, {});
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
    const rows = await presenceOf(t, id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeenAt).toBe(NOW.getTime());
    // A second beat updates the same row.
    vi.setSystemTime(NOW.getTime() + 2 * MIN);
    await mia.mutation(api.presence.heartbeat, {});
    const again = await presenceOf(t, id);
    expect(again).toHaveLength(1);
    expect(again[0].lastSeenAt).toBe(NOW.getTime() + 2 * MIN);
  });

  test("needs a signed-in member with a profile", async () => {
    const t = setup();
    await expect(t.mutation(api.presence.heartbeat, {})).rejects.toThrow();
  });

  test("is limited to 2 a minute and silently ignores the rest", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    const mia = await as(t, id);
    await mia.mutation(api.presence.heartbeat, {});
    vi.setSystemTime(NOW.getTime() + 1000);
    await mia.mutation(api.presence.heartbeat, {});
    vi.setSystemTime(NOW.getTime() + 2000);
    await mia.mutation(api.presence.heartbeat, {});
    const rows = await presenceOf(t, id);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeenAt).toBe(NOW.getTime() + 1000);
  });

  test("deletes an existing row when showOnline is off", async () => {
    const t = setup();
    const id = await addProfile(t, "mia", { showOnline: false });
    await t.run((ctx) => ctx.db.insert("presence", { profileId: id, lastSeenAt: Date.now() }));
    await (await as(t, id)).mutation(api.presence.heartbeat, {});
    expect(await presenceOf(t, id)).toHaveLength(0);
  });

  test("refuses banned and unverified members and writes nothing", async () => {
    const t = setup();
    const banned = await addProfile(t, "bob", { banned: true });
    await expect((await as(t, banned)).mutation(api.presence.heartbeat, {})).rejects.toThrow("Account banned");
    const unv = await addProfile(t, "una");
    const p = await t.run((ctx) => ctx.db.get(unv));
    await t.run((ctx) => ctx.db.patch(p!.userId, { emailVerificationTime: undefined }));
    await expect((await as(t, unv)).mutation(api.presence.heartbeat, {})).rejects.toThrow("Email not verified");
    expect(await t.run((ctx) => ctx.db.query("presence").collect())).toHaveLength(0);
  });

  test("does nothing when showOnline is off", async () => {
    const t = setup();
    const id = await addProfile(t, "mia", { showOnline: false });
    await (await as(t, id)).mutation(api.presence.heartbeat, {});
    expect(await presenceOf(t, id)).toHaveLength(0);
  });
});

describe("online flag", () => {
  test("online within 5 minutes, offline after", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    await (await as(t, id)).mutation(api.presence.heartbeat, {});
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: true });
    vi.setSystemTime(NOW.getTime() + 5 * MIN - 1);
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: true });
    vi.setSystemTime(NOW.getTime() + 5 * MIN + 1);
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: false });
  });

  test("a profile with no presence row is offline", async () => {
    const t = setup();
    await addProfile(t, "mia");
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: false });
  });

  test("setShowOnline false deletes the row and hides the member; true allows beats again", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    const mia = await as(t, id);
    await mia.mutation(api.presence.heartbeat, {});
    await mia.mutation(api.presence.setShowOnline, { value: false });
    expect(await presenceOf(t, id)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(id)))!.showOnline).toBe(false);
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: false });
    // A stale row would still read offline when the flag is off.
    await t.run((ctx) => ctx.db.insert("presence", { profileId: id, lastSeenAt: Date.now() }));
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: false });
    await mia.mutation(api.presence.setShowOnline, { value: true });
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("presence").collect()) await ctx.db.delete(r._id);
    });
    await mia.mutation(api.presence.heartbeat, {});
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ online: true });
  });

  test("top8, friends page and Cool New People cards report online", async () => {
    const t = setup();
    const me = await addProfile(t, "mia");
    const on = await addProfile(t, "on", { hasPhoto: true });
    const off = await addProfile(t, "off", { hasPhoto: true });
    await befriend(t, me, on);
    await befriend(t, me, off);
    await t.run((ctx) => ctx.db.patch(me, { top8: [on, off] }));
    await (await as(t, on)).mutation(api.presence.heartbeat, {});

    const p = await t.query(api.profiles.getPublicProfile, { username: "mia" });
    if (p === null || "unavailable" in p || "restricted" in p) throw new Error("expected profile");
    expect(p.top8.map((c) => [c.username, c.online])).toEqual([
      ["on", true],
      ["off", false],
    ]);
    const friends = await t.query(api.social.listFriends, { username: "mia" });
    expect(friends!.friends.map((c) => [c.username, c.online])).toEqual([
      ["off", false],
      ["on", true],
    ]);
    const cool = await t.query(api.home.coolNewPeople, {});
    expect(cool.find((c) => c.username === "on")!.online).toBe(true);
    expect(cool.find((c) => c.username === "off")!.online).toBe(false);
  });
});

describe("asOf", () => {
  test("onlineAsOf uses asOf within 2 minutes of the clock and ignores it otherwise", () => {
    const now = NOW.getTime();
    expect(onlineAsOf(undefined, now)).toBe(now);
    expect(onlineAsOf(now - 2 * MIN, now)).toBe(now - 2 * MIN);
    expect(onlineAsOf(now + 2 * MIN, now)).toBe(now + 2 * MIN);
    expect(onlineAsOf(now - 2 * MIN - 1, now)).toBe(now);
    expect(onlineAsOf(now + 2 * MIN + 1, now)).toBe(now);
  });

  test("the result for a given asOf goes offline once asOf passes the window", async () => {
    const t = setup();
    const me = await addProfile(t, "mia", { hasPhoto: true });
    const friend = await addProfile(t, "pal", { hasPhoto: true });
    await befriend(t, me, friend);
    await t.run((ctx) => ctx.db.patch(me, { top8: [friend] }));
    await (await as(t, me)).mutation(api.presence.heartbeat, {});
    await (await as(t, friend)).mutation(api.presence.heartbeat, {});

    const read = async (asOf: number) => {
      const p = await t.query(api.profiles.getPublicProfile, { username: "mia", asOf });
      if (p === null || "unavailable" in p || "restricted" in p) throw new Error("expected profile");
      const friends = await t.query(api.social.listFriends, { username: "mia", asOf });
      const cool = await t.query(api.home.coolNewPeople, { asOf });
      return [
        p.online,
        p.top8[0].online,
        friends!.friends[0].online,
        cool.find((c) => c.username === "pal")!.online,
      ];
    };

    vi.setSystemTime(NOW.getTime() + 4 * MIN);
    expect(await read(NOW.getTime() + 4 * MIN)).toEqual([true, true, true, true]);
    vi.setSystemTime(NOW.getTime() + 5 * MIN);
    expect(await read(NOW.getTime() + 5 * MIN)).toEqual([false, false, false, false]);
  });

  test("asOf is used for the check: a minute-rounded asOf inside the slack decides", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    await (await as(t, id)).mutation(api.presence.heartbeat, {});
    // The clock says 5 minutes and 30 seconds (offline), the rounded minute says 5:00 minus 1ms (online).
    vi.setSystemTime(NOW.getTime() + 5 * MIN + 30_000);
    expect(
      await t.query(api.profiles.getPublicProfile, { username: "mia", asOf: NOW.getTime() + 5 * MIN - 1 }),
    ).toMatchObject({ online: true });
  });

  test("an out-of-range asOf is ignored", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    await (await as(t, id)).mutation(api.presence.heartbeat, {});
    // Far in the past while the member went offline: the clock decides.
    vi.setSystemTime(NOW.getTime() + 10 * MIN);
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia", asOf: NOW.getTime() })).toMatchObject({
      online: false,
    });
    // Far in the future while the member is online: still the clock.
    vi.setSystemTime(NOW.getTime() + MIN);
    expect(
      await t.query(api.profiles.getPublicProfile, { username: "mia", asOf: NOW.getTime() + 60 * MIN }),
    ).toMatchObject({ online: true });
  });

  test("the profile never carries lastSeenAt", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    await (await as(t, id)).mutation(api.presence.heartbeat, {});
    const p = await t.query(api.profiles.getPublicProfile, { username: "mia", asOf: NOW.getTime() });
    expect(JSON.stringify(p)).not.toContain("lastSeenAt");
  });
});

describe("presence.setShowOnline limit", () => {
  test("is limited to 30 an hour", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    const mia = await as(t, id);
    for (let i = 0; i < 30; i++) await mia.mutation(api.presence.setShowOnline, { value: i % 2 === 0 });
    await expect(mia.mutation(api.presence.setShowOnline, { value: true })).rejects.toThrow("Slow down");
    vi.setSystemTime(NOW.getTime() + 61 * MIN);
    await mia.mutation(api.presence.setShowOnline, { value: true });
  });

  test("refuses a signed-out caller before counting", async () => {
    const t = setup();
    await expect(t.mutation(api.presence.setShowOnline, { value: true })).rejects.toThrow("Not signed in");
  });
});
