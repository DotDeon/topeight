import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { isAdmin, requireProfile } from "../../convex/lib/access";
import { storage } from "../../convex/lib/r2";
import { DAY, NOW, addProfile, as, befriend, setup, type T } from "./helpers";

let removed: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ADMIN_EMAILS", " Boss@Example.com ,other@example.com");
  vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://cdn.example.com");
  removed = [];
  vi.spyOn(storage, "remove").mockImplementation(async (_ctx, key: string) => {
    removed.push(key);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** An admin (boss), a reporter, and a target member, all old enough to post links. */
async function world() {
  const t = setup();
  const boss = await addProfile(t, "boss");
  const reporter = await addProfile(t, "reporter");
  const target = await addProfile(t, "target", { headline: "hi there", aboutMe: "a".repeat(400) });
  vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
  return { t, boss, reporter, target };
}

async function addComment(t: T, profileId: Id<"profiles">, authorId: Id<"profiles">, body = "rude words") {
  return await t.run((ctx) => ctx.db.insert("comments", { profileId, authorId, body, hidden: false }));
}

async function addTrack(t: T, profileId: Id<"profiles">, title = "Loud Song", order = 0) {
  return await t.run((ctx) =>
    ctx.db.insert("tracks", { profileId, title, key: `tracks/${profileId}/${title}`, size: 10, order, autoplay: order === 0 }),
  );
}

async function reports(t: T) {
  return await t.run((ctx) => ctx.db.query("reports").collect());
}

describe("access helpers", () => {
  test("requireProfile throws for a banned profile and for a user with no profile", async () => {
    const t = setup();
    const banned = await addProfile(t, "banned", { banned: true });
    await expect((await as(t, banned)).run((ctx) => requireProfile(ctx))).rejects.toThrow("Account banned");
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "nobody@example.com", emailVerificationTime: Date.now() }),
    );
    await expect(t.withIdentity({ subject: `${userId}|s1` }).run((ctx) => requireProfile(ctx))).rejects.toThrow(
      "No profile",
    );
  });

  test("isAdmin needs a verified email listed in ADMIN_EMAILS, case and spaces ignored", async () => {
    const t = setup();
    const boss = await addProfile(t, "boss");
    const nobody = await addProfile(t, "nobody");
    const unverified = await t.run((ctx) => ctx.db.insert("users", { email: "other@example.com" }));
    expect(await (await as(t, boss)).run((ctx) => isAdmin(ctx))).toBe(true);
    expect(await (await as(t, nobody)).run((ctx) => isAdmin(ctx))).toBe(false);
    expect(await t.withIdentity({ subject: `${unverified}|s1` }).run((ctx) => isAdmin(ctx))).toBe(false);
    expect(await t.run((ctx) => isAdmin(ctx))).toBe(false);
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(await (await as(t, boss)).run((ctx) => isAdmin(ctx))).toBe(false);
  });
});

