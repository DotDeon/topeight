import { describe, expect, test } from "vitest";
import { BRIDGE_ACTIONS } from "@/lib/bridge-protocol";
import { clampFrameHeight, navigatePath, parseBridgeMessage } from "@/lib/bridge";

const frame = { name: "profile-frame" };
const ev = (data: unknown, extra: Partial<{ origin: string; source: unknown }> = {}) => ({
  origin: "null",
  source: frame,
  data,
  ...extra,
});

describe("parseBridgeMessage: sender checks", () => {
  test("accepts a message from the frame with the opaque origin", () => {
    expect(parseBridgeMessage(ev({ type: "topeight:action", action: "addFriend" }), frame)).toEqual({
      type: "topeight:action",
      action: "addFriend",
    });
  });

  test.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://evil.example",
    "",
    "undefined",
  ])("rejects origin %j", (origin) => {
    expect(parseBridgeMessage(ev({ type: "topeight:action", action: "addFriend" }, { origin }), frame)).toBeNull();
  });

  test("rejects a message from any other source", () => {
    const msg = { type: "topeight:action", action: "addFriend" };
    expect(parseBridgeMessage(ev(msg, { source: { name: "other" } }), frame)).toBeNull();
    expect(parseBridgeMessage(ev(msg, { source: null }), frame)).toBeNull();
    expect(parseBridgeMessage(ev(msg, { source: undefined }), frame)).toBeNull();
  });

  test("rejects everything when there is no frame yet", () => {
    const msg = { type: "topeight:action", action: "addFriend" };
    expect(parseBridgeMessage(ev(msg, { source: null }), null)).toBeNull();
    expect(parseBridgeMessage(ev(msg, { source: undefined }), undefined)).toBeNull();
  });
});

describe("parseBridgeMessage: strip-only actions", () => {
  test.each(["removeFriend", "unblock", "reportTrack"])("drops %s as an action", (action) => {
    expect(parseBridgeMessage(ev({ type: "topeight:action", action }), frame)).toBeNull();
  });
});

describe("parseBridgeMessage: payload checks", () => {
  test.each([null, undefined, "topeight:action", 42, [], true])("rejects non-object data %j", (data) => {
    expect(parseBridgeMessage(ev(data), frame)).toBeNull();
  });

  test.each(["topeight:evil", "topeight:login", "", "TOPEIGHT:ACTION", undefined])(
    "rejects unknown type %j",
    (type) => {
      expect(parseBridgeMessage(ev({ type, action: "addFriend" }), frame)).toBeNull();
    },
  );

  test("accepts every known action and nothing else", () => {
    for (const action of BRIDGE_ACTIONS) {
      expect(parseBridgeMessage(ev({ type: "topeight:action", action }), frame)).toEqual({
        type: "topeight:action",
        action,
      });
    }
    for (const action of ["deleteAccount", "toString", "__proto__", "constructor", "", 1, null]) {
      expect(parseBridgeMessage(ev({ type: "topeight:action", action }), frame)).toBeNull();
    }
  });

  test("drops extra fields", () => {
    const parsed = parseBridgeMessage(
      ev({ type: "topeight:action", action: "block", target: "someone-else" }),
      frame,
    );
    expect(parsed).toEqual({ type: "topeight:action", action: "block" });
  });

  test("accepts finite heights up to 50000", () => {
    for (const height of [0, 1, 150.5, 4000, 50000]) {
      expect(parseBridgeMessage(ev({ type: "topeight:resize", height }), frame)).toEqual({
        type: "topeight:resize",
        height,
      });
    }
  });

  test.each(["800", null, undefined, NaN, Infinity, -Infinity, -1, 50001, 1e9, {}])(
    "rejects height %j",
    (height) => {
      expect(parseBridgeMessage(ev({ type: "topeight:resize", height }), frame)).toBeNull();
    },
  );

  test("accepts navigate to a valid username, normalised", () => {
    expect(parseBridgeMessage(ev({ type: "topeight:navigate", username: "Lowveld" }), frame)).toEqual({
      type: "topeight:navigate",
      username: "lowveld",
    });
  });

  test("accepts navigate with a known page", () => {
    for (const page of ["friends", "comments", "blog"]) {
      expect(
        parseBridgeMessage(ev({ type: "topeight:navigate", username: "lowveld", page }), frame),
      ).toEqual({ type: "topeight:navigate", username: "lowveld", page });
    }
  });

  test.each([
    "../admin",
    "lowveld/../../admin",
    "https://evil.example",
    "//evil.example",
    "admin",
    "edit",
    "a",
    "",
    "lowveld?x=1",
    "low veld",
    42,
    null,
  ])("rejects navigate username %j", (username) => {
    expect(parseBridgeMessage(ev({ type: "topeight:navigate", username }), frame)).toBeNull();
  });

  test.each(["edit", "../admin", "", "friends/x", 1, null])("rejects navigate page %j", (page) => {
    expect(
      parseBridgeMessage(ev({ type: "topeight:navigate", username: "lowveld", page }), frame),
    ).toBeNull();
  });
});

