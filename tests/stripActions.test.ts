import { describe, expect, test } from "vitest";
import { stripButtons } from "../components/stripActions";

const base = { signedIn: true, self: false, friends: false, pendingOut: false, blocked: false };
const labels = (r: Parameters<typeof stripButtons>[0], house = false) => stripButtons(r, house).map((b) => b.label);

describe("stripButtons", () => {
  test("signed out and loading show the default strip", () => {
    const def = ["Add to Friends", "Add Comment", "Report", "Block"];
    expect(labels({ ...base, signedIn: false })).toEqual(def);
    expect(labels(undefined)).toEqual(def);
    expect(labels(null)).toEqual(def);
  });
  test("own profile hides friend and block actions", () => {
    expect(labels({ ...base, self: true })).toEqual(["Add Comment", "Report"]);
  });
  test("friends get Remove from Friends, except the house", () => {
    expect(labels({ ...base, friends: true })[0]).toBe("Remove from Friends");
    expect(labels({ ...base, friends: true }, true)).toEqual(["Add Comment", "Report", "Block"]);
  });
  test("a pending request shows a disabled Request sent", () => {
    const [first] = stripButtons({ ...base, pendingOut: true }, false);
    expect(first).toMatchObject({ label: "Request sent", disabled: true });
  });
  test("blocked swaps Block for Unblock", () => {
    expect(labels({ ...base, blocked: true })).toEqual(["Add to Friends", "Add Comment", "Report", "Unblock"]);
  });
});