describe("moderation.report", () => {
  test("records an open report with a trimmed reason", async () => {
    const { t, reporter, target } = await world();
    await (await as(t, reporter)).mutation(api.moderation.report, {
      targetType: "profile",
      targetId: target,
      reason: "  spam  ",
    });
    const rows = await reports(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reporterId: reporter, targetType: "profile", targetId: target, reason: "spam", status: "open" });
  });

  test("checks the reason, the target, and sign-in", async () => {
    const { t, reporter, target } = await world();
    const r = await as(t, reporter);
    await expect(r.mutation(api.moderation.report, { targetType: "profile", targetId: target, reason: "  " })).rejects.toThrow(
      "Reason must be 1 to 500 characters",
    );
    await expect(
      r.mutation(api.moderation.report, { targetType: "profile", targetId: target, reason: "x".repeat(501) }),
    ).rejects.toThrow("Reason must be 1 to 500 characters");
    await expect(r.mutation(api.moderation.report, { targetType: "comment", targetId: target, reason: "x" })).rejects.toThrow(
      "Not found",
    );
    await expect(r.mutation(api.moderation.report, { targetType: "track", targetId: "nonsense", reason: "x" })).rejects.toThrow(
      "Not found",
    );
    await expect(t.mutation(api.moderation.report, { targetType: "profile", targetId: target, reason: "x" })).rejects.toThrow(
      "Not signed in",
    );
    await r.mutation(api.moderation.report, { targetType: "profile", targetId: reporter, reason: "x".repeat(500) });
  });

  test("a track report succeeds only for a track on the named profile", async () => {
    const { t, reporter, target } = await world();
    const mine = await addTrack(t, target, "Mine");
    const other = await addProfile(t, "other");
    const foreign = await addTrack(t, other, "Elsewhere");
    const r = await as(t, reporter);

    await r.mutation(api.moderation.report, { targetType: "track", targetId: mine, profileUsername: "target", reason: " stolen " });
    // Usernames are normalised the same way the rest of the site does.
    await r.mutation(api.moderation.report, { targetType: "track", targetId: foreign, profileUsername: "Other", reason: "x" });
    expect((await reports(t)).map((x) => [x.targetType, x.targetId, x.reason])).toEqual([
      ["track", mine, "stolen"],
      ["track", foreign, "x"],
    ]);

    for (const profileUsername of ["target", "nobody_here", "../admin", ""]) {
      await expect(
        r.mutation(api.moderation.report, { targetType: "track", targetId: foreign, profileUsername, reason: "x" }),
      ).rejects.toThrow("Not found");
    }
    await expect(
      r.mutation(api.moderation.report, { targetType: "track", targetId: mine, profileUsername: "other", reason: "x" }),
    ).rejects.toThrow("Not found");
    // profileUsername is required for tracks.
    await expect(r.mutation(api.moderation.report, { targetType: "track", targetId: mine, reason: "x" })).rejects.toThrow(
      "Not found",
    );
    expect(await reports(t)).toHaveLength(2);
  });

  test("other target types ignore profileUsername", async () => {
    const { t, reporter, target } = await world();
    const comment = await addComment(t, target, target);
    await (await as(t, reporter)).mutation(api.moderation.report, {
      targetType: "comment",
      targetId: comment,
      profileUsername: "nobody_here",
      reason: "x",
    });
    expect(await reports(t)).toHaveLength(1);
  });

  test("a second open report on the same target by the same reporter adds no row", async () => {
    const { t, boss, reporter, target } = await world();
    const comment = await addComment(t, target, target);
    const r = await as(t, reporter);
    await r.mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "one" });
    await r.mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "two" });
    await (await as(t, boss)).mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "three" });
    expect((await reports(t)).map((x) => x.reason).sort()).toEqual(["one", "three"]);
  });

  test("allows 20 reports an hour per profile", async () => {
    const { t, reporter } = await world();
    const ids: Id<"profiles">[] = [];
    for (let i = 0; i < 21; i++) ids.push(await addProfile(t, `p${i}`));
    const r = await as(t, reporter);
    for (let i = 0; i < 20; i++) {
      await r.mutation(api.moderation.report, { targetType: "profile", targetId: ids[i], reason: "x" });
    }
    await expect(r.mutation(api.moderation.report, { targetType: "profile", targetId: ids[20], reason: "x" })).rejects.toThrow(
      "Slow down",
    );
  });
});

