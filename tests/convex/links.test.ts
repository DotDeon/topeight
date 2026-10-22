import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DAY, NOW, addProfile, as, block, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function cast(t: T) {
  return {
    venue: await addProfile(t, "mercury", { kind: "venue" }),
    label: await addProfile(t, "rhythm", { kind: "label" }),
    band: await addProfile(t, "gvv", { kind: "artist" }),
    fan: await addProfile(t, "jess", { kind: "fan" }),
  };
}

async function rows(t: T) {
  return await t.run((ctx) => ctx.db.query("links").collect());
}

async function onlyLinkId(t: T): Promise<Id<"links">> {
  const all = await rows(t);
  expect(all).toHaveLength(1);
  return all[0]._id;
}

describe("links.request", () => {
  test("a venue request is pending and shows on the band's dashboard", async () => {
    const t = setup();
    const { venue, band } = await cast(t);
    await expect((await as(t, venue)).mutation(api.links.request, { artist: band })).resolves.toBe("sent");
    const all = await rows(t);
    expect(all).toMatchObject([{ fromId: venue, artistId: band, type: "venue", status: "pending" }]);
    const dash = await (await as(t, band)).query(api.home.dashboard, {});
    expect(dash!.linkRequests).toMatchObject([{ username: "mercury", type: "venue", linkId: all[0]._id }]);
  });

  test("a label request has type label", async () => {
    const t = setup();
    const { label, band } = await cast(t);
    await (await as(t, label)).mutation(api.links.request, { artist: band });
    expect(await rows(t)).toMatchObject([{ type: "label" }]);
  });

  test("only venues and labels can ask, and only artists can be asked", async () => {
    const t = setup();
    const { venue, label, band, fan } = await cast(t);
    const other = await addProfile(t, "band2", { kind: "artist" });
    await expect((await as(t, fan)).mutation(api.links.request, { artist: band })).rejects.toThrow("Not allowed");
    await expect((await as(t, other)).mutation(api.links.request, { artist: band })).rejects.toThrow("Not allowed");
    const v = await as(t, venue);
    for (const target of [fan, label, venue]) {
      await expect(v.mutation(api.links.request, { artist: target })).rejects.toThrow("Not allowed");
    }
    expect(await rows(t)).toHaveLength(0);
  });

  test("banned or blocked targets can't be asked", async () => {
    const t = setup();
    const { venue, band } = await cast(t);
    const banned = await addProfile(t, "gone", { kind: "artist", banned: true });
    const v = await as(t, venue);
    await expect(v.mutation(api.links.request, { artist: banned })).rejects.toThrow("Profile not found");
    await block(t, band, venue);
    await expect(v.mutation(api.links.request, { artist: band })).rejects.toThrow("Not allowed");
    expect(await rows(t)).toHaveLength(0);
  });

  test("a second request while pending or linked is refused", async () => {
    const t = setup();
    const { venue, band } = await cast(t);
    const v = await as(t, venue);
    await v.mutation(api.links.request, { artist: band });
    await expect(v.mutation(api.links.request, { artist: band })).rejects.toThrow("Request already sent");
    await (await as(t, band)).mutation(api.links.respond, { linkId: await onlyLinkId(t), accept: true });
    await expect(v.mutation(api.links.request, { artist: band })).rejects.toThrow("Already linked");
  });

  test("a declined sender waits 7 days", async () => {
    const t = setup();
    const { venue, band } = await cast(t);
    const v = await as(t, venue);
    await v.mutation(api.links.request, { artist: band });
    await (await as(t, band)).mutation(api.links.respond, { linkId: await onlyLinkId(t), accept: false });
    expect(await rows(t)).toMatchObject([{ status: "declined", respondedAt: NOW.getTime() }]);
    vi.setSystemTime(NOW.getTime() + 7 * DAY - 1);
    await expect(v.mutation(api.links.request, { artist: band })).rejects.toThrow("Request already sent");
    vi.setSystemTime(NOW.getTime() + 7 * DAY);
    await v.mutation(api.links.request, { artist: band });
    expect(await rows(t)).toMatchObject([{ status: "pending" }]);
  });
});

