import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { FRAME_PASS_TTL_MS, signFramePass } from "../../convex/lib/framePass";
import { addProfile, as, befriend, block, NOW, setup, type T } from "./helpers";

const SECRET = "test-frame-secret";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://cdn.example.com");
  vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
  vi.stubEnv("FRAME_PASS_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type Viewer = "anon" | "stranger" | "friend" | "owner" | "admin" | "blockedByOwner" | "blockedOwner";
const FULL: Viewer[] = ["friend", "owner", "admin"];
const RESTRICTED: Viewer[] = ["anon", "stranger", "blockedByOwner", "blockedOwner"];
const ALL: Viewer[] = [...FULL, ...RESTRICTED];

type World = {
  t: T;
  owner: Id<"profiles">;
  postId: Id<"blogPosts">;
  ownTrack: Id<"tracks">;
  songTrack: Id<"tracks">;
  stranger: Id<"profiles">;
  viewer: (who: Viewer) => Promise<Pick<T, "query" | "mutation" | "action">>;
};

/**
 * A private fan, "priv", with a bit of everything: comments, friends, a Top 8,
 * a bulletin, a blog post with a comment, a track of their own and a profile song.
 * Both blocked viewers are still friends, to prove a block beats a friendship.
 */
async function world(extra: Record<string, unknown> = { private: true }): Promise<World> {
  const t = setup();
  const band = await addProfile(t, "band", { kind: "artist" });
  const songTrack = await t.run((ctx) =>
    ctx.db.insert("tracks", { profileId: band, title: "Hit", key: "tracks/band/0", size: 1, order: 0, autoplay: true }),
  );
  const owner = await addProfile(t, "priv", {
    photoKey: "priv.jpg",
    hasPhoto: true,
    location: "Cape Town",
    headline: "secret headline",
    aboutMe: "secret about",
    mood: { icon: "happy", text: "sunny" },
    profileSong: songTrack,
    ...extra,
  });
  const ownTrack = await t.run((ctx) =>
    ctx.db.insert("tracks", { profileId: owner, title: "Mine", key: "tracks/priv/0", size: 1, order: 0, autoplay: true }),
  );
  const ids: Record<Exclude<Viewer, "anon">, Id<"profiles">> = {
    owner,
    stranger: await addProfile(t, "stranger"),
    friend: await addProfile(t, "friend"),
    admin: await addProfile(t, "boss"),
    blockedByOwner: await addProfile(t, "blockee"),
    blockedOwner: await addProfile(t, "blocker"),
  };
  for (const f of [ids.friend, ids.blockedByOwner, ids.blockedOwner]) await befriend(t, owner, f);
  await block(t, owner, ids.blockedByOwner);
  await block(t, ids.blockedOwner, owner);
  await t.run(async (ctx) => {
    await ctx.db.patch(owner, { top8: [ids.friend] });
    await ctx.db.insert("comments", { profileId: owner, authorId: ids.friend, body: "hi priv", hidden: false });
    await ctx.db.insert("bulletins", { authorId: owner, body: "secret bulletin", hidden: false });
  });
  const postId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("blogPosts", { authorId: owner, title: "Diary", excerpt: "dear diary", hidden: false });
    await ctx.db.insert("blogBodies", { postId: id, body: "dear diary" });
    await ctx.db.insert("blogComments", { postId: id, authorId: ids.friend, body: "nice", hidden: false });
    return id;
  });
  return {
    t,
    owner,
    postId,
    ownTrack,
    songTrack,
    stranger: ids.stranger,
    viewer: async (who) => (who === "anon" ? t : await as(t, ids[who])),
  };
}

