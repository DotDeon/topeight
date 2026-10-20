import r2Test from "@convex-dev/r2/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { slugify } from "../../convex/groups";
import { storage } from "../../convex/lib/r2";
import { DAY, NOW, addProfile, as, block, setup } from "./helpers";

type T = ReturnType<typeof setup>;

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** An owner, a member, an outsider and an admin, all eight days old. */
async function world() {
  const t = setup();
  r2Test.register(t);
  const owner = await addProfile(t, "owner");
  const member = await addProfile(t, "member");
  const other = await addProfile(t, "other");
  const boss = await addProfile(t, "boss");
  vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
  return { t, owner, member, other, boss };
}

const base = { name: "Rock Fans", description: "We like rock", category: "music" as const };

async function create(t: T, who: Id<"profiles">, extra: Record<string, unknown> = {}) {
  return await (await as(t, who)).mutation(api.groups.create, { ...base, ...extra });
}

async function groupBySlug(t: T, slug: string) {
  return await t.run((ctx) =>
    ctx.db
      .query("groups")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique(),
  );
}

/** A group owned by `owner` with `member` joined. */
async function withGroup() {
  const w = await world();
  const { slug } = await create(w.t, w.owner);
  const group = (await groupBySlug(w.t, slug))!;
  await (await as(w.t, w.member)).mutation(api.groups.join, { groupId: group._id });
  return { ...w, slug, groupId: group._id };
}

async function groupRow(t: T, groupId: Id<"groups">) {
  const row = await t.run((ctx) => ctx.db.get(groupId));
  if (row === null) throw new Error("no group");
  return row;
}

async function memberCount(t: T, groupId: Id<"groups">) {
  return (await groupRow(t, groupId)).memberCount;
}

async function startTopic(t: T, who: Id<"profiles">, groupId: Id<"groups">, title = "Hello", body = "First post") {
  return await (await as(t, who)).mutation(api.groups.startTopic, { groupId, title, body });
}

async function insertGroup(t: T, ownerId: Id<"profiles">, slug: string, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("groups", {
      slug,
      name: slug,
      description: "",
      category: "music",
      ownerId,
      deleted: false,
      hidden: false,
      memberCount: 1,
      ...extra,
    }),
  );
}

