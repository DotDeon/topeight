import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import type { PublicProfile } from "@/lib/profile/render";

const query = vi.fn();
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = query;
  },
}));

const { GET } = await import("@/app/usercontent/[username]/route");

const MAIN = "http://localhost:3000";
const UC = "http://127.0.0.1:3000";
const CSP = `${buildUsercontentCsp(UC)}; frame-ancestors ${MAIN}`;

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

function get(username: string, host = "127.0.0.1:3000") {
  const req = new Request(`http://${host}/${username}`, { headers: { host } });
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
});