describe("canSeeFull gates on a private profile", () => {
  test("getPublicProfile: the full page for friend, owner and admin; the restricted card for everyone else", async () => {
    const w = await world();
    for (const who of FULL) {
      const p = await (await w.viewer(who)).query(api.profiles.getPublicProfile, { username: "priv" });
      expect(p, who).toMatchObject({ username: "priv", aboutMe: "secret about", commentCount: 1 });
    }
    for (const who of RESTRICTED) {
      const p = await (await w.viewer(who)).query(api.profiles.getPublicProfile, { username: "priv" });
      expect(p, who).toEqual({
        restricted: true,
        displayName: "PRIV",
        photoUrl: "https://cdn.example.com/priv.jpg",
        age: 26,
        location: "Cape Town",
        mood: { icon: "happy", text: "sunny" },
        online: false,
      });
    }
  });

  test("profileHeader says private, and restricted for the viewers who only get the card", async () => {
    const w = await world();
    for (const who of ALL) {
      const h = await (await w.viewer(who)).query(api.profiles.profileHeader, { username: "priv" });
      expect(h, who).toEqual({
        displayName: "PRIV",
        kind: "fan",
        banned: false,
        private: true,
        restricted: RESTRICTED.includes(who),
      });
    }
  });

  test("profileTrackTitles and profileSongForReport", async () => {
    const w = await world();
    for (const who of ALL) {
      const v = await w.viewer(who);
      const titles = await v.query(api.profiles.profileTrackTitles, { username: "priv" });
      const song = await v.query(api.profiles.profileSongForReport, { username: "priv" });
      if (FULL.includes(who)) {
        expect(titles, who).toEqual([{ id: w.ownTrack, title: "Mine" }]);
        expect(song, who).toEqual({ id: w.songTrack, title: "Hit", artistUsername: "band" });
      } else {
        expect(titles, who).toEqual([]);
        expect(song, who).toBeNull();
      }
    }
  });

  test("comments.list", async () => {
    const w = await world();
    for (const who of ALL) {
      const r = await (await w.viewer(who)).query(api.comments.list, { username: "priv", cursor: null });
      expect(r.page.map((c) => c.body), who).toEqual(FULL.includes(who) ? ["hi priv"] : []);
      expect(r.isDone, who).toBe(true);
    }
  });

  test("social.listFriends", async () => {
    const w = await world();
    for (const who of ALL) {
      const r = await (await w.viewer(who)).query(api.social.listFriends, { username: "priv" });
      if (FULL.includes(who)) expect(r!.total, who).toBe(3);
      else expect(r, who).toEqual({ friends: [], total: 0 });
    }
  });

  test("blog.listByUser, blog.get and blog.comments", async () => {
    const w = await world();
    for (const who of ALL) {
      const v = await w.viewer(who);
      const list = await v.query(api.blog.listByUser, { username: "priv", cursor: null });
      const post = await v.query(api.blog.get, { id: w.postId });
      const comments = await v.query(api.blog.comments, { postId: w.postId, cursor: null });
      if (FULL.includes(who)) {
        expect(list.page.map((p) => p.title), who).toEqual(["Diary"]);
        expect(post?.body, who).toBe("dear diary");
        expect(comments.page.map((c) => c.body), who).toEqual(["nice"]);
      } else {
        expect(list, who).toEqual({ page: [], isDone: true, continueCursor: "" });
        expect(post, who).toBeNull();
        expect(comments, who).toEqual({ page: [], isDone: true, continueCursor: "" });
      }
    }
  });

  test("media.playbackUrls signs the tracks and profile song only for viewers who see the full page", async () => {
    const w = await world();
    for (const who of ALL) {
      const urls = await (await w.viewer(who)).action(api.media.playbackUrls, { username: "priv" });
      expect(urls.map((u) => u.id), who).toEqual(FULL.includes(who) ? [w.songTrack, w.ownTrack] : []);
    }
  });

  test("comments.add and blog.addComment: only friend, owner and admin may write", async () => {
    const w = await world();
    for (const who of ALL) {
      const v = await w.viewer(who);
      const profileComment = v.mutation(api.comments.add, { profileId: w.owner, body: `from ${who}` });
      const blogComment = v.mutation(api.blog.addComment, { postId: w.postId, body: `from ${who}` });
      if (FULL.includes(who)) {
        await profileComment;
        await blogComment;
      } else if (who === "anon") {
        await expect(profileComment, who).rejects.toThrow("Not signed in");
        await expect(blogComment, who).rejects.toThrow("Not signed in");
      } else {
        await expect(profileComment, who).rejects.toThrow("Not allowed");
        await expect(blogComment, who).rejects.toThrow("Not allowed");
      }
    }
    const bodies = await w.t.run(async (ctx) => ({
      wall: (await ctx.db.query("comments").collect()).map((c) => c.body).sort(),
      blog: (await ctx.db.query("blogComments").collect()).map((c) => c.body).sort(),
    }));
    expect(bodies.wall).toEqual(["from admin", "from friend", "from owner", "hi priv"]);
    expect(bodies.blog).toEqual(["from admin", "from friend", "from owner", "nice"]);
  });

  test("a stranger may comment once the profile is public again", async () => {
    const w = await world({});
    const v = await w.viewer("stranger");
    await v.mutation(api.comments.add, { profileId: w.owner, body: "hello" });
    await v.mutation(api.blog.addComment, { postId: w.postId, body: "hello" });
  });

  test("search, browse and Cool New People still list the private profile by name and photo", async () => {
    const w = await world();
    const card = { username: "priv", displayName: "PRIV", photoUrl: "https://cdn.example.com/priv.jpg", kind: "fan" };
    const found = await w.t.query(api.search.people, { q: "priv", cursor: null });
    expect(found.page).toContainEqual(card);
    const browsed = await w.t.query(api.search.browse, { cursor: null });
    expect(browsed.page).toContainEqual(expect.objectContaining(card));
    const cool = await w.t.query(api.home.coolNewPeople, {});
    expect(cool).toContainEqual({ ...card, online: false });
  });
});

