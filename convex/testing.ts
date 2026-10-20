import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { rateLimiter } from "./lib/limits";
import { clearPick } from "./lib/profileSongs";
import { countField } from "./lib/rsvps";
import { friendshipPair } from "./lib/friendships";
import { syncMediaFlags } from "./lib/media";
import { hashPassword } from "./lib/password";

/**
 * Fixtures for the e2e specs. internalMutation only: clients cannot call
 * them, only `npx convex run` with deploy credentials. e2e/global-setup.ts
 * runs them, and only against a local Convex backend.
 *
 * seedSandboxFixture feeds e2e/sandbox.spec.ts, seedCommenterFixture feeds
 * e2e/comments.spec.ts and e2e/moderation.spec.ts, seedArtistLoginFixture feeds
 * e2e/edit.spec.ts, seedAdminLoginFixture feeds e2e/moderation.spec.ts.
 *
 * `sandboxtest` is an artist whose custom JS tries to break out of the
 * sandbox and writes what happened into document.title as JSON.
 * `sandboxfan` is a fan with custom CSS, a friend of sandboxtest.
 *
 * Runs only when the deployment has TOPEIGHT_TEST_FIXTURES=1 (global-setup
 * sets it, global-teardown unsets it), and never touches a profile whose user
 * has an email (these fixture users have none). The commenter fixture is the
 * one exception, see below.
 */

function probeJs(mainOrigin: string, foreignTrackId: string): string {
  return `(function () {
  var MAIN = ${JSON.stringify(mainOrigin)};
  var FOREIGN_TRACK = ${JSON.stringify(foreignTrackId)};
  var r = { done: false, violations: [] };
  function write() { document.title = JSON.stringify(r); }
  document.addEventListener("securitypolicyviolation", function (e) {
    r.violations.push(e.violatedDirective + " " + e.blockedURI);
    write();
  });
  function threw(e) { return "threw:" + (e && e.name ? e.name : "Error"); }

  try { r.cookie = document.cookie; } catch (e) { r.cookie = threw(e); }
  try { window.localStorage.setItem("probe", "1"); r.localStorage = "ok"; } catch (e) { r.localStorage = threw(e); }
  try { r.parentDocument = "read:" + window.parent.document.cookie; } catch (e) { r.parentDocument = threw(e); }
  try { window.top.location.href = MAIN + "/hijacked"; r.topNav = "no-throw"; } catch (e) { r.topNav = threw(e); }
  write();

  // no-cors: an opaque response resolves, so only CSP connect-src can make this reject.
  var fetched = fetch(MAIN + "/api/anything", { method: "POST", mode: "no-cors" }).then(
    function () { r.fetch = "resolved"; },
    function (e) { r.fetch = "rejected:" + (e && e.name); }
  );

  try {
    var f = document.createElement("form");
    f.style.display = "none";
    f.method = "post";
    f.action = MAIN + "/api/anything";
    var input = document.createElement("input");
    input.name = "x";
    input.value = "1";
    f.appendChild(input);
    document.body.appendChild(f);
    f.submit();
  } catch (e) { r.formError = threw(e); }

  // Only reached if submit() did not replace this document.
  setTimeout(function () {
    fetched.then(function () { r.form = "stayed"; r.done = true; write(); });
  }, 1500);

  document.getElementById("probe-add-friend").addEventListener("click", function () {
    window.topeight.request("addFriend");
  });
  document.getElementById("probe-navigate").addEventListener("click", function () {
    window.topeight.navigate("sandboxtest", "friends");
  });
  // A real track id from another profile, posted the API way and the raw way.
  document.getElementById("probe-report-foreign").addEventListener("click", function () {
    window.topeight.reportTrack(FOREIGN_TRACK);
    window.parent.postMessage({ type: "topeight:reportTrack", trackId: FOREIGN_TRACK }, "*");
    // Counts posts that were sent, so the spec knows the drop was not a missed click.
    r.foreignReports = (r.foreignReports || 0) + 2;
    write();
  });
  // Artist code can rewrite the track title it shows; the parent dialog must not use it.
  document.addEventListener("DOMContentLoaded", function () {
    var title = document.querySelector(".player-track > span");
    if (title && title.lastChild) title.lastChild.textContent = "Spoofed title";
  });
})();`;
}

