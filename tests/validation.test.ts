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
    for (const r of ["admin", "edit", "login", "signup", "browse", "search", "bulletins", "api", "about", "usercontent", "coming-soon", "brand"])
      expect(validateUsername(r).ok).toBe(false);
    for (const r of ["_next", "favicon", "robots", "sitemap", "mail", "favorites"])
      expect(validateUsername(r)).toEqual({ ok: false, reason: "That username is reserved." });
  });
  test("age", () => {
    expect(ageOn("2013-10-20", new Date("2026-10-19"))).toBe(12);
    expect(ageOn("2013-10-19", new Date("2026-10-19"))).toBe(13);
  });
  test("trailing punctuation is not part of a url", () => {
    expect(tokenizeComment("look https://x.com/a.gif.")).toEqual([
      { type: "text", value: "look " }, { type: "image", url: "https://x.com/a.gif" }, { type: "text", value: "." }]);
    expect(tokenizeComment("(see https://x.com/page), ok")).toEqual([
      { type: "text", value: "(see " }, { type: "link", url: "https://x.com/page" }, { type: "text", value: "), ok" }]);
  });
  test("links and images", () => {
    expect(containsLink("see www.spam.biz")).toBe(true);
    expect(containsLink("see you in cape town")).toBe(false);
    expect(tokenizeComment("hi https://x.com/a.gif yo")).toEqual([
      { type: "text", value: "hi " }, { type: "image", url: "https://x.com/a.gif" }, { type: "text", value: " yo" }]);
    expect(tokenizeComment("javascript:alert(1).png")).toEqual([{ type: "text", value: "javascript:alert(1).png" }]);
  });
});