describe("public profiles are not gated", () => {
  test("strangers and signed-out visitors get everything, and the header says not private", async () => {
    const w = await world({});
    for (const who of ["anon", "stranger"] as const) {
      const v = await w.viewer(who);
      expect(await v.query(api.profiles.getPublicProfile, { username: "priv" }), who).toMatchObject({
        aboutMe: "secret about",
      });
      expect(await v.query(api.profiles.profileHeader, { username: "priv" }), who).toMatchObject({
        private: false,
        restricted: false,
      });
      expect((await v.query(api.comments.list, { username: "priv", cursor: null })).page, who).toHaveLength(1);
      expect((await v.action(api.media.playbackUrls, { username: "priv" })).length, who).toBe(2);
      expect(await v.query(api.blog.get, { id: w.postId }), who).not.toBeNull();
    }
  });
});

describe("frame pass", () => {
  test("issue gives a 2 hour pass to the viewers who see the full page, and null to everyone else", async () => {
    const w = await world();
    for (const who of ALL) {
      const pass = await (await w.viewer(who)).action(api.framePass.issue, { username: "priv" });
      if (FULL.includes(who)) {
        expect(pass, who).toBe(await signFramePass(w.owner, NOW.getTime() + FRAME_PASS_TTL_MS, SECRET));
      } else {
        expect(pass, who).toBeNull();
      }
    }
  });

  test("issue returns null for public, banned and missing profiles", async () => {
    const w = await world({});
    await addProfile(w.t, "gone", { banned: true, private: true });
    const owner = await w.viewer("owner");
    expect(await owner.action(api.framePass.issue, { username: "priv" })).toBeNull();
    expect(await owner.action(api.framePass.issue, { username: "gone" })).toBeNull();
    expect(await owner.action(api.framePass.issue, { username: "nobody" })).toBeNull();
    expect(await owner.action(api.framePass.issue, { username: "Not a name!" })).toBeNull();
  });

  test("issue returns null without FRAME_PASS_SECRET, and no pass verifies", async () => {
    const w = await world();
    const pass = await signFramePass(w.owner, NOW.getTime() + FRAME_PASS_TTL_MS, SECRET);
    vi.stubEnv("FRAME_PASS_SECRET", "");
    expect(await (await w.viewer("owner")).action(api.framePass.issue, { username: "priv" })).toBeNull();
    expect(await w.t.action(api.framePass.verify, { username: "priv", pass })).toBe(false);
    expect(await w.t.action(api.profiles.getPublicProfileWithPass, { username: "priv", pass })).toMatchObject({
      restricted: true,
    });
  });

  test("getPublicProfileWithPass: the full page only with a valid pass for that profile", async () => {
    const w = await world();
    const pass = await signFramePass(w.owner, NOW.getTime() + FRAME_PASS_TTL_MS, SECRET);
    const full = await w.t.action(api.profiles.getPublicProfileWithPass, { username: "priv", pass });
    expect(full).toMatchObject({ username: "priv", aboutMe: "secret about" });

    for (const bad of [
      undefined,
      "",
      "garbage",
      await signFramePass(w.stranger, NOW.getTime() + FRAME_PASS_TTL_MS, SECRET),
      await signFramePass(w.owner, NOW.getTime() + FRAME_PASS_TTL_MS, "wrong-secret"),
      await signFramePass(w.owner, NOW.getTime() - 1, SECRET),
    ]) {
      const p = await w.t.action(api.profiles.getPublicProfileWithPass, { username: "priv", pass: bad });
      expect(p, String(bad)).toMatchObject({ restricted: true });
      expect(p, String(bad)).not.toHaveProperty("aboutMe");
    }
  });

  test("a pass expires after 2 hours", async () => {
    const w = await world();
    const pass = (await (await w.viewer("friend")).action(api.framePass.issue, { username: "priv" }))!;
    vi.setSystemTime(NOW.getTime() + FRAME_PASS_TTL_MS - 1);
    expect(await w.t.action(api.framePass.verify, { username: "priv", pass })).toBe(true);
    vi.setSystemTime(NOW.getTime() + FRAME_PASS_TTL_MS);
    expect(await w.t.action(api.framePass.verify, { username: "priv", pass })).toBe(false);
    expect(await w.t.action(api.profiles.getPublicProfileWithPass, { username: "priv", pass })).toMatchObject({
      restricted: true,
    });
  });

  test("a pass is tied to its profile", async () => {
    const w = await world();
    await addProfile(w.t, "other2", { private: true });
    const pass = (await (await w.viewer("owner")).action(api.framePass.issue, { username: "priv" }))!;
    expect(await w.t.action(api.framePass.verify, { username: "priv", pass })).toBe(true);
    expect(await w.t.action(api.framePass.verify, { username: "other2", pass })).toBe(false);
    expect(await w.t.action(api.profiles.getPublicProfileWithPass, { username: "other2", pass })).toMatchObject({
      restricted: true,
    });
  });

  test("getPublicProfileWithPass keeps null and unavailable, and ignores the pass on public profiles", async () => {
    const w = await world({});
    await addProfile(w.t, "gone", { banned: true });
    expect(await w.t.action(api.profiles.getPublicProfileWithPass, { username: "nobody" })).toBeNull();
    expect(await w.t.action(api.profiles.getPublicProfileWithPass, { username: "gone" })).toEqual({ unavailable: true });
    for (const pass of [undefined, "garbage"]) {
      expect(await w.t.action(api.profiles.getPublicProfileWithPass, { username: "priv", pass })).toMatchObject({
        aboutMe: "secret about",
      });
    }
  });

  test("playbackUrls with a valid pass signs a private profile's tracks for a signed-out caller", async () => {
    const w = await world();
    const pass = await signFramePass(w.owner, NOW.getTime() + FRAME_PASS_TTL_MS, SECRET);
    const urls = await w.t.action(api.media.playbackUrls, { username: "priv", pass });
    expect(urls.map((u) => u.id)).toEqual([w.songTrack, w.ownTrack]);
    const wrong = await signFramePass(w.owner, NOW.getTime() + FRAME_PASS_TTL_MS, "wrong-secret");
    expect(await w.t.action(api.media.playbackUrls, { username: "priv", pass: wrong })).toEqual([]);
  });

  test("verify is false for unknown and banned profiles", async () => {
    const w = await world();
    const gone = await addProfile(w.t, "gone", { banned: true, private: true });
    const pass = await signFramePass(gone, NOW.getTime() + FRAME_PASS_TTL_MS, SECRET);
    expect(await w.t.action(api.framePass.verify, { username: "gone", pass })).toBe(false);
    expect(await w.t.action(api.framePass.verify, { username: "nobody", pass })).toBe(false);
  });
});

