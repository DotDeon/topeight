import { describe, expect, test } from "vitest";
import { assertLocalBackend } from "../e2e/global-setup";

describe("e2e fixture guard", () => {
  test("allows only local backends", () => {
    for (const ok of ["http://127.0.0.1:3210", "http://localhost:3210"]) expect(() => assertLocalBackend(ok)).not.toThrow();
    for (const bad of [undefined, "", "https://happy-animal-123.convex.cloud", "http://localhost.evil.com", "http://127.0.0.1.evil.com"]) {
      expect(() => assertLocalBackend(bad)).toThrow("e2e fixtures only run against a local Convex backend");
    }
  });
});