const PROBE_HTML = `<p><button type="button" id="probe-add-friend">Probe: add friend</button>
<button type="button" id="probe-navigate">Probe: navigate</button>
<button type="button" id="probe-report-foreign">Probe: report foreign track</button></p>`;

const FAN_CSS = `body { background: #fdf0ff; }
.profile-left .name { color: #990066; }`;

function blank() {
  return {
    headline: "",
    location: "",
    aboutMe: "",
    whoIdLikeToMeet: "",
    customCss: "",
    customHtml: "",
    customJs: "",
    top8: [] as Id<"profiles">[],
    isHouse: false,
    banned: false,
    lastLoginAt: Date.now(),
    birthDate: "2000-01-01",
  };
}

/** The fixture profile, or null. Throws if a real member (a user with an email) holds the name. */
async function findFixture(ctx: MutationCtx, username: string) {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
  if (profile === null) return null;
  const user = await ctx.db.get(profile.userId);
  if (user?.email) {
    throw new ConvexError(`"${username}" belongs to a real member; refusing to touch it`);
  }
  return profile;
}

/**
 * The fixture profile's first track, added if it has none. The key points at
 * no real object; the specs never play it. Call only with fixture profiles.
 */
async function ensureFixtureTrack(ctx: MutationCtx, profileId: Id<"profiles">, title: string): Promise<Id<"tracks">> {
  const first = await ctx.db
    .query("tracks")
    .withIndex("by_profile_order", (q) => q.eq("profileId", profileId))
    .first();
  if (first !== null) return first._id;
  const id = await ctx.db.insert("tracks", {
    profileId,
    title,
    key: `e2e-fixture/${profileId}.mp3`,
    size: 1,
    order: 0,
    autoplay: false,
  });
  await syncMediaFlags(ctx, profileId);
  return id;
}

export const seedSandboxFixture = internalMutation({
  args: { mainOrigin: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { mainOrigin }) => {
    // Dev and preview deployments only. Never set this on production.
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    const origin = mainOrigin ?? process.env.SITE_URL ?? "http://localhost:3000";

    let fan = await findFixture(ctx, "sandboxfan");
    if (fan === null) {
      const userId = await ctx.db.insert("users", { name: "Sandbox Fan" });
      const id = await ctx.db.insert("profiles", {
        ...blank(),
        userId,
        username: "sandboxfan",
        displayName: "Sandbox Fan",
        kind: "fan",
        headline: "just here for the music",
        location: "Durban, South Africa",
        gender: "Female",
        aboutMe: "Fixture fan profile for the sandbox tests.",
        whoIdLikeToMeet: "Anyone with a good mixtape.",
        interests: {
          general: "gigs, zines",
          music: "indie, kwaito",
          movies: "Tsotsi",
          television: "",
          books: "",
          heroes: "",
        },
        customCss: FAN_CSS,
      });
      fan = (await ctx.db.get(id))!;
    }

    // A track on the fan, so the foreign-id probe has a real id from another profile.
    const foreignTrack = await ensureFixtureTrack(ctx, fan._id, "Foreign Song");
    const artistFields = {
      customHtml: PROBE_HTML,
      customJs: probeJs(origin, foreignTrack),
    };
    const existing = await findFixture(ctx, "sandboxtest");
    if (existing !== null) {
      await ctx.db.patch(existing._id, artistFields);
      await ensureFixtureTrack(ctx, existing._id, "Probe Song");
      return null;
    }

    const userId = await ctx.db.insert("users", { name: "Sandbox Test" });
    const artistId = await ctx.db.insert("profiles", {
      ...blank(),
      ...artistFields,
      userId,
      username: "sandboxtest",
      displayName: "Sandbox Test",
      kind: "artist",
      headline: "probing the walls",
      location: "Johannesburg, South Africa",
      genre: "Experimental",
      aboutMe: "Fixture artist whose custom JS tries to escape the sandbox.",
      whoIdLikeToMeet: "",
      band: {
        members: "Probe One, Probe Two",
        influences: "Same-origin policy",
        soundsLike: "A locked door",
        recordLabel: "Unsigned",
        labelType: "None",
      },
      top8: [fan._id],
    });
    await ctx.db.insert("friendships", friendshipPair(artistId, fan._id));
    await ensureFixtureTrack(ctx, artistId, "Probe Song");
    await ctx.db.insert("comments", {
      profileId: artistId,
      authorId: fan._id,
      body: "thanks for the add! cant wait for the show",
      hidden: false,
    });
    const showDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await ctx.db.insert("shows", { profileId: artistId, date: showDate, venue: "The Bassline", city: "Johannesburg" });
    return null;
  },
});

