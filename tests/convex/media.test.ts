import r2Test from "@convex-dev/r2/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { storage } from "../../convex/lib/r2";
import { NOW, addProfile, as, setup } from "./helpers";

type T = ReturnType<typeof setup>;

const MB = 1024 * 1024;

/** Metadata the mocked R2 reports for each key, as if the client had uploaded it. */
let objects: Map<string, { size: number; contentType: string }>;
let removed: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  objects = new Map();
  removed = [];
  vi.spyOn(storage, "uploadUrl").mockImplementation(async (key: string) => ({
    key,
    url: `https://r2.test/${key}?signed`,
  }));
  vi.spyOn(storage, "metadata").mockImplementation(async (_ctx, key: string) => {
    const o = objects.get(key);
    return o ? { key, size: o.size, contentType: o.contentType } : null;
  });
  vi.spyOn(storage, "remove").mockImplementation(async (_ctx, key: string) => {
    removed.push(key);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mediaSetup() {
  const t = setup();
  r2Test.register(t);
  return t;
}

/** Run the full flow for one file: begin, get URL, "upload", then the post-sync callback. */
async function upload(
  t: T,
  who: Id<"profiles">,
  purpose: "photo" | "track",
  file: { size: number; contentType: string },
  title?: string,
) {
  const me = await as(t, who);
  const { uploadId } = await me.mutation(api.media.beginUpload, { purpose, title });
  const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
  objects.set(key, file);
  await t.mutation(internal.media.onSyncMetadata, { key, bucket: "test", isNew: true });
  return key;
}

const mp3 = (size = 3 * MB) => ({ size, contentType: "audio/mpeg" });
const jpeg = (size = MB) => ({ size, contentType: "image/jpeg" });

async function tracksOf(t: T, profileId: Id<"profiles">) {
  return await t.run((ctx) =>
    ctx.db
      .query("tracks")
      .withIndex("by_profile_order", (q) => q.eq("profileId", profileId))
      .collect(),
  );
}

async function pendingCount(t: T) {
  return (await t.run((ctx) => ctx.db.query("uploads").collect())).length;
}

describe("beginUpload", () => {
  test("a fan cannot start a track upload", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan");
    await expect(
      (await as(t, fan)).mutation(api.media.beginUpload, { purpose: "track" }),
    ).rejects.toThrow("Only artists can upload tracks");
  });

  test("keys are generated server-side under the purpose and profile", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track" });
    const { key, url } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    expect(key).toMatch(new RegExp(`^tracks/${band}/[0-9a-f-]{36}$`));
    expect(url).toContain(key);
    const photo = await me.mutation(api.media.beginUpload, { purpose: "photo" });
    const p = await me.mutation(api.media.generateUploadUrl, { uploadId: photo.uploadId });
    expect(p.key).toMatch(new RegExp(`^photos/${band}/[0-9a-f-]{36}$`));
  });

  test("an 11th track is refused, counting pending uploads too", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 9; i++) await upload(t, band, "track", mp3());
    const me = await as(t, band);
    await me.mutation(api.media.beginUpload, { purpose: "track" }); // 10th, still pending
    await expect(me.mutation(api.media.beginUpload, { purpose: "track" })).rejects.toThrow(
      "Maximum 10 tracks",
    );
  });

  test("pending track uploads older than an hour stop counting", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 9; i++) await upload(t, band, "track", mp3());
    const me = await as(t, band);
    await me.mutation(api.media.beginUpload, { purpose: "track" });
    vi.setSystemTime(new Date(NOW.getTime() + 61 * 60 * 1000));
    await expect(me.mutation(api.media.beginUpload, { purpose: "track" })).resolves.toBeTruthy();
  });

  test("10 stored tracks refuse another", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 10; i++) await upload(t, band, "track", mp3());
    expect(await tracksOf(t, band)).toHaveLength(10);
    await expect(
      (await as(t, band)).mutation(api.media.beginUpload, { purpose: "track" }),
    ).rejects.toThrow("Maximum 10 tracks");
  });
});

describe("upload URLs and metadata sync", () => {
  test("upload URL refused for another user's pending upload", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const thief = await addProfile(t, "thief", { kind: "artist" });
    const { uploadId } = await (await as(t, band)).mutation(api.media.beginUpload, { purpose: "track" });
    await expect(
      (await as(t, thief)).mutation(api.media.generateUploadUrl, { uploadId }),
    ).rejects.toThrow("Not allowed");
  });

  test("upload URL refused for a pending upload older than an hour", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track" });
    vi.setSystemTime(new Date(NOW.getTime() + 61 * 60 * 1000));
    await expect(me.mutation(api.media.generateUploadUrl, { uploadId })).rejects.toThrow(
      "Upload expired",
    );
  });

  test("syncMetadata refuses a key from another user's pending upload", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const thief = await addProfile(t, "thief", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track" });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    await expect((await as(t, thief)).mutation(api.media.syncMetadata, { key })).rejects.toThrow(
      "Not allowed",
    );
    await expect((await as(t, thief)).mutation(api.media.syncMetadata, { key: "made/up" })).rejects.toThrow(
      "Not allowed",
    );
  });
});

