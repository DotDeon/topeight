import r2Test from "@convex-dev/r2/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EXPIRE_AFTER_MS } from "../../convex/media";
import { UPLOAD_TTL_MS } from "../../convex/lib/media";
import { storage, UPLOAD_URL_TTL_S } from "../../convex/lib/r2";
import { NOW, addProfile, as, setup } from "./helpers";

type T = ReturnType<typeof setup>;

const MB = 1024 * 1024;

/** Metadata the mocked R2 reports for each key, as if the client had uploaded it. */
let objects: Map<string, { size: number; contentType: string }>;
let removed: string[];
/** [key, purpose] for every storage.remove call, so tests can check the bucket. */
let removals: Array<[string, string]>;
/** Keys sent to the best-effort legacy delete on the public bucket. */
let legacyRemoved: string[];

beforeEach(() => {
  // Fake setTimeout too, so scheduled functions (expiry, the component's HEAD sync)
  // only run when a test advances the clock.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  objects = new Map();
  removed = [];
  removals = [];
  legacyRemoved = [];
  vi.spyOn(storage, "uploadUrl").mockImplementation(async ({ key }) => ({
    key,
    url: `https://r2.test/${key}?signed`,
  }));
  vi.spyOn(storage, "metadata").mockImplementation(async (_ctx, key: string) => {
    const o = objects.get(key);
    return o ? { key, size: o.size, contentType: o.contentType } : null;
  });
  vi.spyOn(storage, "remove").mockImplementation(async (_ctx, key: string, purpose: string) => {
    removed.push(key);
    removals.push([key, purpose]);
  });
  vi.spyOn(storage, "removeLegacyPublic").mockImplementation(async (_ctx, key: string) => {
    legacyRemoved.push(key);
  });
  // HEAD on the audio bucket, as if the client had uploaded the object.
  vi.spyOn(storage, "head").mockImplementation(async (key: string) => objects.get(key) ?? null);
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

type File = { size: number; contentType: string };

/**
 * Run the full flow for one file: begin with the declared file, get the URL,
 * "upload" the actual file (the declared one unless given), then confirm it:
 * confirmTrackUpload for tracks, the component's post-sync callback for photos.
 */
async function upload(
  t: T,
  who: Id<"profiles">,
  purpose: "photo" | "track",
  file: File,
  title?: string,
  actual: File = file,
) {
  const me = await as(t, who);
  const { uploadId } = await me.mutation(api.media.beginUpload, { purpose, title, ...file });
  const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
  objects.set(key, actual);
  if (purpose === "track") await me.action(api.media.confirmTrackUpload, { uploadId });
  else await t.mutation(internal.media.onSyncMetadata, { key, bucket: "test", isNew: true });
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
      (await as(t, fan)).mutation(api.media.beginUpload, { purpose: "track", ...mp3() }),
    ).rejects.toThrow("Only artists can upload tracks");
  });

  test("keys are generated server-side under the purpose and profile", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    const { key, url } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    expect(key).toMatch(new RegExp(`^tracks/${band}/[0-9a-f-]{36}$`));
    expect(url).toContain(key);
    const photo = await me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg() });
    const p = await me.mutation(api.media.generateUploadUrl, { uploadId: photo.uploadId });
    expect(p.key).toMatch(new RegExp(`^photos/${band}/[0-9a-f-]{36}$`));
  });

  test("a 6th track is refused, counting pending uploads too", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 4; i++) await upload(t, band, "track", mp3());
    const me = await as(t, band);
    await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() }); // 5th, still pending
    await expect(me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() })).rejects.toThrow(
      "Maximum 5 tracks",
    );
  });

  test("pending track uploads older than an hour stop counting", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 4; i++) await upload(t, band, "track", mp3());
    const me = await as(t, band);
    await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    vi.setSystemTime(new Date(NOW.getTime() + 61 * 60 * 1000));
    await expect(me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() })).resolves.toBeTruthy();
  });

  test("5 stored tracks refuse another", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 5; i++) await upload(t, band, "track", mp3());
    expect(await tracksOf(t, band)).toHaveLength(5);
    await expect(
      (await as(t, band)).mutation(api.media.beginUpload, { purpose: "track", ...mp3() }),
    ).rejects.toThrow("Maximum 5 tracks");
  });
});

