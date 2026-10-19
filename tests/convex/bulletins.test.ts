import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { DAY, NOW, addProfile, as, befriend, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("bulletins.feed", () => {
  test("friends and me only, last 10 days, newest first, no banned or hidden", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const pal = await addProfile(t, "pal");
    const banned = await addProfile(t, "banned");
    const stranger = await addProfile(t, "stranger");
    await befriend(t, me, pal);
    await befriend(t, me, banned);
    const post = (authorId: typeof me, body: string, hidden = false) =>
      t.run((ctx) => ctx.db.insert("bulletins", { authorId, body, hidden }));
    await post(pal, "old"); // created now, aged below
    vi.setSystemTime(new Date(NOW.getTime() + 11 * DAY));
    await post(pal, "first");
    await post(pal, "hidden", true);
    await post(banned, "from banned");
    await post(stranger, "from stranger");
    vi.setSystemTime(new Date(NOW.getTime() + 11 * DAY + 1000));
    await post(me, "mine");
    await t.run((ctx) => ctx.db.patch(banned, { banned: true }));
    vi.setSystemTime(new Date(NOW.getTime() + 11 * DAY + 2000));
    await post(pal, "second");
    const feed = await (await as(t, me)).query(api.bulletins.feed, {});
    expect(feed.bulletins.map((b) => b.body)).toEqual(["second", "mine", "first"]);
  });

  test("signed-in users without a usable profile get an empty feed and a status", async () => {
    const t = setup();
    const banned = await addProfile(t, "banned", { banned: true });
    expect(await (await as(t, banned)).query(api.bulletins.feed, {})).toEqual({ status: "suspended", bulletins: [] });
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "x@example.com", emailVerificationTime: 1 }));
    expect(await t.withIdentity({ subject: `${userId}|s1` }).query(api.bulletins.feed, {})).toEqual({
      status: "no-profile",
      bulletins: [],
    });
    const unverified = await t.run((ctx) => ctx.db.insert("users", { email: "y@example.com" }));
    expect(await t.withIdentity({ subject: `${unverified}|s1` }).query(api.bulletins.feed, {})).toEqual({
      status: "unverified",
      bulletins: [],
    });
  });

  test("signed-out callers are refused", async () => {
    const t = setup();
    await expect(t.query(api.bulletins.feed, {})).rejects.toThrow("Not signed in");
  });
});

describe("bulletins.post and remove", () => {
  test("posts a trimmed bulletin, enforces limits", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const m = await as(t, me);
    await expect(m.mutation(api.bulletins.post, { body: " " })).rejects.toThrow("Bulletin can't be empty");
    await expect(m.mutation(api.bulletins.post, { body: "x".repeat(5001) })).rejects.toThrow("Bulletin is too long");
    await m.mutation(api.bulletins.post, { body: "  hi all " });
    expect((await m.query(api.bulletins.feed, {})).bulletins.map((b) => b.body)).toEqual(["hi all"]);
  });

  test("new accounts cannot post links", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    await expect((await as(t, me)).mutation(api.bulletins.post, { body: "https://a.com/x.png" })).rejects.toThrow(
      "New accounts can't post links yet",
    );
  });

  test("the 11th bulletin in an hour is refused", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const m = await as(t, me);
    for (let i = 0; i < 10; i++) await m.mutation(api.bulletins.post, { body: `b${i}` });
    await expect(m.mutation(api.bulletins.post, { body: "more" })).rejects.toThrow("Slow down");
  });

  test("rejected bulletins do not use up the hourly quota", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const m = await as(t, me);
    for (let i = 0; i < 12; i++) {
      await expect(m.mutation(api.bulletins.post, { body: "  " })).rejects.toThrow("can't be empty");
      await expect(m.mutation(api.bulletins.post, { body: "https://a.com" })).rejects.toThrow("New accounts");
    }
    for (let i = 0; i < 10; i++) await m.mutation(api.bulletins.post, { body: `b${i}` });
  });

  test("only the author can remove", async () => {
    const t = setup();
    const me = await addProfile(t, "me");
    const pal = await addProfile(t, "pal");
    await befriend(t, me, pal);
    await (await as(t, me)).mutation(api.bulletins.post, { body: "mine" });
    const [b] = (await (await as(t, me)).query(api.bulletins.feed, {})).bulletins;
    await expect((await as(t, pal)).mutation(api.bulletins.remove, { bulletinId: b.id })).rejects.toThrow("Not allowed");
    await (await as(t, me)).mutation(api.bulletins.remove, { bulletinId: b.id });
    expect((await (await as(t, me)).query(api.bulletins.feed, {})).bulletins).toHaveLength(0);
  });
});
