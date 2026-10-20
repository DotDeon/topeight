import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { errorText } from "../lib/errorText";

describe("errorText", () => {
  test("returns ConvexError string data", () => {
    expect(errorText(new ConvexError("Slow down"))).toBe("Slow down");
  });
  test("returns the default fallback otherwise", () => {
    expect(errorText(new Error("boom"))).toBe("Something went wrong.");
    expect(errorText(new ConvexError({ code: 1 }))).toBe("Something went wrong.");
    expect(errorText(undefined)).toBe("Something went wrong.");
  });
  test("returns a custom fallback", () => {
    expect(errorText("x", "Nope")).toBe("Nope");
  });
});