describe("slugify", () => {
  test("lowercases, keeps a-z0-9, collapses hyphens and trims them", () => {
    expect(slugify("My Cool Band!!")).toBe("my-cool-band");
    expect(slugify("  --Hello__World--  ")).toBe("hello-world");
    expect(slugify("Café Ünïcode")).toBe("cafe-unicode");
    expect(slugify("!!!")).toBe("");
  });

  test("caps at 60 characters without a trailing hyphen", () => {
    const s = slugify(`${"a".repeat(59)} b`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
    expect(slugify("x".repeat(80))).toBe("x".repeat(60));
  });
});

describe("groups.create", () => {
  test("stores trimmed fields and makes the owner the first member", async () => {
    const { t, owner } = await world();
    const { slug } = await create(t, owner, { name: "  Rock Fans  ", description: "  We like rock  " });
    expect(slug).toBe("rock-fans");
    const g = (await groupBySlug(t, slug))!;
    expect(g).toMatchObject({
      name: "Rock Fans",
      description: "We like rock",
      category: "music",
      ownerId: owner,
      deleted: false,
      hidden: false,
      memberCount: 1,
    });
    const view = await (await as(t, owner)).query(api.groups.get, { slug });
    expect(view).toMatchObject({ isMember: true, isOwner: true, isBanned: false, memberCount: 1 });
  });

  test("accounts under a week old cannot create a group", async () => {
    const { t } = await world();
    const young = await addProfile(t, "young");
    vi.setSystemTime(new Date(Date.now() + 6 * DAY));
    await expect(create(t, young)).rejects.toThrow("Your account must be a week old to create a group");
  });

  test("checks the name and description", async () => {
    const { t, owner } = await world();
    await expect(create(t, owner, { name: "ab" })).rejects.toThrow("Name is too short");
    await expect(create(t, owner, { name: "a".repeat(61) })).rejects.toThrow("Name is too long");
    await expect(create(t, owner, { name: "!!!!" })).rejects.toThrow("Name needs letters or numbers");
    await expect(create(t, owner, { description: "d".repeat(2001) })).rejects.toThrow("Description is too long");
    await expect(create(t, owner, { description: "" })).resolves.toBeTruthy();
  });

  test("slug collisions get -2, -3, and give up after -50", async () => {
    const { t, owner, member } = await world();
    expect((await create(t, owner)).slug).toBe("rock-fans");
    expect((await create(t, owner, { name: "ROCK fans!" })).slug).toBe("rock-fans-2");
    expect((await create(t, member)).slug).toBe("rock-fans-3");
    for (let i = 4; i <= 50; i++) await insertGroup(t, owner, `rock-fans-${i}`);
    await expect(create(t, member)).rejects.toThrow("Pick a different name");
  });

  test("three a day, and refused groups cost no quota", async () => {
    const { t, owner } = await world();
    await expect(create(t, owner, { name: "x" })).rejects.toThrow("Name is too short");
    for (let i = 0; i < 3; i++) await create(t, owner, { name: `Group ${i}` });
    await expect(create(t, owner, { name: "Group 4" })).rejects.toThrow("Slow down");
  });
});

describe("groups.update and remove", () => {
  test("the owner edits name, description and category; the slug stays", async () => {
    const { t, owner, groupId, slug } = await withGroup();
    await (await as(t, owner)).mutation(api.groups.update, {
      groupId,
      name: "Jazz Cats",
      description: "Now jazz",
      category: "hobbies",
    });
    const g = (await groupRow(t, groupId));
    expect(g).toMatchObject({ slug, name: "Jazz Cats", description: "Now jazz", category: "hobbies" });
  });

  test("non-owners get Not allowed from every owner tool", async () => {
    const { t, member, owner, groupId } = await withGroup();
    const { replyId } = await startTopic(t, owner, groupId);
    const m = await as(t, member);
    await expect(m.mutation(api.groups.update, { groupId, ...base })).rejects.toThrow("Not allowed");
    await expect(m.mutation(api.groups.remove, { groupId })).rejects.toThrow("Not allowed");
    await expect(m.mutation(api.groups.removePost, { replyId })).rejects.toThrow("Not allowed");
    await expect(m.mutation(api.groups.removeMember, { groupId, username: "owner" })).rejects.toThrow("Not allowed");
    await expect(m.mutation(api.groups.banMember, { groupId, username: "owner" })).rejects.toThrow("Not allowed");
    await expect(m.mutation(api.groups.handOver, { groupId, to: "member" })).rejects.toThrow("Not allowed");
    const b = await as(t, member);
    await expect(b.mutation(api.moderation.restoreGroup, { groupId })).rejects.toThrow("Not allowed");
    await expect(b.mutation(api.moderation.setGroupOwner, { groupId, username: "member" })).rejects.toThrow(
      "Not allowed",
    );
  });

  test("a deleted group leaves get, list and search, and an admin can restore it", async () => {
    const { t, owner, boss, groupId, slug } = await withGroup();
    await (await as(t, owner)).mutation(api.groups.remove, { groupId });
    expect((await groupRow(t, groupId)).deleted).toBe(true);
    const o = await as(t, owner);
    expect(await o.query(api.groups.get, { slug })).toBeNull();
    expect((await o.query(api.groups.list, { cursor: null })).page).toEqual([]);
    expect((await o.query(api.groups.list, { category: "music", cursor: null })).page).toEqual([]);
    expect((await o.query(api.groups.list, { q: "rock", cursor: null })).page).toEqual([]);
    expect((await o.query(api.groups.topics, { slug, cursor: null })).page).toEqual([]);
    await expect(o.mutation(api.groups.update, { groupId, ...base })).rejects.toThrow("Not found");

    const b = await as(t, boss);
    expect(await b.query(api.groups.get, { slug })).toMatchObject({ deleted: true });
    await b.mutation(api.moderation.restoreGroup, { groupId });
    expect(await o.query(api.groups.get, { slug })).toMatchObject({ slug, deleted: false, hidden: false });
  });
});

describe("membership", () => {
  test("join and leave keep memberCount in sync", async () => {
    const { t, member, other, groupId, slug } = await withGroup();
    expect(await memberCount(t, groupId)).toBe(2);
    const o = await as(t, other);
    await o.mutation(api.groups.join, { groupId });
    await o.mutation(api.groups.join, { groupId });
    expect(await memberCount(t, groupId)).toBe(3);
    await o.mutation(api.groups.leave, { groupId });
    await o.mutation(api.groups.leave, { groupId });
    expect(await memberCount(t, groupId)).toBe(2);
    expect(await o.query(api.groups.get, { slug })).toMatchObject({ isMember: false, memberCount: 2 });
    await (await as(t, member)).mutation(api.groups.leave, { groupId });
    expect(await memberCount(t, groupId)).toBe(1);
  });

  test("the owner cannot leave without handing over", async () => {
    const { t, owner, groupId } = await withGroup();
    await expect((await as(t, owner)).mutation(api.groups.leave, { groupId })).rejects.toThrow(
      "Hand over the group first",
    );
  });

  test("members lists non-banned members", async () => {
    const { t, owner, other, groupId, slug } = await withGroup();
    await (await as(t, other)).mutation(api.groups.join, { groupId });
    await (await as(t, owner)).mutation(api.groups.banMember, { groupId, username: "other" });
    const res = await t.query(api.groups.members, { slug, cursor: null });
    expect(res.page.map((m) => [m.member.username, m.isOwner])).toEqual([
      ["owner", true],
      ["member", false],
    ]);
  });

  test("a banned member can't post or rejoin, and leaving doesn't lift the ban", async () => {
    const { t, owner, member, groupId, slug } = await withGroup();
    const { topicId } = await startTopic(t, member, groupId, "Mine", "Stays");
    await (await as(t, owner)).mutation(api.groups.banMember, { groupId, username: "member" });
    await (await as(t, owner)).mutation(api.groups.banMember, { groupId, username: "member" });
    expect(await memberCount(t, groupId)).toBe(1);
    const m = await as(t, member);
    await expect(startTopic(t, member, groupId)).rejects.toThrow("You're banned from this group");
    await expect(m.mutation(api.groups.reply, { topicId, body: "hi" })).rejects.toThrow(
      "You're banned from this group",
    );
    await m.mutation(api.groups.leave, { groupId });
    await expect(m.mutation(api.groups.join, { groupId })).rejects.toThrow("You're banned from this group");
    expect(await memberCount(t, groupId)).toBe(1);
    expect(await m.query(api.groups.get, { slug })).toMatchObject({ isMember: false, isBanned: true });
    // Their existing posts stay.
    expect((await t.query(api.groups.topics, { slug, cursor: null })).page.map((x) => x.title)).toEqual(["Mine"]);
  });

  test("removeMember deletes the membership and decrements once", async () => {
    const { t, owner, member, groupId } = await withGroup();
    const o = await as(t, owner);
    await o.mutation(api.groups.removeMember, { groupId, username: "member" });
    expect(await memberCount(t, groupId)).toBe(1);
    await expect(o.mutation(api.groups.removeMember, { groupId, username: "member" })).rejects.toThrow(
      "Not a member",
    );
    // Removed, not banned: they can come back.
    await (await as(t, member)).mutation(api.groups.join, { groupId });
    expect(await memberCount(t, groupId)).toBe(2);
    // Removing a banned member doesn't count them twice.
    await o.mutation(api.groups.banMember, { groupId, username: "member" });
    await o.mutation(api.groups.removeMember, { groupId, username: "member" });
    expect(await memberCount(t, groupId)).toBe(1);
  });

  test("the owner cannot remove or ban themselves", async () => {
    const { t, owner, groupId } = await withGroup();
    const o = await as(t, owner);
    await expect(o.mutation(api.groups.removeMember, { groupId, username: "owner" })).rejects.toThrow(
      "You can't remove yourself",
    );
    await expect(o.mutation(api.groups.banMember, { groupId, username: "owner" })).rejects.toThrow(
      "You can't ban yourself",
    );
  });

  test("memberCount never goes below 0", async () => {
    const { t, owner, member, groupId } = await withGroup();
    await t.run((ctx) => ctx.db.patch(groupId, { memberCount: 0 }));
    await (await as(t, member)).mutation(api.groups.leave, { groupId });
    expect(await memberCount(t, groupId)).toBe(0);
    await (await as(t, member)).mutation(api.groups.join, { groupId });
    await t.run((ctx) => ctx.db.patch(groupId, { memberCount: 0 }));
    await (await as(t, owner)).mutation(api.groups.banMember, { groupId, username: "member" });
    expect(await memberCount(t, groupId)).toBe(0);
  });
});

describe("groups.handOver", () => {
  test("the new owner must be a current, non-banned member; the old owner stays a member", async () => {
    const { t, owner, member, other, groupId, slug } = await withGroup();
    const o = await as(t, owner);
    await expect(o.mutation(api.groups.handOver, { groupId, to: "other" })).rejects.toThrow("Not a member");
    await expect(o.mutation(api.groups.handOver, { groupId, to: "nobody" })).rejects.toThrow("Not a member");
    await (await as(t, other)).mutation(api.groups.join, { groupId });
    await o.mutation(api.groups.banMember, { groupId, username: "other" });
    await expect(o.mutation(api.groups.handOver, { groupId, to: "other" })).rejects.toThrow("Not a member");

    await o.mutation(api.groups.handOver, { groupId, to: "member" });
    expect((await groupRow(t, groupId)).ownerId).toBe(member);
    expect(await o.query(api.groups.get, { slug })).toMatchObject({ isMember: true, isOwner: false });
    await expect(o.mutation(api.groups.update, { groupId, ...base })).rejects.toThrow("Not allowed");
    await o.mutation(api.groups.leave, { groupId });
    expect(await memberCount(t, groupId)).toBe(1);
  });
});

describe("board", () => {
  test("non-members can't post; starting a topic adds its first post", async () => {
    const { t, member, other, groupId, slug } = await withGroup();
    await expect(startTopic(t, other, groupId)).rejects.toThrow("Join the group first");
    const { topicId, replyId } = await startTopic(t, member, groupId, "  Hi all  ", "  First  ");
    const topic = (await t.run((ctx) => ctx.db.get(topicId)))!;
    expect(topic).toMatchObject({ title: "Hi all", replyCount: 1, hidden: false, lastReplyAt: Date.now() });
    expect((await t.run((ctx) => ctx.db.get(replyId)))!.body).toBe("First");
    const page = (await t.query(api.groups.topics, { slug, cursor: null })).page;
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ id: topicId, title: "Hi all", replyCount: 1, author: { username: "member" } });
  });

  test("checks titles and bodies", async () => {
    const { t, member, groupId } = await withGroup();
    await expect(startTopic(t, member, groupId, " ", "x")).rejects.toThrow("Title can't be empty");
    await expect(startTopic(t, member, groupId, "t".repeat(101), "x")).rejects.toThrow("Title is too long");
    await expect(startTopic(t, member, groupId, "t", " ")).rejects.toThrow("Post can't be empty");
    await expect(startTopic(t, member, groupId, "t", "p".repeat(5001))).rejects.toThrow("Post is too long");
    const { topicId } = await startTopic(t, member, groupId);
    const m = await as(t, member);
    await expect(m.mutation(api.groups.reply, { topicId, body: "" })).rejects.toThrow("Post can't be empty");
    await expect(m.mutation(api.groups.reply, { topicId, body: "p".repeat(5001) })).rejects.toThrow(
      "Post is too long",
    );
  });

  test("new accounts can't post links in titles, posts, replies or descriptions", async () => {
    const { t, owner, groupId } = await withGroup();
    const fresh = await addProfile(t, "fresh");
    const f = await as(t, fresh);
    await f.mutation(api.groups.join, { groupId });
    const linkErr = "New accounts can't post links yet";
    await expect(startTopic(t, fresh, groupId, "see www.example.com", "x")).rejects.toThrow(linkErr);
    await expect(startTopic(t, fresh, groupId, "t", "go to https://spam.test")).rejects.toThrow(linkErr);
    const { topicId } = await startTopic(t, owner, groupId);
    await expect(f.mutation(api.groups.reply, { topicId, body: "www.spam.test" })).rejects.toThrow(linkErr);
    await (await as(t, owner)).mutation(api.groups.handOver, { groupId, to: "fresh" });
    await expect(
      f.mutation(api.groups.update, { groupId, ...base, description: "https://spam.test" }),
    ).rejects.toThrow(linkErr);
  });

  test("replies bump lastReplyAt and replyCount; topics sort by latest reply", async () => {
    const { t, member, owner, groupId, slug } = await withGroup();
    const a = await startTopic(t, member, groupId, "A");
    vi.setSystemTime(new Date(Date.now() + 1000));
    const b = await startTopic(t, member, groupId, "B");
    vi.setSystemTime(new Date(Date.now() + 1000));
    await (await as(t, owner)).mutation(api.groups.reply, { topicId: a.topicId, body: "bump" });
    const topic = (await t.run((ctx) => ctx.db.get(a.topicId)))!;
    expect(topic).toMatchObject({ replyCount: 2, lastReplyAt: Date.now() });
    const page = (await t.query(api.groups.topics, { slug, cursor: null })).page;
    expect(page.map((x) => x.id)).toEqual([a.topicId, b.topicId]);
    const replies = await t.query(api.groups.replies, { topicId: a.topicId, cursor: null });
    expect(replies.page.map((r) => r.body)).toEqual(["First post", "bump"]);
  });

  test("topics page 20 and replies page 50", async () => {
    const { t, member, groupId, slug } = await withGroup();
    const topicIds = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 21; i++) {
        ids.push(
          await ctx.db.insert("groupTopics", {
            groupId,
            authorId: member,
            title: `T${i}`,
            lastReplyAt: i,
            replyCount: 0,
            hidden: false,
          }),
        );
      }
      for (let i = 0; i < 51; i++) {
        await ctx.db.insert("groupReplies", { topicId: ids[0], authorId: member, body: `R${i}`, hidden: false });
      }
      return ids;
    });
    const first = await t.query(api.groups.topics, { slug, cursor: null });
    expect(first.page).toHaveLength(20);
    expect(first.page[0].title).toBe("T20");
    const next = await t.query(api.groups.topics, { slug, cursor: first.continueCursor });
    expect(next.page.map((x) => x.title)).toEqual(["T0"]);
    const replies = await t.query(api.groups.replies, { topicId: topicIds[0], cursor: null });
    expect(replies.page).toHaveLength(50);
    expect(replies.isDone).toBe(false);
  });

  test("ten topics an hour and sixty replies an hour", async () => {
    const { t, member, groupId } = await withGroup();
    await expect(startTopic(t, member, groupId, "", "x")).rejects.toThrow("Title can't be empty");
    let topicId: Id<"groupTopics"> | undefined;
    for (let i = 0; i < 10; i++) topicId = (await startTopic(t, member, groupId)).topicId;
    await expect(startTopic(t, member, groupId)).rejects.toThrow("Slow down");
    const m = await as(t, member);
    for (let i = 0; i < 60; i++) await m.mutation(api.groups.reply, { topicId: topicId!, body: `r${i}` });
    await expect(m.mutation(api.groups.reply, { topicId: topicId!, body: "one more" })).rejects.toThrow("Slow down");
    vi.setSystemTime(new Date(Date.now() + HOUR + 1));
    await expect(startTopic(t, member, groupId)).resolves.toBeTruthy();
  });

  test("removePost hides a reply and decrements; removing the first post hides the topic", async () => {
    const { t, owner, member, groupId, slug } = await withGroup();
    const { topicId, replyId: firstId } = await startTopic(t, member, groupId);
    const m = await as(t, member);
    const second = await m.mutation(api.groups.reply, { topicId, body: "second" });
    const o = await as(t, owner);
    await o.mutation(api.groups.removePost, { replyId: second });
    await o.mutation(api.groups.removePost, { replyId: second });
    expect((await t.run((ctx) => ctx.db.get(topicId)))!.replyCount).toBe(1);
    expect((await t.query(api.groups.replies, { topicId, cursor: null })).page.map((r) => r.body)).toEqual([
      "First post",
    ]);
    await t.run((ctx) => ctx.db.patch(topicId, { replyCount: 0 }));
    await o.mutation(api.groups.removePost, { replyId: firstId });
    const topic = (await t.run((ctx) => ctx.db.get(topicId)))!;
    expect(topic).toMatchObject({ hidden: true, replyCount: 0 });
    expect((await t.query(api.groups.topics, { slug, cursor: null })).page).toEqual([]);
    expect(await t.query(api.groups.topic, { topicId })).toBeNull();
    expect((await t.query(api.groups.replies, { topicId, cursor: null })).page).toEqual([]);
    await expect(m.mutation(api.groups.reply, { topicId, body: "late" })).rejects.toThrow("Not found");
  });

  test("site-banned users' posts are hidden; a banned owner's group stays visible", async () => {
    const { t, owner, member, boss, groupId, slug } = await withGroup();
    const own = await startTopic(t, owner, groupId, "By owner");
    const mine = await startTopic(t, member, groupId, "By member");
    await (await as(t, member)).mutation(api.groups.reply, { topicId: own.topicId, body: "member reply" });
    const b = await as(t, boss);
    await b.mutation(api.moderation.ban, { profileId: member });
    expect((await t.query(api.groups.topics, { slug, cursor: null })).page.map((x) => x.title)).toEqual([
      "By owner",
    ]);
    expect(
      (await t.query(api.groups.replies, { topicId: own.topicId, cursor: null })).page.map((r) => r.body),
    ).toEqual(["First post"]);
    expect(await t.query(api.groups.topic, { topicId: mine.topicId })).toBeNull();

    await b.mutation(api.moderation.ban, { profileId: owner });
    expect(await t.query(api.groups.get, { slug })).toMatchObject({ slug });
    expect((await t.query(api.groups.list, { cursor: null })).page.map((g) => g.slug)).toEqual([slug]);
    expect((await t.query(api.groups.list, { q: "rock", cursor: null })).page.map((g) => g.slug)).toEqual([slug]);
  });

  test("the viewer's blocks filter topics and replies both ways", async () => {
    const { t, owner, member, other, groupId, slug } = await withGroup();
    await (await as(t, other)).mutation(api.groups.join, { groupId });
    const own = await startTopic(t, owner, groupId, "By owner");
    await startTopic(t, member, groupId, "By member");
    await (await as(t, member)).mutation(api.groups.reply, { topicId: own.topicId, body: "member reply" });
    await block(t, member, other);
    const o = await as(t, other);
    expect((await o.query(api.groups.topics, { slug, cursor: null })).page.map((x) => x.title)).toEqual([
      "By owner",
    ]);
    expect((await o.query(api.groups.replies, { topicId: own.topicId, cursor: null })).page.map((r) => r.body)).toEqual(
      ["First post"],
    );
    // Others still see everything.
    expect((await t.query(api.groups.topics, { slug, cursor: null })).page).toHaveLength(2);
  });
});

