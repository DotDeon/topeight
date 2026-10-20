import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MOOD_ICONS } from "../../lib/moods";
import { DAY, NOW, addProfile, as, befriend, block, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** An author and a reader, both old enough to post links. */
async function pair() {
  const t = setup();
  const author = await addProfile(t, "author");
  const reader = await addProfile(t, "reader");
  vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
  return { t, author, reader };
}

async function post(t: T, who: Id<"profiles">, extra: Record<string, unknown> = {}) {
  return await (await as(t, who)).mutation(api.blog.create, { title: "My day", body: "It was fine", ...extra });
}

const tick = () => vi.setSystemTime(new Date(Date.now() + 1000));

describe("lib/moods", () => {
  test("has exactly 20 distinct icons", () => {
    expect(MOOD_ICONS).toHaveLength(20);
    expect(new Set(MOOD_ICONS).size).toBe(20);
  });
});

describe("blog.create", () => {
  test("stores trimmed fields and shows on the author's blog", async () => {
    const { t, author } = await pair();
    const id = await post(t, author, {
      title: "  Hello  ",
      body: "  first post  ",
      mood: { text: " sleepy ", icon: "sleepy" },
      listening: "  The Postal Service  ",
    });
    const got = await t.query(api.blog.get, { id });
    expect(got).toMatchObject({
      id,
      title: "Hello",
      body: "first post",
      mood: { text: "sleepy", icon: "sleepy" },
      listening: "The Postal Service",
      author: { username: "author" },
      commentCount: 0,
      canEdit: false,
    });
    const page = await t.query(api.blog.listByUser, { username: "author", cursor: null });
    expect(page.page.map((p) => p.id)).toEqual([id]);
  });

  test("title, body, mood and listening limits", async () => {
    const { t, author } = await pair();
    const a = await as(t, author);
    const make = (extra: Record<string, unknown>) =>
      a.mutation(api.blog.create, { title: "t", body: "b", ...extra });
    await expect(make({ title: "  " })).rejects.toThrow("Title can't be empty");
    await expect(make({ title: "x".repeat(101) })).rejects.toThrow("Title is too long");
    await expect(make({ body: " " })).rejects.toThrow("Post can't be empty");
    await expect(make({ body: "x".repeat(20001) })).rejects.toThrow("Post is too long");
    await expect(make({ mood: { text: "x".repeat(41), icon: "happy" } })).rejects.toThrow("Mood is too long");
    await expect(make({ mood: { text: "ok", icon: "not-a-mood" } })).rejects.toThrow();
    await expect(make({ listening: "x".repeat(101) })).rejects.toThrow("Listening is too long");
    await make({
      title: "x".repeat(100),
      body: "x".repeat(20000),
      mood: { text: "x".repeat(40), icon: MOOD_ICONS[19] },
      listening: "x".repeat(100),
    });
  });

  test("blank listening is dropped", async () => {
    const { t, author } = await pair();
    const id = await post(t, author, { listening: "   " });
    const got = await t.query(api.blog.get, { id });
    expect(got).not.toHaveProperty("listening");
  });

  test("accounts under 24 hours cannot post links in any field", async () => {
    const t = setup();
    const fresh = await addProfile(t, "fresh");
    const f = await as(t, fresh);
    const base = { title: "t", body: "b" };
    for (const extra of [
      { title: "see https://a.com" },
      { body: "see www.a.com" },
      { body: "pic https://a.com/x.gif" },
      { mood: { text: "https://a.com", icon: "happy" as const } },
      { listening: "www.a.com" },
    ]) {
      await expect(f.mutation(api.blog.create, { ...base, ...extra })).rejects.toThrow(
        "New accounts can't post links yet",
      );
    }
    await f.mutation(api.blog.create, base);
    vi.setSystemTime(new Date(NOW.getTime() + DAY + 1000));
    await f.mutation(api.blog.create, { ...base, body: "see https://a.com" });
  });

  test("10 posts a day, rejected posts do not count", async () => {
    const { t, author } = await pair();
    const a = await as(t, author);
    await expect(a.mutation(api.blog.create, { title: "", body: "b" })).rejects.toThrow();
    for (let i = 0; i < 10; i++) await a.mutation(api.blog.create, { title: `t${i}`, body: "b" });
    await expect(a.mutation(api.blog.create, { title: "t", body: "b" })).rejects.toThrow("Slow down");
  });

  test("signed-out callers are refused", async () => {
    const { t } = await pair();
    await expect(t.mutation(api.blog.create, { title: "t", body: "b" })).rejects.toThrow("Not signed in");
  });
});

describe("blog.update and blog.remove", () => {
  test("only the author edits, and edits replace optional fields", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author, { mood: { text: "ok", icon: "happy" }, listening: "x" });
    await expect(
      (await as(t, reader)).mutation(api.blog.update, { id, title: "hax", body: "hax" }),
    ).rejects.toThrow("Not allowed");
    await (await as(t, author)).mutation(api.blog.update, { id, title: "New", body: "Edited" });
    const got = await (await as(t, author)).query(api.blog.get, { id });
    expect(got).toMatchObject({ title: "New", body: "Edited", canEdit: true });
    expect(got).not.toHaveProperty("mood");
    expect(got).not.toHaveProperty("listening");
  });

  test("update checks limits and the link rule", async () => {
    const t = setup();
    const fresh = await addProfile(t, "fresh");
    const id = await post(t, fresh);
    const f = await as(t, fresh);
    await expect(f.mutation(api.blog.update, { id, title: "", body: "b" })).rejects.toThrow("Title can't be empty");
    await expect(f.mutation(api.blog.update, { id, title: "t", body: "www.a.com" })).rejects.toThrow(
      "New accounts can't post links yet",
    );
  });

  test("only the author deletes, and comments go with the post", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author);
    await (await as(t, reader)).mutation(api.blog.addComment, { postId: id, body: "nice" });
    await expect((await as(t, reader)).mutation(api.blog.remove, { id })).rejects.toThrow("Not allowed");
    await (await as(t, author)).mutation(api.blog.remove, { id });
    expect(await t.query(api.blog.get, { id })).toBeNull();
    const left = await t.run((ctx) => ctx.db.query("blogComments").take(10));
    expect(left).toHaveLength(0);
  });

  test("deleting a post with many comments finishes in a scheduled cleanup", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author);
    await t.run(async (ctx) => {
      for (let i = 0; i < 1200; i++) {
        await ctx.db.insert("blogComments", { postId: id, authorId: reader, body: "c", hidden: false });
      }
    });
    vi.useFakeTimers();
    await (await as(t, author)).mutation(api.blog.remove, { id });
    expect(await t.run((ctx) => ctx.db.query("blogComments").take(1000))).toHaveLength(700);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("blogComments").take(10))).toHaveLength(0);
  });
});

