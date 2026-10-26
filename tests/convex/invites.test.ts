import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { areFriends } from "../../convex/lib/access";
import { DAY, NOW, addProfile, as, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("HOUSE_USERNAME", "tom");
  vi.stubEnv("HOUSE_DISPLAY_NAME", "Tom");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function invite(t: T, from: Id<"profiles">, emails: string, message?: string) {
  return await (await as(t, from)).mutation(api.invites.send, { emails, ...(message ? { message } : {}) });
}

async function tokenFor(t: T, email: string): Promise<string> {
  const rows = await t.run((ctx) => ctx.db.query("invites").collect());
  return rows.find((r) => r.email === email)!.token;
}

/** A verified user without a profile, who then signs up with the invite. */
async function joinWith(t: T, email: string, username: string, token?: string) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email, emailVerificationTime: Date.now() }));
  const user = t.withIdentity({ subject: `${userId}|s1` });
  return await user.mutation(api.profiles.createMyProfile, {
    username,
    displayName: username,
    kind: "fan",
    birthDate: "2000-01-01",
    ...(token ? { invite: token } : {}),
  });
}

describe("invites.send", () => {
  test("sends each new address once and reports bad ones", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    const out = await invite(t, alice, "Dan@Example.com, dan@example.com; nope, eve@example.com");
    expect(out).toEqual([
      { email: "dan@example.com", status: "sent" },
      { email: "eve@example.com", status: "sent" },
      { email: "nope", status: "invalid" },
    ]);
    const mine = await (await as(t, alice)).query(api.invites.mine, {});
    expect(mine!.left).toBe(18);
    expect(mine!.invites.map((i) => i.email)).toEqual(["eve@example.com", "dan@example.com"]);
  });

  test("skips members, opted-out addresses and anyone invited in the last 30 days, without saying which", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    const bob = await addProfile(t, "bob");
    await addProfile(t, "carol");
    await invite(t, bob, "dan@example.com, opt@example.com");
    await (await as(t, bob)).mutation(api.invites.optOut, { token: await tokenFor(t, "opt@example.com") });

    const out = await invite(t, alice, "carol@example.com, dan@example.com, opt@example.com");
    expect(out.map((r) => r.status)).toEqual(["skipped", "skipped", "skipped"]);

    vi.setSystemTime(new Date(NOW.getTime() + 31 * DAY));
    const later = await invite(t, alice, "dan@example.com, opt@example.com");
    expect(later.map((r) => r.status)).toEqual(["sent", "skipped"]);
  });

  test("stops at 20 invites in 24 hours", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    const first = Array.from({ length: 15 }, (_, i) => `a${i}@example.com`).join(",");
    await invite(t, alice, first);
    const second = Array.from({ length: 10 }, (_, i) => `b${i}@example.com`).join(",");
    const out = await invite(t, alice, second);
    expect(out.filter((r) => r.status === "sent")).toHaveLength(5);
    expect(out.filter((r) => r.status === "limit")).toHaveLength(5);

    vi.setSystemTime(new Date(NOW.getTime() + DAY + 1000));
    expect((await (await as(t, alice)).query(api.invites.mine, {}))!.left).toBe(20);
  });

  test("rejects links in the message, too many addresses, and an empty To box", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    await expect(invite(t, alice, "dan@example.com", "see www.spam.example")).rejects.toThrow(/links/);
    const many = Array.from({ length: 21 }, (_, i) => `c${i}@example.com`).join(",");
    await expect(invite(t, alice, many)).rejects.toThrow(/at most 20/);
    await expect(invite(t, alice, " , ")).rejects.toThrow(/at least one/);
  });

  test("banned members can't invite", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice", { banned: true });
    await expect(invite(t, alice, "dan@example.com")).rejects.toThrow();
  });
});

describe("joining from an invite", () => {
  test("makes the new member and the inviter friends, once", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    await invite(t, alice, "dan@example.com");
    const token = await tokenFor(t, "dan@example.com");

    expect(await t.query(api.invites.preview, { token })).toEqual({ displayName: "ALICE", photoUrl: null });
    const dan = await joinWith(t, "dan@example.com", "dan", token);
    expect(await t.run((ctx) => areFriends(ctx, alice, dan))).toBe(true);
    expect(await t.query(api.invites.preview, { token })).toBeNull();

    const history = await (await as(t, alice)).query(api.invites.mine, {});
    expect(history!.invites[0].joined).toEqual({ username: "dan", displayName: "dan" });

    // A used link does nothing for the next person.
    const eve = await joinWith(t, "eve@example.com", "eve", token);
    expect(await t.run((ctx) => areFriends(ctx, alice, eve))).toBe(false);
  });

  test("an expired link, a banned inviter or a made-up token never blocks sign-up", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    await invite(t, alice, "dan@example.com");
    const token = await tokenFor(t, "dan@example.com");
    vi.setSystemTime(new Date(NOW.getTime() + 31 * DAY));
    const dan = await joinWith(t, "dan@example.com", "dan", token);
    expect(await t.run((ctx) => areFriends(ctx, alice, dan))).toBe(false);

    const eve = await joinWith(t, "eve@example.com", "eve", "made-up");
    expect(eve).toBeTruthy();
  });
});

describe("delivery", () => {
  test("skips the email when the inviter was banned before it went out", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    await invite(t, alice, "dan@example.com");
    const row = await t.run((ctx) => ctx.db.query("invites").first());
    await t.run((ctx) => ctx.db.patch(alice, { banned: true }));
    expect(await t.query(internal.invites.forDelivery, { inviteId: row!._id })).toBeNull();
  });

  test("the one-click endpoint opts the address out", async () => {
    const t = setup();
    const alice = await addProfile(t, "alice");
    await invite(t, alice, "dan@example.com");
    const token = await tokenFor(t, "dan@example.com");
    const res = await t.fetch(`/invites/unsubscribe?t=${token}`, { method: "POST" });
    expect(res.status).toBe(200);
    const opt = await t.run((ctx) => ctx.db.query("inviteOptOuts").first());
    expect(opt!.email).toBe("dan@example.com");
  });
});