/**
 * Fixture for e2e/comments.spec.ts: a verified fan who can log in with a
 * password, so the browser test can sign in for real. The email ends in
 * `@fixture.invalid`, which no real member can have, and only such users are
 * ever touched. Same TOPEIGHT_TEST_FIXTURES guard as above.
 */
export const COMMENTER_EMAIL = "e2e-commenter@fixture.invalid";
export const EDITOR_EMAIL = "e2e-editor@fixture.invalid";
export const ADMIN_EMAIL = "e2e-admin@fixture.invalid";
export const BANNED_EMAIL = "e2e-banned@fixture.invalid";

/**
 * Creates or resets a password-login fixture. Refuses to touch any user whose
 * email is not the given @fixture.invalid address.
 */
async function seedLoginFixture(
  ctx: MutationCtx,
  f: { username: string; displayName: string; email: string; kind: "fan" | "artist"; password: string; banned?: boolean },
) {
  if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
    throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
  }
  const secret = await hashPassword(f.password);
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", f.username))
    .unique();
  if (existing !== null) {
    const user = await ctx.db.get(existing.userId);
    if (user?.email !== f.email) throw new ConvexError(`"${f.username}" is not a fixture; refusing to touch it`);
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id).eq("provider", "password"))
      .unique();
    if (account !== null) await ctx.db.patch(account._id, { secret });
    // Start each run clean: no comments by this user, and (editor) default profile content.
    const comments = await ctx.db.query("comments").filter((q) => q.eq(q.field("authorId"), existing._id)).take(100);
    for (const c of comments) await ctx.db.delete(c._id);
    const reports = await ctx.db.query("reports").filter((q) => q.eq(q.field("reporterId"), existing._id)).take(100);
    for (const r of reports) await ctx.db.delete(r._id);
    await ctx.db.patch(existing._id, { kind: f.kind, customHtml: "", customCss: "", customJs: "", banned: f.banned ?? false });
    return null;
  }
  const taken = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", f.email))
    .first();
  if (taken !== null) throw new ConvexError(`${f.email} already exists and is not the fixture; refusing to touch it`);
  const userId = await ctx.db.insert("users", { name: f.displayName, email: f.email, emailVerificationTime: Date.now() });
  await ctx.db.insert("authAccounts", {
    userId,
    provider: "password",
    providerAccountId: f.email,
    secret,
    emailVerified: f.email,
  });
  await ctx.db.insert("profiles", {
    ...blank(),
    userId,
    username: f.username,
    displayName: f.displayName,
    kind: f.kind,
    banned: f.banned ?? false,
  });
  return null;
}

export const seedCommenterFixture = internalMutation({
  args: { password: v.string() },
  returns: v.null(),
  handler: async (ctx, { password }) =>
    await seedLoginFixture(ctx, {
      username: "e2ecommenter",
      displayName: "E2E Commenter",
      email: COMMENTER_EMAIL,
      kind: "fan",
      password,
    }),
});