describe("reading posts", () => {
  test("listByUser pages 10 at a time, newest first", async () => {
    const { t, author } = await pair();
    const ids: Id<"blogPosts">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        ids.push(await ctx.db.insert("blogPosts", { authorId: author, title: `t${i}`, body: "b", hidden: false }));
      }
    });
    const first = await t.query(api.blog.listByUser, { username: "author", cursor: null });
    expect(first.page).toHaveLength(10);
    expect(first.page[0].id).toBe(ids[11]);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.blog.listByUser, { username: "author", cursor: first.continueCursor });
    expect(second.page.map((p) => p.id)).toEqual([ids[1], ids[0]]);
  });

  test("hidden posts are gone for everyone, the author too", async () => {
    const { t, author } = await pair();
    const id = await post(t, author);
    await t.run((ctx) => ctx.db.patch(id, { hidden: true }));
    const a = await as(t, author);
    expect(await a.query(api.blog.get, { id })).toBeNull();
    expect((await a.query(api.blog.listByUser, { username: "author", cursor: null })).page).toHaveLength(0);
    await expect(a.mutation(api.blog.update, { id, title: "t", body: "b" })).rejects.toThrow("Not found");
  });

  test("a banned author's posts are gone", async () => {
    const { t, author } = await pair();
    const id = await post(t, author);
    await t.run((ctx) => ctx.db.patch(author, { banned: true }));
    expect(await t.query(api.blog.get, { id })).toBeNull();
    expect((await t.query(api.blog.listByUser, { username: "author", cursor: null })).page).toHaveLength(0);
  });

  test("get returns null for a malformed id", async () => {
    const { t } = await pair();
    expect(await t.query(api.blog.get, { id: "nope" })).toBeNull();
  });
});