describe("admin functions", () => {
  test("non-admins and signed-out callers get Not allowed from every one", async () => {
    const { t, reporter, target } = await world();
    const comment = await addComment(t, target, target);
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "x" });
    const [row] = await reports(t);
    const track = await addTrack(t, target);
    const callers: Pick<T, "query" | "mutation">[] = [await as(t, reporter), t];
    for (const who of callers) {
      expect(await who.query(api.moderation.canModerate, {})).toBe(false);
      await expect(who.query(api.moderation.listOpen, {})).rejects.toThrow("Not allowed");
      await expect(who.mutation(api.moderation.hide, { reportId: row._id })).rejects.toThrow("Not allowed");
      await expect(who.mutation(api.moderation.dismiss, { reportId: row._id })).rejects.toThrow("Not allowed");
      await expect(who.mutation(api.moderation.ban, { profileId: target })).rejects.toThrow("Not allowed");
      await expect(who.mutation(api.moderation.unban, { profileId: target })).rejects.toThrow("Not allowed");
      await expect(who.mutation(api.moderation.unbanByUsername, { username: "target" })).rejects.toThrow("Not allowed");
      await expect(who.mutation(api.moderation.deleteTrack, { trackId: track })).rejects.toThrow("Not allowed");
    }
    expect((await t.run((ctx) => ctx.db.get(target)))!.banned).toBe(false);
  });

  test("listOpen gives the oldest 50 open reports with previews and reporter cards", async () => {
    const { t, boss, reporter, target } = await world();
    const r = await as(t, reporter);
    const comment = await addComment(t, target, target, "comment body");
    const bulletin = await t.run((ctx) => ctx.db.insert("bulletins", { authorId: target, body: "bulletin body", hidden: false }));
    const track = await addTrack(t, target, "Loud Song");
    await r.mutation(api.moderation.report, { targetType: "profile", targetId: target, reason: "r1" });
    vi.advanceTimersByTime(1000);
    await r.mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "r2" });
    await r.mutation(api.moderation.report, { targetType: "bulletin", targetId: bulletin, reason: "r3" });
    await r.mutation(api.moderation.report, { targetType: "track", targetId: track, profileUsername: "target", reason: "r4" });

    expect(await (await as(t, boss)).query(api.moderation.canModerate, {})).toBe(true);
    const list = await (await as(t, boss)).query(api.moderation.listOpen, {});
    expect(list.map((x) => x.reason)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(list[0].reporter?.username).toBe("reporter");
    expect(list[0].preview).toEqual({
      kind: "profile",
      profileId: target,
      username: "target",
      displayName: "TARGET",
      headline: "hi there",
      aboutMe: "a".repeat(300),
      banned: false,
      tracks: [{ id: track, title: "Loud Song", url: `https://cdn.example.com/tracks/${target}/Loud Song` }],
    });
    expect(list[1].preview).toMatchObject({ kind: "comment", body: "comment body", author: { username: "target" } });
    expect(list[2].preview).toMatchObject({ kind: "bulletin", body: "bulletin body" });
    expect(list[3].preview).toEqual({
      kind: "track",
      trackId: track,
      title: "Loud Song",
      url: `https://cdn.example.com/tracks/${target}/Loud Song`,
      ownerId: target,
      owner: { username: "target", displayName: "TARGET", photoUrl: null, kind: "fan" },
    });

    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("reports", { reporterId: reporter, targetType: "profile", targetId: target, reason: `bulk${i}`, status: "open" });
      }
    });
    expect(await (await as(t, boss)).query(api.moderation.listOpen, {})).toHaveLength(50);
  });

  test("hide on a comment hides it, takes it off the wall, and actions every open report on it", async () => {
    const { t, boss, reporter, target } = await world();
    const comment = await addComment(t, target, reporter, "mean");
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "a" });
    await (await as(t, target)).mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "b" });
    const other = await addComment(t, target, reporter, "fine");
    await (await as(t, target)).mutation(api.moderation.report, { targetType: "comment", targetId: other, reason: "c" });
    const [first] = await reports(t);

    await (await as(t, boss)).mutation(api.moderation.hide, { reportId: first._id });
    expect((await t.run((ctx) => ctx.db.get(comment)))!.hidden).toBe(true);
    const wall = await t.query(api.comments.list, { username: "target", cursor: null });
    expect(wall.page.map((c) => c.body)).toEqual(["fine"]);
    const profile = await t.query(api.profiles.getPublicProfile, { username: "target" });
    expect(profile && !("unavailable" in profile) && profile.comments.map((c) => c.body)).toEqual(["fine"]);
    expect(Object.fromEntries((await reports(t)).map((x) => [x.reason, x.status]))).toEqual({
      a: "actioned",
      b: "actioned",
      c: "open",
    });
  });

  test("hide on a bulletin hides it", async () => {
    const { t, boss, reporter, target } = await world();
    const bulletin = await t.run((ctx) => ctx.db.insert("bulletins", { authorId: target, body: "spam", hidden: false }));
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "bulletin", targetId: bulletin, reason: "x" });
    const [row] = await reports(t);
    await (await as(t, boss)).mutation(api.moderation.hide, { reportId: row._id });
    expect((await t.run((ctx) => ctx.db.get(bulletin)))!.hidden).toBe(true);
  });

  test("hide on a track deletes the track and its object", async () => {
    const { t, boss, reporter, target } = await world();
    const track = await addTrack(t, target, "Bad", 0);
    const next = await addTrack(t, target, "Good", 1);
    await (await as(t, reporter)).mutation(api.moderation.report, {
      targetType: "track",
      targetId: track,
      profileUsername: "target",
      reason: "x",
    });
    const [row] = await reports(t);
    await (await as(t, boss)).mutation(api.moderation.hide, { reportId: row._id });
    expect(await t.run((ctx) => ctx.db.get(track))).toBeNull();
    expect(removed).toEqual([`tracks/${target}/Bad`]);
    expect((await t.run((ctx) => ctx.db.get(next)))!.autoplay).toBe(true);
    expect((await reports(t))[0].status).toBe("actioned");
  });

  test("hide on a profile bans it", async () => {
    const { t, boss, reporter, target } = await world();
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "profile", targetId: target, reason: "x" });
    const [row] = await reports(t);
    await (await as(t, boss)).mutation(api.moderation.hide, { reportId: row._id });
    expect((await t.run((ctx) => ctx.db.get(target)))!.banned).toBe(true);
    expect(await t.query(api.profiles.getPublicProfile, { username: "target" })).toEqual({ unavailable: true });
  });

  test("hide on content that is already gone still closes the report", async () => {
    const { t, boss, reporter, target } = await world();
    const comment = await addComment(t, target, target);
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "x" });
    await t.run((ctx) => ctx.db.delete(comment));
    const [row] = await reports(t);
    await (await as(t, boss)).mutation(api.moderation.hide, { reportId: row._id });
    expect((await reports(t))[0].status).toBe("actioned");
  });

  test("dismiss marks the report dismissed and leaves the content alone", async () => {
    const { t, boss, reporter, target } = await world();
    const comment = await addComment(t, target, target);
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "comment", targetId: comment, reason: "x" });
    const [row] = await reports(t);
    await (await as(t, boss)).mutation(api.moderation.dismiss, { reportId: row._id });
    expect((await reports(t))[0].status).toBe("dismissed");
    expect((await t.run((ctx) => ctx.db.get(comment)))!.hidden).toBe(false);
    expect(await (await as(t, boss)).query(api.moderation.listOpen, {})).toEqual([]);
  });

  test("admin deleteTrack removes the track and its object", async () => {
    const { t, boss, target } = await world();
    const track = await addTrack(t, target);
    await (await as(t, boss)).mutation(api.moderation.deleteTrack, { trackId: track });
    expect(await t.run((ctx) => ctx.db.get(track))).toBeNull();
    expect(removed).toEqual([`tracks/${target}/Loud Song`]);
  });
});