describe("groups.list", () => {
  test("lists by category, 20 a page, leaving out deleted and hidden groups", async () => {
    const { t, owner } = await world();
    await t.run(async (ctx) => {
      for (let i = 0; i < 21; i++) {
        await ctx.db.insert("groups", {
          slug: `local-${i}`,
          name: `Local ${i}`,
          description: "",
          category: "local",
          ownerId: owner,
          deleted: false,
          hidden: false,
          memberCount: 1,
        });
      }
    });
    await insertGroup(t, owner, "music-one");
    await insertGroup(t, owner, "gone", { category: "local", deleted: true });
    await insertGroup(t, owner, "hid", { category: "local", hidden: true });
    // Pages read 20 rows and drop deleted and hidden ones, so a page can be short.
    const first = await t.query(api.groups.list, { category: "local", cursor: null });
    expect(first.page).toHaveLength(18);
    expect(first.isDone).toBe(false);
    const all = first.page.map((g) => g.slug);
    let cursor = first.continueCursor;
    for (;;) {
      const next = await t.query(api.groups.list, { category: "local", cursor });
      expect(next.page.length).toBeLessThanOrEqual(20);
      all.push(...next.page.map((g) => g.slug));
      if (next.isDone) break;
      cursor = next.continueCursor;
    }
    expect(all).toHaveLength(21);
    expect(all).not.toContain("gone");
    expect(all).not.toContain("hid");
    expect(all).not.toContain("music-one");
    expect((await t.query(api.groups.list, { category: "music", cursor: null })).page.map((g) => g.slug)).toEqual([
      "music-one",
    ]);
  });

  test("searches by name, leaving out deleted and hidden groups", async () => {
    const { t, owner } = await world();
    await insertGroup(t, owner, "punk-kids", { name: "Punk Kids" });
    await insertGroup(t, owner, "punk-gone", { name: "Punk Gone", deleted: true });
    await insertGroup(t, owner, "punk-hid", { name: "Punk Hid", hidden: true });
    await insertGroup(t, owner, "jazz", { name: "Jazz" });
    const res = await t.query(api.groups.list, { q: "punk", cursor: null });
    expect(res.page.map((g) => g.slug)).toEqual(["punk-kids"]);
    expect(res.isDone).toBe(true);
  });
});