describe("blog.friendsFeed", () => {
  test("newest friends' posts, skipping hidden posts, banned friends and strangers", async () => {
    const { t, author, reader } = await pair();
    const banned = await addProfile(t, "banned");
    const stranger = await addProfile(t, "stranger");
    await befriend(t, reader, author);
    await befriend(t, reader, banned);
    const older = await post(t, author, { title: "older", mood: { text: "meh", icon: "bored" } });
    tick();
    const hidden = await post(t, author, { title: "hidden" });
    await t.run((ctx) => ctx.db.patch(hidden, { hidden: true }));
    tick();
    await post(t, banned, { title: "banned" });
    await post(t, stranger, { title: "stranger" });
    tick();
    const newer = await post(t, author, { title: "newer" });
    await t.run((ctx) => ctx.db.patch(banned, { banned: true }));

    const feed = await (await as(t, reader)).query(api.blog.friendsFeed, {});
    expect(feed.map((p) => p.id)).toEqual([newer, older]);
    expect(feed[1]).toMatchObject({ title: "older", author: { username: "author" }, mood: { text: "meh", icon: "bored" } });
    expect(feed[0]).not.toHaveProperty("body");
  });

  test("signed out gets an empty feed", async () => {
    const { t } = await pair();
    expect(await t.query(api.blog.friendsFeed, {})).toEqual([]);
  });

  test("bounded: 3 posts per friend, 30 posts in all", async () => {
    const { t, reader } = await pair();
    const friends: Id<"profiles">[] = [];
    for (let i = 0; i < 12; i++) {
      const f = await addProfile(t, `friend${i}`);
      await befriend(t, reader, f);
      friends.push(f);
    }
    await t.run(async (ctx) => {
      for (const f of friends) {
        for (let j = 0; j < 5; j++) {
          await ctx.db.insert("blogPosts", { authorId: f, title: `p${j}`, body: "b", hidden: false });
        }
      }
    });
    const feed = await (await as(t, reader)).query(api.blog.friendsFeed, {});
    expect(feed).toHaveLength(30);
    const perFriend = new Map<string, number>();
    for (const p of feed) perFriend.set(p.author.username, (perFriend.get(p.author.username) ?? 0) + 1);
    expect(Math.max(...perFriend.values())).toBeLessThanOrEqual(3);
    for (let i = 1; i < feed.length; i++) expect(feed[i - 1].createdAt).toBeGreaterThanOrEqual(feed[i].createdAt);
  });
});

describe("blog comments", () => {
  test("add, list oldest first, and limits", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author);
    const r = await as(t, reader);
    await expect(r.mutation(api.blog.addComment, { postId: id, body: "  " })).rejects.toThrow("Comment can't be empty");
    await expect(r.mutation(api.blog.addComment, { postId: id, body: "x".repeat(2001) })).rejects.toThrow(
      "Comment is too long",
    );
    await r.mutation(api.blog.addComment, { postId: id, body: " first " });
    tick();
    await r.mutation(api.blog.addComment, { postId: id, body: "x".repeat(2000) });
    const res = await r.query(api.blog.comments, { postId: id, cursor: null });
    expect(res.page.map((c) => c.body)).toEqual(["first", "x".repeat(2000)]);
    expect(res.page[0]).toMatchObject({ author: { username: "reader" }, canDelete: true });
    expect((await t.query(api.blog.get, { id }))?.commentCount).toBe(2);
  });

  test("a blocked pair cannot comment, either direction", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author);
    await block(t, author, reader);
    await expect((await as(t, reader)).mutation(api.blog.addComment, { postId: id, body: "hi" })).rejects.toThrow(
      "Not allowed",
    );
    const t2 = await pair();
    const id2 = await post(t2.t, t2.author);
    await block(t2.t, t2.reader, t2.author);
    await expect(
      (await as(t2.t, t2.reader)).mutation(api.blog.addComment, { postId: id2, body: "hi" }),
    ).rejects.toThrow("Not allowed");
  });

  test("the link rule applies to comments", async () => {
    const t = setup();
    const author = await addProfile(t, "author");
    const id = await post(t, author);
    const fresh = await addProfile(t, "fresh");
    await expect(
      (await as(t, fresh)).mutation(api.blog.addComment, { postId: id, body: "www.a.com" }),
    ).rejects.toThrow("New accounts can't post links yet");
  });

  test("no comments on hidden posts or banned authors' posts", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author);
    await t.run((ctx) => ctx.db.patch(id, { hidden: true }));
    await expect((await as(t, reader)).mutation(api.blog.addComment, { postId: id, body: "hi" })).rejects.toThrow(
      "Not found",
    );
  });

  test("shares the hourly comment limit with profile comments, refused ones are free", async () => {
    const { t, author, reader } = await pair();
    const id = await post(t, author);
    const r = await as(t, reader);
    for (let i = 0; i < 5; i++) {
      await expect(r.mutation(api.blog.addComment, { postId: id, body: "" })).rejects.toThrow();
    }
    for (let i = 0; i < 15; i++) await r.mutation(api.comments.add, { profileId: author, body: "hi" });
    for (let i = 0; i < 15; i++) await r.mutation(api.blog.addComment, { postId: id, body: "hi" });
    await expect(r.mutation(api.blog.addComment, { postId: id, body: "hi" })).rejects.toThrow("Slow down");
  });

  test("the comment author or the post author can delete, nobody else", async () => {
    const { t, author, reader } = await pair();
    const other = await addProfile(t, "other");
    const id = await post(t, author);
    const r = await as(t, reader);
    await r.mutation(api.blog.addComment, { postId: id, body: "one" });
    await r.mutation(api.blog.addComment, { postId: id, body: "two" });
    const [one, two] = (await t.query(api.blog.comments, { postId: id, cursor: null })).page;
    await expect((await as(t, other)).mutation(api.blog.removeComment, { id: one.id })).rejects.toThrow("Not allowed");
    await r.mutation(api.blog.removeComment, { id: one.id });
    await (await as(t, author)).mutation(api.blog.removeComment, { id: two.id });
    expect((await t.query(api.blog.comments, { postId: id, cursor: null })).page).toHaveLength(0);
  });

  test("hidden comments, banned commenters and blocked commenters drop out of the list", async () => {
    const { t, author, reader } = await pair();
    const banned = await addProfile(t, "banned");
    const blocked = await addProfile(t, "blocked");
    const id = await post(t, author);
    await (await as(t, reader)).mutation(api.blog.addComment, { postId: id, body: "hidden" });
    await (await as(t, banned)).mutation(api.blog.addComment, { postId: id, body: "banned" });
    await (await as(t, blocked)).mutation(api.blog.addComment, { postId: id, body: "blocked" });
    await (await as(t, reader)).mutation(api.blog.addComment, { postId: id, body: "kept" });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("blogComments").take(10);
      await ctx.db.patch(rows.find((c) => c.body === "hidden")!._id, { hidden: true });
      await ctx.db.patch(banned, { banned: true });
    });
    await block(t, reader, blocked);
    const viewer = await as(t, reader);
    expect((await viewer.query(api.blog.comments, { postId: id, cursor: null })).page.map((c) => c.body)).toEqual([
      "kept",
    ]);
    // Someone who blocked nobody still sees the blocked member's comment.
    expect((await t.query(api.blog.comments, { postId: id, cursor: null })).page.map((c) => c.body)).toEqual([
      "blocked",
      "kept",
    ]);
  });
});

