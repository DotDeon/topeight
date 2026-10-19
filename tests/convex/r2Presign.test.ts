import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";

vi.mock("@aws-sdk/s3-request-presigner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/s3-request-presigner")>();
  return { ...real, getSignedUrl: vi.fn(real.getSignedUrl) };
});

const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
const { storage, UPLOAD_URL_TTL_S } = await import("../../convex/lib/r2");

describe("storage.uploadUrl", () => {
  const target = { key: "tracks/p1/abc", size: 1234, contentType: "audio/mpeg" };

  test("signs a PUT locked to the declared size, type and a new key, for 5 minutes", async () => {
    const { key, url } = await storage.uploadUrl(target);
    expect(key).toBe(target.key);

    const [, command, options] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "test-bucket",
      Key: target.key,
      ContentLength: 1234,
      ContentType: "audio/mpeg",
      IfNoneMatch: "*",
    });
    expect(UPLOAD_URL_TTL_S).toBe(300);
    expect(options?.expiresIn).toBe(300);
    expect(options?.signableHeaders?.has("content-type")).toBe(true);

    const u = new URL(url);
    expect(u.host).toBe("test-bucket.test-account.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(`/${target.key}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    const signed = u.searchParams.get("X-Amz-SignedHeaders")!.split(";");
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "host", "if-none-match"]));
    // No checksum of an empty body, which would make R2 reject the real upload.
    expect(u.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  });
});
