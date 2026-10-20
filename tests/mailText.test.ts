import { describe, expect, test } from "vitest";
import { QUOTE_RULE, quoteBody, replySubject, unreadBadge } from "../lib/mailText";

describe("replySubject", () => {
  test("prefixes Re: once", () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("Re: Hello")).toBe("Re: Hello");
    expect(replySubject("re: Hello")).toBe("re: Hello");
    expect(replySubject("RE:Hello")).toBe("RE:Hello");
  });
  test("stays within the 100 character subject limit", () => {
    expect(replySubject("x".repeat(100))).toHaveLength(100);
  });
});

describe("quoteBody", () => {
  test("puts a line of dashes then each line prefixed with > ", () => {
    expect(quoteBody("one\ntwo")).toBe(`\n\n${QUOTE_RULE}\n> one\n> two`);
    expect(QUOTE_RULE).toMatch(/^-+$/);
  });
  test("keeps blank lines quoted and handles CRLF", () => {
    expect(quoteBody("a\r\n\r\nb")).toBe(`\n\n${QUOTE_RULE}\n> a\n> \n> b`);
  });
  test("fits the 5000 character message limit", () => {
    expect(quoteBody("y".repeat(9000)).length).toBeLessThanOrEqual(5000);
  });
});

describe("unreadBadge", () => {
  test("hides zero, caps at 99+", () => {
    expect(unreadBadge(0)).toBe("");
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(99)).toBe("99");
    expect(unreadBadge(100)).toBe("99+");
  });
});
