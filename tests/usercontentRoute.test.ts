import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
    expect(await res.text()).toContain("window.openspace");
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