describe("moderation.ban", () => {
  test("bans everywhere, signs the user out, and actions reports on them", async () => {
    const { t, boss, reporter, target } = await world();
    await t.run((ctx) => ctx.db.patch(target, { photoKey: "target.jpg" }));
    await befriend(t, reporter, target);
    await t.run((ctx) => ctx.db.patch(reporter, { top8: [target] }));
    await (await as(t, target)).mutation(api.bulletins.post, { body: "hello friends" });
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "profile", targetId: target, reason: "x" });
    const targetUser = (await t.run((ctx) => ctx.db.get(target)))!.userId;
    await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("authSessions", { userId: targetUser, expirationTime: Date.now() + DAY });
      await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: Date.now() + DAY });
    });

    // Before: visible everywhere.
    expect((await t.query(api.home.coolNewPeople, {})).map((c) => c.username)).toContain("target");
    expect((await t.query(api.search.people, { q: "target", cursor: null })).page.map((c) => c.username)).toContain("target");

    await (await as(t, boss)).mutation(api.moderation.ban, { profileId: target });

    expect(await t.query(api.profiles.getPublicProfile, { username: "target" })).toEqual({ unavailable: true });
    expect((await t.query(api.home.coolNewPeople, {})).map((c) => c.username)).not.toContain("target");
    expect((await t.query(api.search.people, { q: "target", cursor: null })).page).toEqual([]);
    const friendPage = await t.query(api.profiles.getPublicProfile, { username: "reporter" });
    expect(friendPage && !("unavailable" in friendPage) && friendPage.top8).toEqual([]);
    expect((await (await as(t, reporter)).query(api.bulletins.feed, {})).bulletins).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("authSessions").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("authRefreshTokens").collect())).toEqual([]);
    expect((await reports(t))[0].status).toBe("actioned");

    const me = await as(t, target);
    expect((await me.query(api.profiles.me, {}))?.banned).toBe(true);
    await expect(me.mutation(api.comments.add, { profileId: reporter, body: "hi" })).rejects.toThrow("Account banned");
    await expect(me.mutation(api.bulletins.post, { body: "hi" })).rejects.toThrow("Account banned");
    await expect(me.mutation(api.social.sendFriendRequest, { to: boss })).rejects.toThrow("Account banned");
    await expect(me.mutation(api.social.block, { other: boss })).rejects.toThrow("Account banned");
    await expect(
      me.mutation(api.profiles.updateDetails, { displayName: "x", headline: "", location: "", aboutMe: "", whoIdLikeToMeet: "" }),
    ).rejects.toThrow("Account banned");
    await expect(me.mutation(api.profiles.updateCustomCode, { css: "", html: "", js: "" })).rejects.toThrow("Account banned");
    await expect(me.mutation(api.media.beginUpload, { purpose: "photo", size: 10, contentType: "image/png" })).rejects.toThrow(
      "Account banned",
    );
    await expect(me.mutation(api.moderation.report, { targetType: "profile", targetId: boss, reason: "x" })).rejects.toThrow(
      "Account banned",
    );
  });

  test("the house profile cannot be banned, by ban or by hide", async () => {
    const { t, boss, reporter } = await world();
    const house = await addProfile(t, "tom", { isHouse: true });
    const b = await as(t, boss);
    await expect(b.mutation(api.moderation.ban, { profileId: house })).rejects.toThrow("Not allowed");
    await (await as(t, reporter)).mutation(api.moderation.report, { targetType: "profile", targetId: house, reason: "x" });
    const [row] = await reports(t);
    await expect(b.mutation(api.moderation.hide, { reportId: row._id })).rejects.toThrow("Not allowed");
    expect((await t.run((ctx) => ctx.db.get(house)))!.banned).toBe(false);
  });

  test("unban restores the profile", async () => {
    const { t, boss, target } = await world();
    const b = await as(t, boss);
    await b.mutation(api.moderation.ban, { profileId: target });
    await b.mutation(api.moderation.unban, { profileId: target });
    const p = await t.query(api.profiles.getPublicProfile, { username: "target" });
    expect(p && "username" in p && p.username).toBe("target");
    await (await as(t, target)).mutation(api.bulletins.post, { body: "back" });
  });

  test("unbanByUsername restores a banned profile by its username", async () => {
    const { t, boss, target } = await world();
    const b = await as(t, boss);
    await b.mutation(api.moderation.ban, { profileId: target });
    // Normalised like any username input.
    await b.mutation(api.moderation.unbanByUsername, { username: " Target " });
    expect((await t.run((ctx) => ctx.db.get(target)))!.banned).toBe(false);
    const p = await t.query(api.profiles.getPublicProfile, { username: "target" });
    expect(p && "username" in p && p.username).toBe("target");
  });

  test("unbanByUsername says so when no profile has that username", async () => {
    const { t, boss } = await world();
    const b = await as(t, boss);
    await expect(b.mutation(api.moderation.unbanByUsername, { username: "nobody" })).rejects.toThrow("Profile not found");
    await expect(b.mutation(api.moderation.unbanByUsername, { username: "../x" })).rejects.toThrow("Profile not found");
  });
});

