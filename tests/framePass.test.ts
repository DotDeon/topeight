import { describe, expect, test } from "vitest";
import { FRAME_PASS_TTL_MS, signFramePass, verifyFramePass } from "@/convex/lib/framePass";

const SECRET = "test-frame-secret";
const NOW = Date.UTC(2026, 9, 20, 12);
const PROFILE = "k17abc";

describe("frame pass", () => {
  test("lasts 2 hours", () => {
    expect(FRAME_PASS_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  test("is <expiresAt>.<base64url HMAC-SHA256>", async () => {
    const token = await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, SECRET);
    expect(token).toMatch(new RegExp(`^${NOW + FRAME_PASS_TTL_MS}\\.[A-Za-z0-9_-]{43}$`));
    // Same inputs, same pass: no randomness, so it can be checked anywhere.
    expect(await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, SECRET)).toBe(token);
  });

  test("a fresh pass verifies for its profile until it expires", async () => {
    const expiresAt = NOW + FRAME_PASS_TTL_MS;
    const token = await signFramePass(PROFILE, expiresAt, SECRET);
    expect(await verifyFramePass(token, PROFILE, NOW, SECRET)).toBe(true);
    expect(await verifyFramePass(token, PROFILE, expiresAt - 1, SECRET)).toBe(true);
  });

  test("an expired pass fails", async () => {
    const expiresAt = NOW + FRAME_PASS_TTL_MS;
    const token = await signFramePass(PROFILE, expiresAt, SECRET);
    expect(await verifyFramePass(token, PROFILE, expiresAt, SECRET)).toBe(false);
    expect(await verifyFramePass(token, PROFILE, expiresAt + 1, SECRET)).toBe(false);
  });

  test("a pass expiring further out than any issued one fails", async () => {
    const token = await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS + 60_000, SECRET);
    expect(await verifyFramePass(token, PROFILE, NOW, SECRET)).toBe(false);
  });

  test("a pass for another profile fails", async () => {
    const token = await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, SECRET);
    expect(await verifyFramePass(token, "k17other", NOW, SECRET)).toBe(false);
  });

  test("a pass signed with another secret fails", async () => {
    const token = await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, "another-secret");
    expect(await verifyFramePass(token, PROFILE, NOW, SECRET)).toBe(false);
  });

  test("a tampered pass fails", async () => {
    const expiresAt = NOW + FRAME_PASS_TTL_MS;
    const token = await signFramePass(PROFILE, expiresAt, SECRET);
    const [, mac] = token.split(".");
    // A later expiry with the old signature.
    expect(await verifyFramePass(`${expiresAt + 1000}.${mac}`, PROFILE, NOW, SECRET)).toBe(false);
    // One signature character changed.
    const flipped = mac.slice(0, -2) + (mac.at(-2) === "A" ? "B" : "A") + mac.at(-1);
    expect(await verifyFramePass(`${expiresAt}.${flipped}`, PROFILE, NOW, SECRET)).toBe(false);
  });

  test("malformed passes fail", async () => {
    const good = await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, SECRET);
    for (const bad of [
      "",
      ".",
      "abc",
      good.split(".")[1],
      `${good}.extra`,
      `x${good}`,
      ` ${good}`,
      good.replace(".", ".="),
      `-1.${good.split(".")[1]}`,
      `1e15.${good.split(".")[1]}`,
      `${good.split(".")[0]}.${good.split(".")[1]}=`,
    ]) {
      expect(await verifyFramePass(bad, PROFILE, NOW, SECRET)).toBe(false);
    }
    expect(await verifyFramePass(null, PROFILE, NOW, SECRET)).toBe(false);
    expect(await verifyFramePass(undefined, PROFILE, NOW, SECRET)).toBe(false);
  });

  test("nothing verifies without a secret", async () => {
    const token = await signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, SECRET);
    expect(await verifyFramePass(token, PROFILE, NOW, undefined)).toBe(false);
    expect(await verifyFramePass(token, PROFILE, NOW, "")).toBe(false);
    await expect(signFramePass(PROFILE, NOW + FRAME_PASS_TTL_MS, "")).rejects.toThrow();
  });
});