describe("upload URLs and metadata sync", () => {
  test("upload URL refused for another user's pending upload", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const thief = await addProfile(t, "thief", { kind: "artist" });
    const { uploadId } = await (await as(t, band)).mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    await expect(
      (await as(t, thief)).mutation(api.media.generateUploadUrl, { uploadId }),
    ).rejects.toThrow("Not allowed");
  });

  test("upload URL refused for a pending upload older than an hour", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
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
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg() });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    await expect((await as(t, thief)).mutation(api.media.syncMetadata, { key })).rejects.toThrow(
      "Not allowed",
    );
    await expect((await as(t, thief)).mutation(api.media.syncMetadata, { key: "made/up" })).rejects.toThrow(
      "Not allowed",
    );
  });
});

describe("confirmTrackUpload", () => {
  test("accepts when the HEAD size and type match the pending row", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", title: "Song", ...mp3(1234) });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    objects.set(key, mp3(1234));
    expect(await me.action(api.media.confirmTrackUpload, { uploadId })).toEqual({ accepted: true });
    expect(storage.head).toHaveBeenCalledWith(key, "test-audio-bucket");
    expect((await tracksOf(t, band)).map((r) => [r.title, r.key, r.size])).toEqual([["Song", key, 1234]]);
    expect(removed).toEqual([]);
    expect(await pendingCount(t)).toBe(0);
  });

  test("rejects and deletes the object and the row when the size or type differ", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const keys: string[] = [];
    for (const actual of [mp3(MB - 1), { size: MB, contentType: "text/html" }]) {
      const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3(MB) });
      const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
      keys.push(key);
      objects.set(key, actual);
      expect(await me.action(api.media.confirmTrackUpload, { uploadId })).toEqual({ accepted: false });
    }
    expect(removed).toEqual(keys);
    // Rejected tracks are deleted from the audio bucket.
    expect(removals.map(([, purpose]) => purpose)).toEqual(["track", "track"]);
    expect(await tracksOf(t, band)).toHaveLength(0);
    expect(await pendingCount(t)).toBe(0);
  });

  test("rejects when nothing was uploaded", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    expect(await me.action(api.media.confirmTrackUpload, { uploadId })).toEqual({ accepted: false });
    expect(removed).toEqual([key]);
    expect(await pendingCount(t)).toBe(0);
  });

  test("refuses another user's upload and leaves it alone", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const thief = await addProfile(t, "thief", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    objects.set(key, mp3());
    await expect((await as(t, thief)).action(api.media.confirmTrackUpload, { uploadId })).rejects.toThrow(
      "Not allowed",
    );
    await expect(t.action(api.media.confirmTrackUpload, { uploadId })).rejects.toThrow();
    expect(storage.head).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
    expect(await pendingCount(t)).toBe(1);
  });

  test("refuses a photo upload", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan");
    const me = await as(t, fan);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg() });
    await expect(me.action(api.media.confirmTrackUpload, { uploadId })).rejects.toThrow("Not allowed");
  });

  test("the component sync path refuses track keys, even from the owner", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    await expect(me.mutation(api.media.syncMetadata, { key })).rejects.toThrow("Not allowed");
    objects.set(key, mp3());
    await t.mutation(internal.media.onSyncMetadata, { key, bucket: "test", isNew: true });
    expect(await tracksOf(t, band)).toHaveLength(0);
    expect(await pendingCount(t)).toBe(1);
  });
});

describe("track checks on confirm", () => {
  test("declared size or type over the limits is refused before any URL exists", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    await expect(
      me.mutation(api.media.beginUpload, { purpose: "track", ...mp3(5 * MB + 1) }),
    ).rejects.toThrow("File is too large");
    await expect(
      me.mutation(api.media.beginUpload, { purpose: "track", size: MB, contentType: "audio/wav" }),
    ).rejects.toThrow("That file type isn't allowed");
    await expect(
      me.mutation(api.media.beginUpload, { purpose: "track", size: 0, contentType: "audio/mpeg" }),
    ).rejects.toThrow("That file is empty");
    expect(await pendingCount(t)).toBe(0);
  });

  test("synced size over 5 MB (not what was declared): deletes the object and the row, records no track", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3(), undefined, mp3(5 * MB + 1));
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(0);
    expect(await pendingCount(t)).toBe(0);
  });

  test("synced size that differs from the declared size is rejected even under the limit", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3(3 * MB), undefined, mp3(3 * MB - 1));
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(0);
  });

  test("synced type other than audio/mpeg: deletes the object, records no track", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3(MB), undefined, { size: MB, contentType: "text/html" });
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(0);
  });

  test("a rejected key is swept again after its upload URL has expired", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3(), undefined, mp3(MB));
    expect(removed).toEqual([key]);
    vi.advanceTimersByTime(6 * 60 * 1000 + 1);
    await t.finishInProgressScheduledFunctions();
    expect(removed).toEqual([key, key]);
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

  test("the 5 track limit is checked again when the upload lands", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    for (let i = 0; i < 4; i++) await upload(t, band, "track", mp3());
    const me = await as(t, band);
    const a = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    // Simulate a race: an extra track row appears before the pending upload lands.
    await t.run((ctx) =>
      ctx.db.insert("tracks", { profileId: band, title: "x", key: "tracks/extra", size: 1, order: 99, autoplay: false }),
    );
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId: a.uploadId });
    objects.set(key, mp3());
    await me.action(api.media.confirmTrackUpload, { uploadId: a.uploadId });
    expect(removed).toEqual([key]);
    expect(await tracksOf(t, band)).toHaveLength(5);
  });
});