describe("group moderation", () => {
  test("reports on groups, topics and replies preview and hide", async () => {
    const { t, owner, member, other, boss, groupId, slug } = await withGroup();
    const { topicId, replyId } = await startTopic(t, member, groupId, "Bad topic", "bad first");
    const second = await (await as(t, owner)).mutation(api.groups.reply, { topicId, body: "bad reply" });
    const r = await as(t, other);
    await r.mutation(api.moderation.report, { targetType: "group", targetId: groupId, reason: "spam" });
    await r.mutation(api.moderation.report, { targetType: "groupTopic", targetId: topicId, reason: "spam" });
    await r.mutation(api.moderation.report, { targetType: "groupReply", targetId: second, reason: "spam" });
    const b = await as(t, boss);
    const rows = await b.query(api.moderation.listOpen, {});
    expect(rows.map((x) => x.preview)).toEqual([
      expect.objectContaining({
        kind: "group",
        groupId,
        slug,
        title: "Rock Fans",
        body: "We like rock",
        authorId: owner,
        deleted: false,
        hidden: false,
      }),
      expect.objectContaining({ kind: "groupTopic", topicId, title: "Bad topic", body: "bad first", authorId: member, slug }),
      expect.objectContaining({ kind: "groupReply", replyId: second, topicId, body: "bad reply", authorId: owner, slug }),
    ]);

    await b.mutation(api.moderation.hide, { reportId: rows[2].id });
    expect((await t.run((ctx) => ctx.db.get(second)))!.hidden).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(topicId)))!.replyCount).toBe(1);
    await b.mutation(api.moderation.hide, { reportId: rows[1].id });
    expect((await t.run((ctx) => ctx.db.get(topicId)))!.hidden).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(replyId)))!.hidden).toBe(false);
    await b.mutation(api.moderation.hide, { reportId: rows[0].id });
    expect((await groupRow(t, groupId)).hidden).toBe(true);
    expect(await t.query(api.groups.get, { slug })).toBeNull();
    expect((await t.query(api.groups.list, { cursor: null })).page).toEqual([]);
    expect(await b.query(api.moderation.listOpen, {})).toEqual([]);

    // A hidden group still previews for admins, then restore un-hides it.
    await r.mutation(api.moderation.report, { targetType: "group", targetId: groupId, reason: "again" });
    expect((await b.query(api.moderation.listOpen, {}))[0].preview).toMatchObject({ kind: "group", hidden: true });
    await b.mutation(api.moderation.restoreGroup, { groupId });
    expect(await t.query(api.groups.get, { slug })).toMatchObject({ hidden: false });
  });

  test("an admin hides a reported first post, which hides its topic", async () => {
    const { t, member, other, boss, groupId } = await withGroup();
    const { topicId, replyId } = await startTopic(t, member, groupId);
    await (await as(t, other)).mutation(api.moderation.report, {
      targetType: "groupReply",
      targetId: replyId,
      reason: "spam",
    });
    const b = await as(t, boss);
    const [row] = await b.query(api.moderation.listOpen, {});
    await b.mutation(api.moderation.hide, { reportId: row.id });
    expect((await t.run((ctx) => ctx.db.get(topicId)))!.hidden).toBe(true);
  });

  test("setGroupOwner hands a group to a current member", async () => {
    const { t, member, other, boss, groupId } = await withGroup();
    const b = await as(t, boss);
    await expect(b.mutation(api.moderation.setGroupOwner, { groupId, username: "other" })).rejects.toThrow(
      "Not a member",
    );
    await expect(b.mutation(api.moderation.setGroupOwner, { groupId, username: "nobody" })).rejects.toThrow(
      "Not a member",
    );
    await b.mutation(api.moderation.setGroupOwner, { groupId, username: "member" });
    expect((await groupRow(t, groupId)).ownerId).toBe(member);
    void other;
  });
});