describe("onSyncMetadata for tracks", () => {
  test("too big: deletes the object and the pending row, records no track", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3(5 * MB + 1));
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(0);
    expect(await pendingCount(t)).toBe(0);
  });

  test("wrong type: deletes the object, records no track", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", { size: MB, contentType: "audio/wav" });
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(0);
  });

  test("first track is autoplay, later ones are not; title from the pending row", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const k1 = await upload(t, band, "track", mp3(5 * MB), "  Song One ");
    await upload(t, band, "track", mp3());
    const rows = await tracksOf(t, band);
    expect(rows.map((r) => [r.title, r.autoplay, r.order])).toEqual([
      ["Song One", true, 0],
      ["Untitled", false, 1],
    ]);
    expect(rows[0]).toMatchObject({ key: k1, size: 5 * MB });
    expect(removed).toEqual([]);
    expect(await pendingCount(t)).toBe(0);
  });

  test("onSyncMetadata with no pending row does nothing", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    objects.set("tracks/x/y", mp3());
    await t.mutation(internal.media.onSyncMetadata, { key: "tracks/x/y", bucket: "test", isNew: true });
    expect(await tracksOf(t, band)).toHaveLength(0);
    expect(removed).toEqual([]);
  });

  test("the 10 track limit is checked again when the upload lands", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 9; i++) await upload(t, band, "track", mp3());
    const me = await as(t, band);
    const a = await me.mutation(api.media.beginUpload, { purpose: "track" });
    // Simulate a race: an extra track row appears before the pending upload lands.
    await t.run((ctx) =>
      ctx.db.insert("tracks", { profileId: band, title: "x", key: "tracks/extra", size: 1, order: 99, autoplay: false }),
    );
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId: a.uploadId });
    objects.set(key, mp3());
    await t.mutation(internal.media.onSyncMetadata, { key, bucket: "test", isNew: true });
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(10);
  });
});

describe("onSyncMetadata for photos", () => {
  test("over 2 MB or the wrong type deletes the object and keeps the old photo", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan", { photoKey: "photos/old" });
    const big = await upload(t, fan, "photo", jpeg(2 * MB + 1));
    const svg = await upload(t, fan, "photo", { size: 100, contentType: "image/svg+xml" });
    expect(removed).toEqual([big, svg]);
    expect((await t.run((ctx) => ctx.db.get(fan)))!.photoKey).toBe("photos/old");
    expect(await pendingCount(t)).toBe(0);
  });

  test("new photo replaces photoKey and deletes the old object", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan", { photoKey: "photos/old" });
    const key = await upload(t, fan, "photo", { size: 2 * MB, contentType: "image/webp" });
    expect((await t.run((ctx) => ctx.db.get(fan)))!.photoKey).toBe(key);
    expect(removed).toEqual(["photos/old"]);
  });
});

describe("track management", () => {
  async function threeTracks() {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (const title of ["a", "b", "c"]) await upload(t, band, "track", mp3(), title);
    const rows = await tracksOf(t, band);
    return { t, band, me: await as(t, band), ids: rows.map((r) => r._id) };
  }

  test("setAutoplay leaves exactly one autoplay track", async () => {
    const { t, band, me, ids } = await threeTracks();
    await me.mutation(api.media.setAutoplay, { trackId: ids[2] });
    const rows = await tracksOf(t, band);
    expect(rows.filter((r) => r.autoplay).map((r) => r.title)).toEqual(["c"]);
  });

  test("deleting the autoplay track moves autoplay to the next by order", async () => {
    const { t, band, me, ids } = await threeTracks();
    const key = (await t.run((ctx) => ctx.db.get(ids[0])))!.key;
    await me.mutation(api.media.deleteTrack, { trackId: ids[0] });
    const rows = await tracksOf(t, band);
    expect(rows.map((r) => [r.title, r.autoplay])).toEqual([
      ["b", true],
      ["c", false],
    ]);
    expect(removed).toEqual([key]);
  });

  test("deleting the last autoplay track wraps to the first", async () => {
    const { t, band, me, ids } = await threeTracks();
    await me.mutation(api.media.setAutoplay, { trackId: ids[2] });
    await me.mutation(api.media.deleteTrack, { trackId: ids[2] });
    const rows = await tracksOf(t, band);
    expect(rows.map((r) => [r.title, r.autoplay])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  test("reorderTracks needs exactly the caller's track ids", async () => {
    const { t, band, me, ids } = await threeTracks();
    await me.mutation(api.media.reorderTracks, { ids: [ids[2], ids[0], ids[1]] });
    expect((await tracksOf(t, band)).map((r) => r.title)).toEqual(["c", "a", "b"]);
    await expect(me.mutation(api.media.reorderTracks, { ids: [ids[0], ids[1]] })).rejects.toThrow();
    await expect(
      me.mutation(api.media.reorderTracks, { ids: [ids[0], ids[0], ids[1]] }),
    ).rejects.toThrow();
  });

  test("renameTrack trims and needs 1 to 80 characters", async () => {
    const { t, band, me, ids } = await threeTracks();
    await me.mutation(api.media.renameTrack, { trackId: ids[0], title: "  New name  " });
    expect((await tracksOf(t, band))[0].title).toBe("New name");
    await expect(me.mutation(api.media.renameTrack, { trackId: ids[0], title: "   " })).rejects.toThrow();
    await expect(
      me.mutation(api.media.renameTrack, { trackId: ids[0], title: "x".repeat(81) }),
    ).rejects.toThrow();
  });

  test("other users cannot touch someone else's tracks", async () => {
    const { t, ids } = await threeTracks();
    const other = await addProfile(t, "other", { kind: "artist" });
    await upload(t, other, "track", mp3());
    const o = await as(t, other);
    const otherIds = (await tracksOf(t, other)).map((r) => r._id);
    await expect(o.mutation(api.media.setAutoplay, { trackId: ids[1] })).rejects.toThrow("Not allowed");
    await expect(o.mutation(api.media.deleteTrack, { trackId: ids[1] })).rejects.toThrow("Not allowed");
    await expect(o.mutation(api.media.renameTrack, { trackId: ids[1], title: "x" })).rejects.toThrow(
      "Not allowed",
    );
    await expect(
      o.mutation(api.media.reorderTracks, { ids: [ids[1], ...otherIds] }),
    ).rejects.toThrow("Not allowed");
  });
});