describe("onSyncMetadata for photos", () => {
  test("declared photo over 2 MB or of the wrong type is refused", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan");
    const me = await as(t, fan);
    await expect(me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg(2 * MB + 1) })).rejects.toThrow(
      "File is too large",
    );
    await expect(
      me.mutation(api.media.beginUpload, { purpose: "photo", size: 100, contentType: "image/svg+xml" }),
    ).rejects.toThrow("That file type isn't allowed");
  });

  test("synced photo over 2 MB or of the wrong type deletes the object and keeps the old photo", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan", { photoKey: "photos/old" });
    const big = await upload(t, fan, "photo", jpeg(), undefined, jpeg(2 * MB + 1));
    const svg = await upload(t, fan, "photo", jpeg(100), undefined, { size: 100, contentType: "image/svg+xml" });
    expect(removals).toEqual([
      [big, "photo"],
      [svg, "photo"],
    ]);
    expect((await t.run((ctx) => ctx.db.get(fan)))!.photoKey).toBe("photos/old");
    expect(await pendingCount(t)).toBe(0);
  });

  test("new photo replaces photoKey and deletes the old object", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan", { photoKey: "photos/old" });
    const key = await upload(t, fan, "photo", { size: 2 * MB, contentType: "image/webp" });
    expect((await t.run((ctx) => ctx.db.get(fan)))!.photoKey).toBe(key);
    expect(removals).toEqual([["photos/old", "photo"]]);
  });
});

describe("upload lifecycle", () => {
  test("the URL is requested for the row's key, declared size and type", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3(1234) });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    expect(storage.uploadUrl).toHaveBeenCalledWith({ key, size: 1234, contentType: "audio/mpeg", purpose: "track" });
  });

  test("the owner's syncMetadata call for a photo resolves and schedules the component's metadata sync", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg() });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    await expect(me.mutation(api.media.syncMetadata, { key })).resolves.toBeNull();
    // The component's HEAD action is scheduled but never run: fake timers hold it.
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const sync = jobs.find((j) => j.name.includes("syncMetadata"));
    expect(sync?.args[0]).toMatchObject({ key, onComplete: expect.any(String) });
  });

  test("expireUpload waits until a URL issued just before the hour has expired, plus 60 s", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    const tick = async (ms: number) => {
      vi.advanceTimersByTime(ms);
      await t.finishInProgressScheduledFunctions();
    };
    // Last moment a URL can be issued: 1 ms before UPLOAD_TTL_MS.
    await tick(UPLOAD_TTL_MS - 1);
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    const urlDeadAt = UPLOAD_TTL_MS - 1 + UPLOAD_URL_TTL_S * 1000;
    // Still pending at the hour, at URL expiry, and right up to URL expiry plus 60 s.
    await tick(1);
    expect(await pendingCount(t)).toBe(1);
    await tick(urlDeadAt + 60 * 1000 - UPLOAD_TTL_MS);
    expect(await pendingCount(t)).toBe(1);
    expect(removed).toEqual([]);
    expect(EXPIRE_AFTER_MS).toBeGreaterThan(urlDeadAt + 60 * 1000);
    await tick(EXPIRE_AFTER_MS - (urlDeadAt + 60 * 1000));
    expect(await pendingCount(t)).toBe(0);
    expect(removed).toEqual([key]);
  });

  test("generateUploadUrl refuses a row at or past UPLOAD_TTL_MS", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    vi.advanceTimersByTime(UPLOAD_TTL_MS + 1);
    await expect(me.mutation(api.media.generateUploadUrl, { uploadId })).rejects.toThrow("Upload expired");
  });

  test("expireUpload also clears a public copy of a track, and not for photos", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const me = await as(t, band);
    const { uploadId } = await me.mutation(api.media.beginUpload, { purpose: "track", ...mp3() });
    const { key } = await me.mutation(api.media.generateUploadUrl, { uploadId });
    vi.advanceTimersByTime(EXPIRE_AFTER_MS + 1);
    await t.finishInProgressScheduledFunctions();
    expect(removed).toEqual([key]);
    expect(legacyRemoved).toEqual([key]);
  });

  test("a rejected track also clears a public copy", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3(), undefined, mp3(MB));
    expect(legacyRemoved).toEqual([key]);
  });

  test("a rejected photo does not touch the public-copy cleanup", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    await upload(t, band, "photo", { size: 10, contentType: "image/jpeg" }, undefined, { size: 11, contentType: "image/jpeg" });
    expect(legacyRemoved).toEqual([]);
  });

  test("expireUpload does nothing once the upload was accepted", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    const key = await upload(t, band, "track", mp3());
    vi.advanceTimersByTime(EXPIRE_AFTER_MS + 1);
    await t.finishInProgressScheduledFunctions();
    expect(removed).toEqual([]);
    expect((await tracksOf(t, band)).map((r) => r.key)).toEqual([key]);
  });

  test("beginUpload is limited to 30 per hour", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan");
    const me = await as(t, fan);
    for (let i = 0; i < 30; i++) await me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg() });
    await expect(me.mutation(api.media.beginUpload, { purpose: "photo", ...jpeg() })).rejects.toThrow(
      "Slow down",
    );
  });
});