/** Fixture for e2e/edit.spec.ts: an artist who can log in. Same guards as the commenter. */
export const seedArtistLoginFixture = internalMutation({
  args: { password: v.string() },
  returns: v.null(),
  handler: async (ctx, { password }) =>
    await seedLoginFixture(ctx, {
      username: "e2eeditor",
      displayName: "E2E Editor",
      email: EDITOR_EMAIL,
      kind: "artist",
      password,
    }),
});

/**
 * Fixture for e2e/moderation.spec.ts: a member who can log in. Same guards as the
 * commenter. It is only an admin because global-setup puts its email in ADMIN_EMAILS.
 */
export const seedAdminLoginFixture = internalMutation({
  args: { password: v.string() },
  returns: v.null(),
  handler: async (ctx, { password }) =>
    await seedLoginFixture(ctx, {
      username: "e2eadmin",
      displayName: "E2E Admin",
      email: ADMIN_EMAIL,
      kind: "fan",
      password,
    }),
});

/**
 * Fixture for e2e/suspended.spec.ts: a member who can log in and is banned. A
 * dedicated user, so no shared fixture is ever banned. Same guards as the commenter.
 */
export const seedBannedLoginFixture = internalMutation({
  args: { password: v.string() },
  returns: v.null(),
  handler: async (ctx, { password }) =>
    await seedLoginFixture(ctx, {
      username: "e2ebanned",
      displayName: "E2E Banned",
      email: BANNED_EMAIL,
      kind: "fan",
      password,
      banned: true,
    }),
});

/** A fixture profile: findFixture's guard, plus a missing profile is an error. */
async function requireFixture(ctx: MutationCtx, username: string) {
  if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
    throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
  }
  const profile = await findFixture(ctx, username);
  if (profile === null) throw new ConvexError(`Fixture "${username}" is not seeded`);
  return profile;
}

/**
 * Fixture for e2e/friends.spec.ts: makes e2ecommenter and sandboxtest friends.
 * Safe to call again; the spec calls it to put the friendship back after removing it.
 * Run the login fixtures first. Both profiles must be fixtures.
 */
export const seedCommenterFriendship = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const sandbox = await requireFixture(ctx, "sandboxtest");
    // The commenter has an email, so findFixture would refuse it. Check the fixture address instead.
    const commenter = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", "e2ecommenter"))
      .unique();
    const user = commenter === null ? null : await ctx.db.get(commenter.userId);
    if (commenter === null || user?.email !== COMMENTER_EMAIL) {
      throw new ConvexError("Fixture \"e2ecommenter\" is not seeded");
    }
    const pair = friendshipPair(commenter._id, sandbox._id);
    const row = await ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("a", pair.a).eq("b", pair.b))
      .first();
    if (row === null) await ctx.db.insert("friendships", pair);
    return null;
  },
});

/**
 * Fixture for e2e/friends.spec.ts: e2eeditor has blocked sandboxfan. Safe to call again.
 */
export const seedEditorBlock = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const fan = await requireFixture(ctx, "sandboxfan");
    const editor = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", "e2eeditor"))
      .unique();
    const user = editor === null ? null : await ctx.db.get(editor.userId);
    if (editor === null || user?.email !== EDITOR_EMAIL) {
      throw new ConvexError("Fixture \"e2eeditor\" is not seeded");
    }
    const row = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) => q.eq("blocker", editor._id).eq("blocked", fan._id))
      .first();
    if (row === null) await ctx.db.insert("blocks", { blocker: editor._id, blocked: fan._id });
    return null;
  },
});

/**
 * Fixture for e2e/mail.spec.ts and e2e/blog.spec.ts: makes e2ecommenter and
 * e2eadmin friends, clears any mail between them, so the spec starts from an
 * empty mailbox, and resets e2eadmin's blogCreate and blogEdit limits so reruns
 * stay under 10 posts a day. Safe to call again. Run the login fixtures first.
 */
