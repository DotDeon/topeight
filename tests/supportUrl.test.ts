import { describe, expect, test } from "vitest";
import { supportUrl } from "@/lib/supportUrl";

describe("supportUrl", () => {
  test("returns null when unset or blank", () => {
    expect(supportUrl(undefined)).toBeNull();
    expect(supportUrl("")).toBeNull();
  });
  test("rejects non-http protocols", () => {
    expect(supportUrl("javascript:alert(1)")).toBeNull();
  });
  test("rejects malformed values", () => {
    expect(supportUrl("not a url")).toBeNull();
  });
  test("accepts https", () => {
    expect(supportUrl("https://github.com/sponsors/topeight")).toBe("https://github.com/sponsors/topeight");
  });
});
