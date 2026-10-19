import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { friendshipPair } from "./lib/friendships";
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
 * Runs only when the deployment has OPENSPACE_TEST_FIXTURES=1 (global-setup
 * sets it, global-teardown unsets it), and never touches a profile whose user
 * has an email (these fixture users have none). The commenter fixture is the
 * one exception, see below.
 */

function probeJs(mainOrigin: string): string {
  return `(function () {
  var MAIN = ${JSON.stringify(mainOrigin)};
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
    window.openspace.request("addFriend");
  });
  document.getElementById("probe-navigate").addEventListener("click", function () {
    window.openspace.navigate("sandboxtest", "friends");
  });
})();`;
}

const PROBE_HTML = `<p><button type="button" id="probe-add-friend">Probe: add friend</button>
<button type="button" id="probe-navigate">Probe: navigate</button></p>`;

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

export const seedSandboxFixture = internalMutation({
  args: { mainOrigin: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { mainOrigin }) => {
    // Dev and preview deployments only. Never set this on production.
    if (process.env.OPENSPACE_TEST_FIXTURES !== "1") {
      throw new ConvexError("Set OPENSPACE_TEST_FIXTURES=1 on this deployment to seed test fixtures");
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

    const artistFields = {
      customHtml: PROBE_HTML,
      customJs: probeJs(origin),
    };
    const existing = await findFixture(ctx, "sandboxtest");
    if (existing !== null) {
      await ctx.db.patch(existing._id, artistFields);
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
 * ever touched. Same OPENSPACE_TEST_FIXTURES guard as above.
 */
export const COMMENTER_EMAIL = "e2e-commenter@fixture.invalid";
export const EDITOR_EMAIL = "e2e-editor@fixture.invalid";
export const ADMIN_EMAIL = "e2e-admin@fixture.invalid";

/**
 * Creates or resets a password-login fixture. Refuses to touch any user whose
 * email is not the given @fixture.invalid address.
 */
async function seedLoginFixture(
  ctx: MutationCtx,
  f: { username: string; displayName: string; email: string; kind: "fan" | "artist"; password: string },
) {
  if (process.env.OPENSPACE_TEST_FIXTURES !== "1") {
    throw new ConvexError("Set OPENSPACE_TEST_FIXTURES=1 on this deployment to seed test fixtures");
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
    await ctx.db.patch(existing._id, { kind: f.kind, customHtml: "", customCss: "", customJs: "" });
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
