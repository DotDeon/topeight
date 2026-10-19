import { describe, expect, test } from "vitest";
import {
  ageOn,
  containsLink,
  tokenizeComment,
  validateUsername,
} from "@/lib/validation";

describe("validation", () => {
  test("usernames", () => {
    expect(validateUsername("Lowveld")).toEqual({ ok: true, username: "lowveld" });
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("has space").ok).toBe(false);
    for (const r of ["admin", "edit", "login", "signup", "browse", "search", "bulletins", "api", "about", "usercontent", "coming-soon"])
      expect(validateUsername(r).ok).toBe(false);
  });
  test("age", () => {
    expect(ageOn("2013-10-20", new Date("2026-10-19"))).toBe(12);
    expect(ageOn("2013-10-19", new Date("2026-10-19"))).toBe(13);
  });
  test("links and images", () => {
    expect(containsLink("see www.spam.biz")).toBe(true);
    expect(containsLink("see you in cape town")).toBe(false);
    expect(tokenizeComment("hi https://x.com/a.gif yo")).toEqual([
      { type: "text", value: "hi " }, { type: "image", url: "https://x.com/a.gif" }, { type: "text", value: " yo" }]);
    expect(tokenizeComment("javascript:alert(1).png")).toEqual([{ type: "text", value: "javascript:alert(1).png" }]);
  });
});
