import { describe, expect, test } from "vitest";
import { PROFILE_ACTIONS } from "../components/profileActions";
import { stripButtons } from "../components/stripActions";

const base = { signedIn: true, self: false, friends: false, pendingOut: false, blocked: false };
const pairs = (r: Parameters<typeof stripButtons>[0], house = false) =>
  stripButtons(r, house).map((b) => [b.action, b.label]);
const L = (a: keyof typeof PROFILE_ACTIONS) => PROFILE_ACTIONS[a].label;

describe("stripButtons", () => {
  test("signed out and unknown show the default strip", () => {
    const def = [["addFriend", "Add to Friends"], ["addComment", "Add Comment"], ["report", "Report"], ["block", "Block"]];
    expect(pairs({ ...base, signedIn: false })).toEqual(def);
    expect(pairs(null)).toEqual(def);
  });
  test("nothing friend or block shows until both queries load", () => {
    const only = [["addComment", "Add Comment"], ["report", "Report"]];
    const names = (b: ReturnType<typeof stripButtons>) => b.map((x) => [x.action, x.label]);
    expect(names(stripButtons(undefined, false))).toEqual(only);
    expect(names(stripButtons(base, undefined))).toEqual(only);
  });
  test("own profile hides friend and block actions", () => {
    expect(pairs({ ...base, self: true })).toEqual([["addComment", "Add Comment"], ["report", "Report"]]);
  });
  test("friends get removeFriend, except the house", () => {
    const [first, , , last] = stripButtons({ ...base, friends: true }, false);
    expect(first).toMatchObject({ action: "removeFriend", label: "Remove from Friends" });
    expect(last).toMatchObject({ action: "block", label: "Block" });
    expect(pairs({ ...base, friends: true }, true).map(([a]) => a)).toEqual(["addComment", "report", "block"]);
  });
  test("a pending request shows a disabled Request sent", () => {
    expect(stripButtons({ ...base, pendingOut: true }, false)[0]).toMatchObject({
      action: "addFriend", label: "Request sent", disabled: true,
    });
  });
  test("blocked swaps block for unblock", () => {
    const b = stripButtons({ ...base, blocked: true }, false);
    expect(b[0]).toMatchObject({ action: "addFriend", label: "Add to Friends" });
    expect(b[3]).toMatchObject({ action: "unblock", label: "Unblock" });
  });
  test("labels come from PROFILE_ACTIONS", () => {
    expect(L("removeFriend")).toBe("Remove from Friends");
    expect(L("unblock")).toBe("Unblock");
  });
});
