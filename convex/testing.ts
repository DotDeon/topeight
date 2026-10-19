import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { friendshipPair } from "./lib/friendships";

/**
 * Fixture for e2e/sandbox.spec.ts. internalMutation only: clients cannot call
 * it, only `npx convex run` with deploy credentials.
 *
 * `sandboxtest` is an artist whose custom JS tries to break out of the
 * sandbox and writes what happened into document.title as JSON.
 * `sandboxfan` is a fan with custom CSS, a friend of sandboxtest.
 */

function probeJs(mainOrigin: string): string {
  return `(function () {
  var MAIN = ${JSON.stringify(mainOrigin)};
  var r = { done: false };
  function write() { document.title = JSON.stringify(r); }
  function threw(e) { return "threw:" + (e && e.name ? e.name : "Error"); }

  try { r.cookie = document.cookie; } catch (e) { r.cookie = threw(e); }
  try { window.localStorage.setItem("probe", "1"); r.localStorage = "ok"; } catch (e) { r.localStorage = threw(e); }
  try { r.parentDocument = "read:" + window.parent.document.cookie; } catch (e) { r.parentDocument = threw(e); }
  try { window.top.location.href = MAIN + "/hijacked"; r.topNav = "no-throw"; } catch (e) { r.topNav = threw(e); }
  write();

  var fetched = fetch(MAIN + "/api/anything", { credentials: "include" }).then(
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
    profileViews: 0,
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

async function findProfile(ctx: MutationCtx, username: string) {
  return await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
}

export const seedSandboxFixture = internalMutation({
  args: { mainOrigin: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { mainOrigin }) => {
    const origin = mainOrigin ?? process.env.SITE_URL ?? "http://localhost:3000";

    let fan = await findProfile(ctx, "sandboxfan");
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
    const existing = await findProfile(ctx, "sandboxtest");
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
