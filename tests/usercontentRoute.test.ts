import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import type { PublicProfile } from "@/lib/profile/render";

const query = vi.fn();
const action = vi.fn();
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = query;
    action = action;
  },
}));

const { GET } = await import("@/app/usercontent/[username]/route");

const MAIN = "http://localhost:3000";
const UC = "http://127.0.0.1:3000";
const CSP = `${buildUsercontentCsp(UC)}; frame-ancestors ${MAIN}; sandbox allow-scripts allow-popups`;

const profile: PublicProfile = {
  username: "jess",
  displayName: "Jess",
  kind: "fan",
  headline: "",
  online: false,
  location: "",
  aboutMe: "",
  whoIdLikeToMeet: "",
  photoUrl: null,
  profileViews: 0,
  lastLoginAt: 0,
  memberSince: 0,
  friendCount: 0,
  top8: [],
  comments: [],
  commentCount: 0,
  latestBulletin: null,
  tracks: [],
  shows: [],
  custom: { css: "", html: "", js: "" },
};

function get(username: string, host = "127.0.0.1:3000", search = "") {
  const req = new Request(`http://${host}/${username}${search}`, { headers: { host } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return GET(req as any, { params: Promise.resolve({ username }) } as any);
}

function expectBaseHeaders(res: Response) {
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("content-security-policy")).toBe(CSP);
  expect(res.headers.get("x-frame-options")).toBeNull();
}

beforeEach(() => {
  query.mockReset();
  action.mockReset();
  action.mockResolvedValue([]);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("usercontent route", () => {
  test("serves the document with the composed CSP", async () => {
    query.mockResolvedValue(profile);
    const res = await get("jess");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expectBaseHeaders(res);
    expect(await res.text()).toContain("window.topeight");
  });

  test("404s on the main host without querying", async () => {
    const res = await get("jess", "localhost:3000");
    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  test("404s for missing and banned profiles and bad usernames", async () => {
    query.mockResolvedValueOnce(null);
    expect((await get("nobody")).status).toBe(404);
    query.mockResolvedValueOnce({ unavailable: true });
    const banned = await get("gone");
    expect(banned.status).toBe(404);
    expectBaseHeaders(banned);
    expect((await get("Jess")).status).toBe(404);
    expect((await get("admin")).status).toBe(404);
  });

  test("returns 503 with the base headers when Convex fails", async () => {
    query.mockRejectedValue(new Error("Function execution timed out"));
    const res = await get("jess");
    expect(res.status).toBe(503);
    expectBaseHeaders(res);
    expect(await res.text()).not.toContain("timed out");
  });

  test("merges signed playback URLs into the document", async () => {
    const band: PublicProfile = {
      ...profile,
      username: "band",
      kind: "artist",
      tracks: [
        { id: "t1", title: "One", url: null, autoplay: true },
        { id: "t2", title: "Two", url: null, autoplay: false },
      ],
    };
    query.mockResolvedValue(band);
    action.mockResolvedValue([{ id: "t1", url: "https://audio.example/t1?X-Amz-Expires=900&sig=a" }]);
    const res = await get("band");
    expect(res.status).toBe(200);
    expect(action).toHaveBeenCalledWith(expect.anything(), { username: "band" });
    const html = await res.text();
    expect(html).toContain('data-src="https://audio.example/t1?X-Amz-Expires=900&amp;sig=a"');
    // A track the action did not sign has no URL and is left out of the player.
    expect(html).not.toContain(">Two<");
    expect(html).toContain('data-tracks-url="http://127.0.0.1:3000/band?format=tracks"');
  });

  test("merges the profile song's signed URL into a fan's player", async () => {
    const mia: PublicProfile = {
      ...profile,
      username: "mia",
      profileSong: {
        id: "ps1",
        title: "Red Dust",
        url: null,
        artist: { username: "band", displayName: "Band", photoUrl: null, kind: "artist" },
      },
    };
    query.mockResolvedValue(mia);
    action.mockResolvedValue([{ id: "ps1", url: "https://audio.example/ps1", profileSong: true }]);
    const html = await (await get("mia")).text();
    expect(html).toContain('data-src="https://audio.example/ps1"');
    expect(html).toContain('data-topeight-navigate="band"');
  });

  test("still serves the document when signing fails", async () => {
    query.mockResolvedValue(profile);
    action.mockRejectedValue(new Error("boom"));
    expect((await get("jess")).status).toBe(200);
  });
});

describe("usercontent route ?format=tracks", () => {
  test("returns the signed URLs as JSON with open CORS and no caching", async () => {
    query.mockResolvedValue(profile);
    action.mockResolvedValue([{ id: "t1", url: "https://audio.example/t1" }]);
    const res = await get("jess", "127.0.0.1:3000", "?format=tracks");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ tracks: [{ id: "t1", url: "https://audio.example/t1" }] });
  });

  test("includes the profile song entry with its flag", async () => {
    query.mockResolvedValue(profile);
    action.mockResolvedValue([{ id: "ps1", url: "https://audio.example/ps1", profileSong: true }]);
    const res = await get("jess", "127.0.0.1:3000", "?format=tracks");
    expect(await res.json()).toEqual({ tracks: [{ id: "ps1", url: "https://audio.example/ps1", profileSong: true }] });
  });

  test("404s on the main host, for bad usernames, and for missing or banned profiles", async () => {
    expect((await get("jess", "localhost:3000", "?format=tracks")).status).toBe(404);
    expect(query).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect((await get("Jess", "127.0.0.1:3000", "?format=tracks")).status).toBe(404);
    query.mockResolvedValueOnce(null);
    expect((await get("nobody", "127.0.0.1:3000", "?format=tracks")).status).toBe(404);
    query.mockResolvedValueOnce({ unavailable: true });
    expect((await get("gone", "127.0.0.1:3000", "?format=tracks")).status).toBe(404);
  });

  test("503s when signing fails", async () => {
    query.mockResolvedValue(profile);
    action.mockRejectedValue(new Error("boom"));
    expect((await get("jess", "127.0.0.1:3000", "?format=tracks")).status).toBe(503);
  });
});

describe("usercontent route on private profiles", () => {
  const restricted = {
    restricted: true,
    displayName: "Priv",
    photoUrl: null,
    location: "",
    mood: null,
    online: false,
  };
  const full: PublicProfile = { ...profile, username: "priv", aboutMe: "only friends" };
  const header = { displayName: "Priv", kind: "fan", banned: false, private: true, restricted: true };

  /** Answers each Convex call by function name, the way the deployment would for a signed-out caller. */
  function privateDeployment({ validPass }: { validPass: string }) {
    query.mockImplementation(async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === "profiles:getPublicProfile") return restricted;
      if (name === "profiles:profileHeader") return header;
      throw new Error(`unexpected query ${name}`);
    });
    action.mockImplementation(async (ref: unknown, args: { pass?: string }) => {
      const ok = args.pass === validPass;
      const name = getFunctionName(ref as never);
      if (name === "media:playbackUrls") return ok ? [{ id: "t1", url: "https://audio.example/t1" }] : [];
      if (name === "profiles:getPublicProfileWithPass") return ok ? full : restricted;
      if (name === "framePass:verify") return ok;
      throw new Error(`unexpected action ${name}`);
    });
  }

  test("404s without a pass, and never renders the restricted card", async () => {
    privateDeployment({ validPass: "good" });
    const res = await get("priv");
    expect(res.status).toBe(404);
    expectBaseHeaders(res);
    expect(await res.text()).toBe("Not found");
    expect((await get("priv", "127.0.0.1:3000", "?format=tracks")).status).toBe(404);
  });

  test("404s with a bad pass", async () => {
    privateDeployment({ validPass: "good" });
    expect((await get("priv", "127.0.0.1:3000", "?pass=bad")).status).toBe(404);
    expect((await get("priv", "127.0.0.1:3000", "?format=tracks&pass=bad")).status).toBe(404);
  });

  test("renders the full page with a valid pass", async () => {
    privateDeployment({ validPass: "good" });
    const res = await get("priv", "127.0.0.1:3000", "?pass=good");
    expect(res.status).toBe(200);
    expectBaseHeaders(res);
    expect(await res.text()).toContain("only friends");
    expect(action).toHaveBeenCalledWith(expect.anything(), { username: "priv", pass: "good" });
  });

  test("answers ?format=tracks with a valid pass", async () => {
    privateDeployment({ validPass: "good" });
    const res = await get("priv", "127.0.0.1:3000", "?format=tracks&pass=good");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tracks: [{ id: "t1", url: "https://audio.example/t1" }] });
  });

  test("503s when checking the pass fails", async () => {
    privateDeployment({ validPass: "good" });
    action.mockImplementation(async (ref: unknown) => {
      if (getFunctionName(ref as never) === "media:playbackUrls") return [];
      throw new Error("boom");
    });
    expect((await get("priv", "127.0.0.1:3000", "?pass=good")).status).toBe(503);
    expect((await get("priv", "127.0.0.1:3000", "?format=tracks&pass=good")).status).toBe(503);
  });

  test("public profiles ignore the pass", async () => {
    query.mockResolvedValue(profile);
    const res = await get("jess", "127.0.0.1:3000", "?pass=anything");
    expect(res.status).toBe(200);
    // Only playbackUrls ran: no pass check for a public page.
    expect(action).toHaveBeenCalledTimes(1);
    query.mockResolvedValue({ ...header, private: false, restricted: false });
    action.mockReset();
    action.mockResolvedValue([]);
    expect((await get("jess", "127.0.0.1:3000", "?format=tracks&pass=anything")).status).toBe(200);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
