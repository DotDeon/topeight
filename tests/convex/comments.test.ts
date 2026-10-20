import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { DAY, NOW, addProfile, as, block, setup } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** Two members whose accounts are old enough to post links. */
async function pair() {
  const t = setup();
  const owner = await addProfile(t, "owner");
  const guest = await addProfile(t, "guest");
  vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
  return { t, owner, guest };
}

describe("comments.add", () => {
  test("adds a trimmed comment that shows in the list", async () => {
    const { t, owner, guest } = await pair();
    await (await as(t, guest)).mutation(api.comments.add, { profileId: owner, body: "  hello  " });
    const res = await t.query(api.comments.list, { username: "owner", cursor: null });
    expect(res.page.map((c) => c.body)).toEqual(["hello"]);
    expect(res.page[0].author.username).toBe("guest");
    expect(res.page[0].canDelete).toBe(false);
  });

  test("rejects empty and too long bodies", async () => {
    const { t, owner, guest } = await pair();
    const g = await as(t, guest);
    await expect(g.mutation(api.comments.add, { profileId: owner, body: "   " })).rejects.toThrow("Comment can't be empty");
    await expect(g.mutation(api.comments.add, { profileId: owner, body: "x".repeat(2001) })).rejects.toThrow("Comment is too long");
    await g.mutation(api.comments.add, { profileId: owner, body: "x".repeat(2000) });
  });

  test("a blocked user cannot comment and old comments leave the wall", async () => {
    const { t, owner, guest } = await pair();
    const g = await as(t, guest);
    await g.mutation(api.comments.add, { profileId: owner, body: "before the block" });
    await block(t, owner, guest);
    await expect(g.mutation(api.comments.add, { profileId: owner, body: "after" })).rejects.toThrow("Not allowed");
    expect((await t.query(api.comments.list, { username: "owner", cursor: null })).page).toHaveLength(0);
    const profile = await t.query(api.profiles.getPublicProfile, { username: "owner" });
    expect(profile && !("unavailable" in profile) && !("restricted" in profile) && profile.comments).toHaveLength(0);
  });

  test("a block in the other direction also stops the comment", async () => {
    const { t, owner, guest } = await pair();
    await block(t, guest, owner);
    await expect((await as(t, guest)).mutation(api.comments.add, { profileId: owner, body: "hi" })).rejects.toThrow("Not allowed");
  });

  test("signed-out callers are refused", async () => {
    const { t, owner } = await pair();
    await expect(t.mutation(api.comments.add, { profileId: owner, body: "hi" })).rejects.toThrow("Not signed in");
  });

  test("accounts under 24 hours cannot post links, images included", async () => {
    const t = setup();
    const owner = await addProfile(t, "owner");
    const fresh = await addProfile(t, "fresh");
    const f = await as(t, fresh);
    for (const body of ["see https://a.com", "see www.a.com", "pic https://a.com/x.gif"]) {
      await expect(f.mutation(api.comments.add, { profileId: owner, body })).rejects.toThrow("New accounts can't post links yet");
    }
    await f.mutation(api.comments.add, { profileId: owner, body: "plain text is fine" });
    vi.setSystemTime(new Date(NOW.getTime() + DAY + 1000));
    await f.mutation(api.comments.add, { profileId: owner, body: "see https://a.com" });
  });

  test("rejected comments do not use up the hourly quota", async () => {
    const t = setup();
    const owner = await addProfile(t, "owner");
    const fresh = await addProfile(t, "fresh");
    const blocker = await addProfile(t, "blocker");
    await block(t, blocker, fresh);
    const f = await as(t, fresh);
    for (let i = 0; i < 35; i++) {
      await expect(f.mutation(api.comments.add, { profileId: owner, body: " " })).rejects.toThrow("can't be empty");
      await expect(f.mutation(api.comments.add, { profileId: owner, body: "https://a.com" })).rejects.toThrow("New accounts");
      await expect(f.mutation(api.comments.add, { profileId: blocker, body: "hi" })).rejects.toThrow("Not allowed");
    }
    for (let i = 0; i < 30; i++) await f.mutation(api.comments.add, { profileId: owner, body: `c${i}` });
    await expect(f.mutation(api.comments.add, { profileId: owner, body: "one more" })).rejects.toThrow("Slow down");
  });

  test("the 31st comment in an hour is refused", async () => {
    const { t, owner, guest } = await pair();
    const g = await as(t, guest);
    for (let i = 0; i < 30; i++) await g.mutation(api.comments.add, { profileId: owner, body: `c${i}` });
    await expect(g.mutation(api.comments.add, { profileId: owner, body: "one more" })).rejects.toThrow("Slow down");
  });
});

describe("comments.remove", () => {
  test("only the owner or the author can remove", async () => {
    const { t, owner, guest } = await pair();
    const other = await addProfile(t, "other");
    const g = await as(t, guest);
    await g.mutation(api.comments.add, { profileId: owner, body: "a" });
    await g.mutation(api.comments.add, { profileId: owner, body: "b" });
    const q = { username: "owner", cursor: null };
    const list = async (viewer: { query: typeof t.query } = t) => (await viewer.query(api.comments.list, q)).page;
    const [first, second] = await list();
    await expect((await as(t, other)).mutation(api.comments.remove, { commentId: first.id })).rejects.toThrow("Not allowed");
    expect((await list(await as(t, owner))).every((c) => c.canDelete)).toBe(true);
    expect((await list(g)).every((c) => c.canDelete)).toBe(true);
    expect((await list(await as(t, other))).some((c) => c.canDelete)).toBe(false);
    await g.mutation(api.comments.remove, { commentId: first.id });
    await (await as(t, owner)).mutation(api.comments.remove, { commentId: second.id });
    expect(await list()).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("comments").collect())).toHaveLength(0);
  });
});

describe("comments.list", () => {
  test("pages 50 at a time, hides hidden comments and banned authors", async () => {
    const { t, owner, guest } = await pair();
    const banned = await addProfile(t, "banned", { banned: true });
    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) await ctx.db.insert("comments", { profileId: owner, authorId: guest, body: `c${i}`, hidden: false });
      await ctx.db.insert("comments", { profileId: owner, authorId: guest, body: "secret", hidden: true });
      await ctx.db.insert("comments", { profileId: owner, authorId: banned, body: "gone", hidden: false });
    });
    const first = await t.query(api.comments.list, { username: "owner", cursor: null });
    expect(first.isDone).toBe(false);
    const bodies = first.page.map((c) => c.body);
    expect(bodies).not.toContain("secret");
    expect(bodies).not.toContain("gone");
    const second = await t.query(api.comments.list, { username: "owner", cursor: first.continueCursor });
    const all = [...first.page, ...second.page].map((c) => c.body);
    expect(all).toHaveLength(55);
    expect(all[0]).toBe("c54");
  });

  test("unknown username gives an empty finished page", async () => {
    const t = setup();
    const res = await t.query(api.comments.list, { username: "nobody", cursor: null });
    expect(res).toMatchObject({ page: [], isDone: true });
  });
});
