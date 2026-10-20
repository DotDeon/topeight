import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@aws-sdk/s3-request-presigner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/s3-request-presigner")>();
  return { ...real, getSignedUrl: vi.fn(real.getSignedUrl) };
});

const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
const { audioBucket, headObject, presignGet, storage, PLAYBACK_URL_TTL_S, UPLOAD_URL_TTL_S } = await import(
  "../../convex/lib/r2"
);

afterEach(() => {
  vi.mocked(getSignedUrl).mockClear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("storage.uploadUrl", () => {
  const target = { key: "tracks/p1/abc", size: 1234, contentType: "audio/mpeg", purpose: "track" as const };

  test("signs a PUT locked to the declared size, type and a new key, for 5 minutes", async () => {
    const { key, url } = await storage.uploadUrl(target);
    expect(key).toBe(target.key);

    const [, command, options] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "test-audio-bucket",
      Key: target.key,
      ContentLength: 1234,
      ContentType: "audio/mpeg",
      IfNoneMatch: "*",
    });
    expect(UPLOAD_URL_TTL_S).toBe(300);
    expect(options?.expiresIn).toBe(300);
    expect(options?.signableHeaders?.has("content-type")).toBe(true);

    const u = new URL(url);
    expect(u.host).toBe("test-audio-bucket.test-account.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(`/${target.key}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    const signed = u.searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host", "if-none-match"]));
    // No checksum of an empty body, which would make R2 reject the real upload.
    expect(u.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  });

  test("tracks go to the private audio bucket, photos to the public bucket", async () => {
    const track = new URL((await storage.uploadUrl(target)).url);
    expect(track.host).toBe("test-audio-bucket.test-account.r2.cloudflarestorage.com");
    const photo = new URL(
      (await storage.uploadUrl({ key: "photos/p1/x", size: 10, contentType: "image/png", purpose: "photo" })).url,
    );
    expect(photo.host).toBe("test-bucket.test-account.r2.cloudflarestorage.com");
  });

  test("a track upload never falls back to the public bucket when R2_AUDIO_BUCKET is unset", async () => {
    vi.stubEnv("R2_AUDIO_BUCKET", "");
    await expect(storage.uploadUrl(target)).rejects.toThrow("R2_AUDIO_BUCKET");
    expect(() => audioBucket()).toThrow("R2_AUDIO_BUCKET");
  });
});

describe("presignGet", () => {
  test("signs a GET on the given bucket that expires in 15 minutes", async () => {
    expect(PLAYBACK_URL_TTL_S).toBe(900);
    const url = new URL(await presignGet("tracks/p1/abc", "test-audio-bucket", PLAYBACK_URL_TTL_S));
    const [, command] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(url.host).toBe("test-audio-bucket.test-account.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/tracks/p1/abc");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });
});

describe("headObject", () => {
  test("returns size and type from a HEAD on the given bucket", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
      ContentLength: 42,
      ContentType: "audio/mpeg",
    }));
    expect(await headObject("tracks/p1/abc", "test-audio-bucket")).toEqual({ size: 42, contentType: "audio/mpeg" });
    const command = send.mock.calls[0][0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toEqual({ Bucket: "test-audio-bucket", Key: "tracks/p1/abc" });
  });

  test("returns null when the object does not exist", async () => {
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => {
      throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    });
    expect(await headObject("tracks/p1/missing", "test-audio-bucket")).toBeNull();
  });
});