export const seedMailFixture = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    const byEmail = async (username: string, email: string) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      const user = profile === null ? null : await ctx.db.get(profile.userId);
      if (profile === null || user?.email !== email) throw new ConvexError(`Fixture "${username}" is not seeded`);
      return profile;
    };
    const a = await byEmail("e2ecommenter", COMMENTER_EMAIL);
    const b = await byEmail("e2eadmin", ADMIN_EMAIL);
    const pair = friendshipPair(a._id, b._id);
    const row = await ctx.db
      .query("friendships")
      .withIndex("by_pair", (q) => q.eq("a", pair.a).eq("b", pair.b))
      .first();
    if (row === null) await ctx.db.insert("friendships", pair);
    for (const [from, to] of [[a._id, b._id], [b._id, a._id]] as const) {
      const rows = await ctx.db
        .query("messages")
        .withIndex("by_recipient", (q) => q.eq("recipientId", to))
        .filter((q) => q.eq(q.field("senderId"), from))
        .take(100);
      for (const m of rows) await ctx.db.delete(m._id);
    }
    for (const name of ["blogCreate", "blogEdit"] as const) {
      await rateLimiter.reset(ctx, name, { key: b._id });
    }
    return null;
  },
});

/**
 * Fixture for e2e/events.spec.ts: deletes every event hosted by the e2e
 * accounts, with its RSVPs, and their RSVPs on other hosts' events, taking
 * each one off that event's count. Resets their event and RSVP rate limits so
 * repeated runs do not hit the 5 events a day cap. Only touches profiles whose
 * user has the fixture @fixture.invalid address.
 */
export const resetEventsFixture = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    for (const [username, email] of [
      ["e2eadmin", ADMIN_EMAIL],
      ["e2ecommenter", COMMENTER_EMAIL],
    ] as const) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      if (profile === null) continue;
      const user = await ctx.db.get(profile.userId);
      if (user?.email !== email) throw new ConvexError(`"${username}" is not a fixture; refusing to touch it`);
      const events = await ctx.db
        .query("events")
        .withIndex("by_host", (q) => q.eq("hostId", profile._id))
        .take(100);
      // The events go too, so their counts don't matter.
      for (const e of events) {
        const rsvps = await ctx.db
          .query("rsvps")
          .withIndex("by_event_status", (q) => q.eq("eventId", e._id))
          .take(100);
        for (const r of rsvps) await ctx.db.delete(r._id);
        await ctx.db.delete(e._id);
      }
      const own = await ctx.db
        .query("rsvps")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .take(100);
      for (const r of own) {
        await ctx.db.delete(r._id);
        // A banned member's answers are already out of the counts.
        const event = profile.banned ? null : await ctx.db.get(r.eventId);
        if (event !== null) {
          const field = countField(r.status);
          await ctx.db.patch(event._id, { [field]: Math.max(0, event[field] - 1) });
        }
      }
      for (const name of ["eventCreate", "eventEdit", "rsvp"] as const) {
        await rateLimiter.reset(ctx, name, { key: profile._id });
      }
    }
    return null;
  },
});

/**
 * Fixture for e2e/groups.spec.ts: clears the e2e accounts' groups (with their
 * members, topics and posts) and memberships, resets their group rate limits so
 * reruns stay under 3 groups a day and slugs stay free, and sets createdAtOverride:
 * 30 days ago for e2eadmin (passes the week-old rule) and now for e2ecommenter
 * (always too young, whatever age the local database gives it).
 * Same TOPEIGHT_TEST_FIXTURES guard as the rest.
 */
