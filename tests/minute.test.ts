import { expect, test } from "vitest";
import { currentMinute } from "../lib/minute";

test("currentMinute rounds down to the minute", () => {
  const t = Date.UTC(2026, 9, 20, 12, 34, 56, 789);
  expect(currentMinute(t)).toBe(Date.UTC(2026, 9, 20, 12, 34, 0, 0));
  expect(currentMinute(Date.UTC(2026, 9, 20, 12, 34))).toBe(Date.UTC(2026, 9, 20, 12, 34));
});