describe("media flags", () => {
  const flags = async (t: T, id: Id<"profiles">) => {
    const p = await t.run((ctx) => ctx.db.get(id));
    return [p!.hasPhoto, p!.hasTracks];
  };

  test("accepting a photo sets hasPhoto, and replacing it keeps it", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan");
    expect((await flags(t, fan))[0]).toBeUndefined();
    await upload(t, fan, "photo", jpeg());
    expect((await flags(t, fan))[0]).toBe(true);
    await upload(t, fan, "photo", jpeg());
    expect((await flags(t, fan))[0]).toBe(true);
  });

  test("a rejected photo leaves hasPhoto alone", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan");
    await upload(t, fan, "photo", jpeg(), undefined, { size: 3 * MB, contentType: "image/jpeg" });
    expect((await flags(t, fan))[0]).toBeUndefined();
  });

  test("the first track sets hasTracks and deleting the last one clears it", async () => {
    const t = mediaSetup();
    const band = await addProfile(t, "band", { kind: "artist" });
    await upload(t, band, "track", mp3());
    await upload(t, band, "track", mp3());
    expect((await flags(t, band))[1]).toBe(true);
    const me = await as(t, band);
    const [a, b] = await tracksOf(t, band);
    await me.mutation(api.media.deleteTrack, { trackId: a._id });
    expect((await flags(t, band))[1]).toBe(true);
    await me.mutation(api.media.deleteTrack, { trackId: b._id });
    expect((await flags(t, band))[1]).toBe(false);
  });

  test("an admin deleting the last track clears hasTracks", async () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
    const t = mediaSetup();
    const boss = await addProfile(t, "boss");
    const band = await addProfile(t, "band", { kind: "artist" });
    await upload(t, band, "track", mp3());
    const [a] = await tracksOf(t, band);
    await (await as(t, boss)).mutation(api.moderation.deleteTrack, { trackId: a._id });
    expect((await flags(t, band))[1]).toBe(false);
    vi.unstubAllEnvs();
  });

  test("becomeArtist syncs the flags from the truth", async () => {
    const t = mediaSetup();
    const fan = await addProfile(t, "fan", { photoKey: "p.jpg" });
    await t.run((ctx) =>
      ctx.db.insert("tracks", { profileId: fan, title: "x", key: "k", size: 1, order: 0, autoplay: true }),
    );
    await (await as(t, fan)).mutation(api.profiles.becomeArtist, {});
    expect(await flags(t, fan)).toEqual([true, true]);
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
    // Deleted from the audio bucket, and from the public bucket in case it is a legacy upload.
    expect(removals).toEqual([[key, "track"]]);
    expect(legacyRemoved).toEqual([key]);
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