describe("group photos", () => {
  const jpeg = { size: 1000, contentType: "image/jpeg" };
  let objects: Map<string, { size: number; contentType: string }>;
  let removals: Array<[string, string]>;

  beforeEach(() => {
    objects = new Map();
    removals = [];
    vi.spyOn(storage, "uploadUrl").mockImplementation(async ({ key }) => ({ key, url: `https://r2.test/${key}` }));
    vi.spyOn(storage, "metadata").mockImplementation(async (_ctx, key: string) => {
      const o = objects.get(key);
      return o ? { key, ...o } : null;
    });
    vi.spyOn(storage, "remove").mockImplementation(async (_ctx, key: string, purpose: string) => {
      removals.push([key, purpose]);
    });
  });

  test("only the owner may begin a group photo upload, and it needs a group", async () => {
    const { t, member, owner, groupId } = await withGroup();
    await expect(
      (await as(t, member)).mutation(api.media.beginUpload, { purpose: "groupPhoto", groupId, ...jpeg }),
    ).rejects.toThrow("Not allowed");
    await expect(
      (await as(t, owner)).mutation(api.media.beginUpload, { purpose: "groupPhoto", ...jpeg }),
    ).rejects.toThrow("Not found");
    await expect(
      (await as(t, owner)).mutation(api.media.beginUpload, {
        purpose: "groupPhoto",
        groupId,
        size: 3 * 1024 * 1024,
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow("File is too large");
  });

  test("an accepted upload sets photoKey and deletes the old object; the profile photo is untouched", async () => {
    const { t, owner, groupId, slug } = await withGroup();
    await t.run((ctx) => ctx.db.patch(groupId, { photoKey: "groups/old" }));
    const me = await as(t, owner);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "groupPhoto", groupId, ...jpeg });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    expect(storage.uploadUrl).toHaveBeenCalledWith({ key, size: 1000, contentType: "image/jpeg", purpose: "photo" });
    objects.set(key, jpeg);
    await expect(me.mutation(api.media.syncMetadata, { key })).resolves.toBeNull();
    await t.mutation(internal.media.onSyncMetadata, { key, bucket: "test", isNew: true });
    expect((await groupRow(t, groupId)).photoKey).toBe(key);
    expect((await t.run((ctx) => ctx.db.get(owner)))?.photoKey).toBeUndefined();
    expect(removals).toEqual([["groups/old", "photo"]]);
    expect(await t.run((ctx) => ctx.db.query("uploads").collect())).toEqual([]);
    expect((await t.query(api.groups.get, { slug }))!.photoUrl).toBeNull();
  });

  test("an upload whose owner handed the group over is rejected", async () => {
    const { t, owner, groupId } = await withGroup();
    const me = await as(t, owner);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "groupPhoto", groupId, ...jpeg });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    objects.set(key, jpeg);
    await me.mutation(api.groups.handOver, { groupId, to: "member" });
    await t.mutation(internal.media.onSyncMetadata, { key, bucket: "test", isNew: true });
    expect((await groupRow(t, groupId)).photoKey).toBeUndefined();
    expect(removals).toEqual([[key, "photo"]]);
  });
});