describe("parseBridgeMessage: reportTrack", () => {
  test("accepts a track id of 1 to 64 characters and drops extra fields", () => {
    for (const trackId of ["k", "k57c8x2r1yq4m0f9a3t6b", "x".repeat(64)]) {
      expect(
        parseBridgeMessage(ev({ type: "topeight:reportTrack", trackId, title: "Spoofed" }), frame),
      ).toEqual({ type: "topeight:reportTrack", trackId });
    }
  });

  test.each([undefined, null, "", 42, {}, ["abc"], "x".repeat(65)])("rejects track id %j", (trackId) => {
    expect(parseBridgeMessage(ev({ type: "topeight:reportTrack", trackId }), frame)).toBeNull();
  });

  test("rejects a reportTrack from anywhere but the frame", () => {
    const msg = { type: "topeight:reportTrack", trackId: "abc" };
    expect(parseBridgeMessage(ev(msg, { origin: "http://127.0.0.1:3000" }), frame)).toBeNull();
    expect(parseBridgeMessage(ev(msg, { source: { name: "other" } }), frame)).toBeNull();
  });
});

describe("parseBridgeMessage: pickSong", () => {
  test("accepts a track id of 1 to 64 characters and drops extra fields", () => {
    for (const trackId of ["k", "k57c8x2r1yq4m0f9a3t6b", "x".repeat(64)]) {
      expect(parseBridgeMessage(ev({ type: "topeight:pickSong", trackId, title: "Spoofed" }), frame)).toEqual({
        type: "topeight:pickSong",
        trackId,
      });
    }
  });

  test.each([undefined, null, "", 42, {}, ["abc"], "x".repeat(65)])("rejects track id %j", (trackId) => {
    expect(parseBridgeMessage(ev({ type: "topeight:pickSong", trackId }), frame)).toBeNull();
  });

  test("rejects a pickSong from anywhere but the frame", () => {
    const msg = { type: "topeight:pickSong", trackId: "abc" };
    expect(parseBridgeMessage(ev(msg, { origin: "http://127.0.0.1:3000" }), frame)).toBeNull();
    expect(parseBridgeMessage(ev(msg, { source: { name: "other" } }), frame)).toBeNull();
  });

  test("is not an action the frame can request", () => {
    expect(parseBridgeMessage(ev({ type: "topeight:action", action: "pickSong" }), frame)).toBeNull();
  });
});

describe("parseBridgeMessage: playVideo", () => {
  test.each(["h9NE3zDQ6pg", "dQw4w9WgXcQ", "a-b_c-d_e-f"])("accepts YouTube id %j and drops extra fields", (videoId) => {
    expect(parseBridgeMessage(ev({ type: "topeight:playVideo", videoId, url: "https://evil.example" }), frame)).toEqual({
      type: "topeight:playVideo",
      videoId,
    });
  });

  test.each([
    "",
    "short",
    "h9NE3zDQ6pgX",
    "h9NE3zDQ6p!",
    "h9NE3zDQ6p/",
    "h9NE3zDQ6pg\n",
    "javascript:",
    42,
    null,
    undefined,
    ["h9NE3zDQ6pg"],
  ])("rejects video id %j", (videoId) => {
    expect(parseBridgeMessage(ev({ type: "topeight:playVideo", videoId }), frame)).toBeNull();
  });

  test("rejects a playVideo from anywhere but the frame", () => {
    const msg = { type: "topeight:playVideo", videoId: "h9NE3zDQ6pg" };
    expect(parseBridgeMessage(ev(msg, { origin: "https://evil.example" }), frame)).toBeNull();
    expect(parseBridgeMessage(ev(msg, { source: { name: "other" } }), frame)).toBeNull();
  });
});

describe("clampFrameHeight", () => {
  test("clamps to 150..20000 and rounds up", () => {
    expect(clampFrameHeight(0)).toBe(150);
    expect(clampFrameHeight(149)).toBe(150);
    expect(clampFrameHeight(800.2)).toBe(801);
    expect(clampFrameHeight(20000)).toBe(20000);
    expect(clampFrameHeight(49999)).toBe(20000);
  });
});

describe("navigatePath", () => {
  test("builds main-origin paths only", () => {
    expect(navigatePath({ type: "topeight:navigate", username: "lowveld" })).toBe("/lowveld");
    expect(navigatePath({ type: "topeight:navigate", username: "lowveld", page: "friends" })).toBe(
      "/lowveld/friends",
    );
    expect(navigatePath({ type: "topeight:navigate", username: "lowveld", page: "comments" })).toBe(
      "/lowveld/comments",
    );
    expect(navigatePath({ type: "topeight:navigate", username: "lowveld", page: "blog" })).toBe("/lowveld/blog");
  });
});
