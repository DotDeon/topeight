import { describe, expect, test } from "vitest";
import { inviteEmail, parseEmails } from "../lib/inviteText";

describe("parseEmails", () => {
  test("splits on commas, semicolons and spaces, lowercases and drops repeats", () => {
    expect(parseEmails(" A@x.com,b@y.org;\n a@X.com  c@z.io ,, bad@nodot")).toEqual({
      valid: ["a@x.com", "b@y.org", "c@z.io"],
      invalid: ["bad@nodot"],
    });
  });
});

describe("inviteEmail", () => {
  const base = { joinUrl: "https://topeight.app/signup?invite=abc", stopUrl: "https://topeight.app/invite/stop?t=abc" };

  test("escapes the name and message in the HTML", () => {
    const { subject, text, html } = inviteEmail({
      ...base,
      inviterName: "<b>Al</b>",
      photoUrl: null,
      message: "hi & <script>",
    });
    expect(subject).toBe("<b>Al</b> has invited you to TopEight");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;Al&lt;/b&gt;");
    expect(html).toContain("hi &amp; &lt;script&gt;");
    expect(text).toContain("hi & <script>");
    expect(text).toContain(base.joinUrl);
    expect(html).toContain(base.stopUrl);
  });

  test("leaves the message and photo out when there are none", () => {
    const { text, html } = inviteEmail({ ...base, inviterName: "Al", photoUrl: null });
    expect(text).not.toContain("says:");
    expect(html).not.toContain("<img");
  });
});