describe("moderation", () => {
  async function withAdmin() {
    const w = await pair();
    const boss = await addProfile(w.t, "boss");
    return { ...w, boss };
  }

  test("reports on a post and a comment preview and hide", async () => {
    const { t, author, reader, boss } = await withAdmin();
    const id = await post(t, author, { title: "Bad", body: "bad body" });
    const r = await as(t, reader);
    await r.mutation(api.blog.addComment, { postId: id, body: "bad comment" });
    const [comment] = (await t.query(api.blog.comments, { postId: id, cursor: null })).page;
    await r.mutation(api.moderation.report, { targetType: "blogPost", targetId: id, reason: "spam" });
    await r.mutation(api.moderation.report, { targetType: "blogComment", targetId: comment.id, reason: "rude" });

    const b = await as(t, boss);
    const open = await b.query(api.moderation.listOpen, {});
    expect(open.map((o) => o.preview)).toEqual([
      expect.objectContaining({ kind: "blogPost", title: "Bad", body: "bad body", authorId: author }),
      expect.objectContaining({ kind: "blogComment", body: "bad comment", authorId: reader }),
    ]);
    for (const o of open) await b.mutation(api.moderation.hide, { reportId: o.id });
    const rows = await t.run(async (ctx) => [await ctx.db.get(id), await ctx.db.get(comment.id)]);
    expect(rows.map((row) => row?.hidden)).toEqual([true, true]);
    expect(await t.query(api.blog.get, { id })).toBeNull();
  });
});

describe("getPublicProfile latestBlog", () => {
  async function latest(t: T) {
    const p = await t.query(api.profiles.getPublicProfile, { username: "author" });
    if (!p || "unavailable" in p) throw new Error("expected a profile");
    return p.latestBlog;
  }

  test("is the newest visible post, null when there is none", async () => {
    const { t, author } = await pair();
    expect(await latest(t)).toBeNull();
    const first = await post(t, author, { title: "first" });
    tick();
    const second = await post(t, author, { title: "second" });
    expect(await latest(t)).toMatchObject({ id: second, title: "second" });
    await t.run((ctx) => ctx.db.patch(second, { hidden: true }));
    const got = await latest(t);
    expect(got).toMatchObject({ id: first, title: "first" });
    expect(typeof got?.createdAt).toBe("number");
  });
});