describe("setPrivate", () => {
  test("a fan turns it on and off", async () => {
    const t = setup();
    const id = await addProfile(t, "mia");
    const mia = await as(t, id);
    await mia.mutation(api.profiles.setPrivate, { value: true });
    expect((await t.run((ctx) => ctx.db.get(id)))!.private).toBe(true);
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ restricted: true });
    await mia.mutation(api.profiles.setPrivate, { value: false });
    expect((await t.run((ctx) => ctx.db.get(id)))!.private).toBe(false);
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ username: "mia" });
  });

  test("artists can't, and signed-out callers can't", async () => {
    const t = setup();
    const band = await as(t, await addProfile(t, "band", { kind: "artist" }));
    await expect(band.mutation(api.profiles.setPrivate, { value: true })).rejects.toThrow(
      "Artists can't make their page private",
    );
    await expect(t.mutation(api.profiles.setPrivate, { value: true })).rejects.toThrow();
  });

  test("is limited to 30 an hour", async () => {
    const t = setup();
    const mia = await as(t, await addProfile(t, "mia"));
    for (let i = 0; i < 30; i++) await mia.mutation(api.profiles.setPrivate, { value: i % 2 === 0 });
    await expect(mia.mutation(api.profiles.setPrivate, { value: true })).rejects.toThrow("Slow down");
  });

  test("becomeArtist turns it off", async () => {
    const t = setup();
    const id = await addProfile(t, "mia", { private: true });
    await (await as(t, id)).mutation(api.profiles.becomeArtist, {});
    const p = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(p.kind).toBe("artist");
    expect(p.private).toBeUndefined();
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ username: "mia" });
  });
});
