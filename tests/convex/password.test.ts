import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../convex/lib/password";

test("hashes and verifies passwords", async () => {
  const stored = await hashPassword("correct horse");
  expect(stored).toMatch(/^pbkdf2-sha256\$600000\$/);
  expect(await verifyPassword("correct horse", stored)).toBe(true);
  expect(await verifyPassword("wrong horse", stored)).toBe(false);
  expect(await verifyPassword("correct horse", "garbage")).toBe(false);
  expect(await hashPassword("correct horse")).not.toBe(stored);
});