describe("seedAdminLoginFixture", () => {
  test("needs OPENSPACE_TEST_FIXTURES=1 and never touches a real member", async () => {
    const t = setup();
    await expect(t.mutation(internal.testing.seedAdminLoginFixture, { password: "pw-123456789" })).rejects.toThrow(
      /OPENSPACE_TEST_FIXTURES/,
    );
    vi.stubEnv("OPENSPACE_TEST_FIXTURES", "1");
    const real = await addProfile(t, "e2eadmin");
    await expect(t.mutation(internal.testing.seedAdminLoginFixture, { password: "pw-123456789" })).rejects.toThrow(
      /not a fixture/,
    );
    expect((await t.run((ctx) => ctx.db.get(real)))!.username).toBe("e2eadmin");
  });

  test("creates a verified e2e-admin@fixture.invalid user", async () => {
    vi.stubEnv("OPENSPACE_TEST_FIXTURES", "1");
    const t = setup();
    await t.mutation(internal.testing.seedAdminLoginFixture, { password: "pw-123456789" });
    const user = await t.run((ctx) =>
      ctx.db.query("users").withIndex("email", (q) => q.eq("email", "e2e-admin@fixture.invalid")).unique(),
    );
    expect(user?.emailVerificationTime).toBeTypeOf("number");
  });
});