describe("links.respond and remove", () => {
  test("only the band can answer, and accepting links them", async () => {
    const t = setup();
    const { venue, band, fan } = await cast(t);
    await (await as(t, venue)).mutation(api.links.request, { artist: band });
    const linkId = await onlyLinkId(t);
    for (const who of [venue, fan]) {
      await expect((await as(t, who)).mutation(api.links.respond, { linkId, accept: true })).rejects.toThrow(
        "Not allowed",
      );
    }
    await (await as(t, band)).mutation(api.links.respond, { linkId, accept: true });
    expect(await rows(t)).toMatchObject([{ status: "accepted" }]);
    const dash = await (await as(t, band)).query(api.home.dashboard, {});
    expect(dash!.linkRequests).toEqual([]);
  });

  test("either side can remove a link", async () => {
    const t = setup();
    const { venue, label, band } = await cast(t);
    await (await as(t, venue)).mutation(api.links.request, { artist: band });
    await (await as(t, band)).mutation(api.links.respond, { linkId: await onlyLinkId(t), accept: true });
    await (await as(t, band)).mutation(api.links.remove, { other: venue });
    expect(await rows(t)).toHaveLength(0);

    await (await as(t, label)).mutation(api.links.request, { artist: band });
    await (await as(t, band)).mutation(api.links.respond, { linkId: await onlyLinkId(t), accept: true });
    await (await as(t, label)).mutation(api.links.remove, { other: band });
    expect(await rows(t)).toHaveLength(0);
  });

  test("a block either way deletes links between the pair", async () => {
    const t = setup();
    const { venue, band } = await cast(t);
    await (await as(t, venue)).mutation(api.links.request, { artist: band });
    await (await as(t, band)).mutation(api.social.block, { other: venue });
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("links.status and mine", () => {
  test("status walks none, pending, accepted and cooldown", async () => {
    const t = setup();
    const { venue, band, fan } = await cast(t);
    const v = await as(t, venue);
    expect(await v.query(api.links.status, { username: "gvv" })).toEqual({ type: "venue", state: "none" });
    expect(await v.query(api.links.status, { username: "jess" })).toBeNull();
    expect(await (await as(t, fan)).query(api.links.status, { username: "gvv" })).toBeNull();
    await v.mutation(api.links.request, { artist: band });
    expect(await v.query(api.links.status, { username: "gvv" })).toEqual({ type: "venue", state: "pending" });
    await (await as(t, band)).mutation(api.links.respond, { linkId: await onlyLinkId(t), accept: false });
    expect(await v.query(api.links.status, { username: "gvv" })).toEqual({ type: "venue", state: "cooldown" });
    vi.setSystemTime(NOW.getTime() + 7 * DAY);
    expect(await v.query(api.links.status, { username: "gvv" })).toEqual({ type: "venue", state: "none" });
    await v.mutation(api.links.request, { artist: band });
    await (await as(t, band)).mutation(api.links.respond, { linkId: await onlyLinkId(t), accept: true });
    expect(await v.query(api.links.status, { username: "gvv" })).toEqual({ type: "venue", state: "accepted" });
  });

  test("mine lists each side, without banned profiles", async () => {
    const t = setup();
    const { venue, label, band } = await cast(t);
    const band2 = await addProfile(t, "band2", { kind: "artist" });
    for (const from of [venue, label]) {
      await (await as(t, from)).mutation(api.links.request, { artist: band });
    }
    await (await as(t, venue)).mutation(api.links.request, { artist: band2 });
    for (const r of await rows(t)) {
      if (r.artistId === band) await (await as(t, band)).mutation(api.links.respond, { linkId: r._id, accept: true });
    }
    const v = await (await as(t, venue)).query(api.links.mine, {});
    expect(v.roster.map((c) => c.username)).toEqual(["gvv"]);
    expect(v.outgoing.map((c) => c.username)).toEqual(["band2"]);
    const b = await (await as(t, band)).query(api.links.mine, {});
    expect(b.venues.map((c) => c.username)).toEqual(["mercury"]);
    expect(b.labels.map((c) => c.username)).toEqual(["rhythm"]);
    await t.run((ctx) => ctx.db.patch(venue, { banned: true }));
    expect((await (await as(t, band)).query(api.links.mine, {})).venues).toEqual([]);
  });
});