export const resetGroupsFixture = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    for (const username of ["e2eadmin", "e2ecommenter"]) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      if (profile === null) continue;
      const user = await ctx.db.get(profile.userId);
      if (user?.email !== ADMIN_EMAIL && user?.email !== COMMENTER_EMAIL) continue;
      const aged = username === "e2eadmin";
      await ctx.db.patch(profile._id, { createdAtOverride: aged ? Date.now() - 30 * 24 * 60 * 60 * 1000 : Date.now() });
      const groups = await ctx.db.query("groups").order("desc").take(500);
      for (const g of groups.filter((x) => x.ownerId === profile._id)) {
        const topics = await ctx.db
          .query("groupTopics")
          .withIndex("by_group_last", (q) => q.eq("groupId", g._id))
          .take(200);
        for (const t of topics) {
          const replies = await ctx.db
            .query("groupReplies")
            .withIndex("by_topic", (q) => q.eq("topicId", t._id))
            .take(500);
          for (const r of replies) await ctx.db.delete(r._id);
          await ctx.db.delete(t._id);
        }
        const members = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", g._id))
          .take(500);
        for (const m of members) await ctx.db.delete(m._id);
        await ctx.db.delete(g._id);
      }
      const own = await ctx.db
        .query("groupMembers")
        .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
        .take(200);
      for (const m of own) await ctx.db.delete(m._id);
      for (const name of ["groupCreate", "groupEdit", "groupTopic", "groupReply", "groupJoin"] as const) {
        await rateLimiter.reset(ctx, name, { key: profile._id });
      }
    }
    return null;
  },
});

/**
 * Fixture for e2e/mood.spec.ts: clears the mood on e2eeditor and resets its
 * mood rate limit so repeated runs never hit 30 an hour.
 */
export const resetMoodFixture = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", "e2eeditor"))
      .unique();
    const user = profile === null ? null : await ctx.db.get(profile.userId);
    if (profile === null || user?.email !== "e2e-editor@fixture.invalid") {
      throw new ConvexError('Fixture "e2eeditor" is not seeded');
    }
    await ctx.db.patch(profile._id, { mood: undefined });
    await rateLimiter.reset(ctx, "mood", { key: profile._id });
    return null;
  },
});

/**
 * Fixture for e2e/online.spec.ts: turns Online Now! back on for e2eeditor,
 * drops any presence row and resets the heartbeat limit.
 */
export const resetOnlineFixture = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", "e2eeditor"))
      .unique();
    const user = profile === null ? null : await ctx.db.get(profile.userId);
    if (profile === null || user?.email !== "e2e-editor@fixture.invalid") {
      throw new ConvexError('Fixture "e2eeditor" is not seeded');
    }
    await ctx.db.patch(profile._id, { showOnline: undefined });
    const row = await ctx.db
      .query("presence")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .unique();
    if (row !== null) await ctx.db.delete(row._id);
    await rateLimiter.reset(ctx, "heartbeat", { key: profile._id });
    return null;
  },
});

/**
 * Fixture for e2e/profile-song.spec.ts: clears the commenter fan's profile song
 * and pick row, turns sharing back on for the sandboxtest and e2eeditor artists,
 * and resets the pick and sharing limits. `shareSongs` (default true) is set on
 * sandboxtest so a spec can switch it off without an artist login.
 */
export const resetProfileSongFixture = internalMutation({
  args: { sandboxShares: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { sandboxShares }) => {
    if (process.env.TOPEIGHT_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set TOPEIGHT_TEST_FIXTURES=1 on this deployment to seed test fixtures");
    }
    const fixture = async (username: string, email: string | null) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique();
      const user = profile === null ? null : await ctx.db.get(profile.userId);
      if (profile === null || (email === null ? user?.email : user?.email !== email)) {
        throw new ConvexError(`Fixture "${username}" is not seeded`);
      }
      return profile;
    };
    const fan = await fixture("e2ecommenter", COMMENTER_EMAIL);
    const editor = await fixture("e2eeditor", EDITOR_EMAIL);
    const sandbox = await fixture("sandboxtest", null);
    await clearPick(ctx, fan);
    await ctx.db.patch(fan._id, { profileSong: undefined });
    await ctx.db.patch(editor._id, { shareSongs: undefined });
    await ctx.db.patch(sandbox._id, { shareSongs: sandboxShares === false ? false : undefined });
    await rateLimiter.reset(ctx, "songPick", { key: fan._id });
    await rateLimiter.reset(ctx, "shareSongs", { key: editor._id });
    return null;
  },
});
