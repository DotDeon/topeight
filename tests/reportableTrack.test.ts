import { describe, expect, test } from "vitest";
import { findReportableTrack } from "@/lib/reportableTrack";

const tracks = [
  { id: "k1", title: "Red Dust" },
  { id: "k2", title: "Blue Smoke" },
];

describe("findReportableTrack", () => {
  test("returns a fresh copy of the server's track for a known id", () => {
    const found = findReportableTrack(tracks, "k2");
    expect(found).toEqual({ id: "k2", title: "Blue Smoke" });
    expect(found).not.toBe(tracks[1]);
  });

  test.each(["k3", "", "K1", " k1", "k1 ", "__proto__", "toString"])("returns null for unknown id %j", (id) => {
    expect(findReportableTrack(tracks, id)).toBeNull();
  });

  test("returns null when the profile has no tracks", () => {
    expect(findReportableTrack([], "k1")).toBeNull();
  });
});

describe("findReportableTrack with an owner", () => {
  const list = [
    { id: "k1", title: "Red Dust", owner: "me" },
    { id: "s1", title: "Their Song", owner: "theband" },
  ];
  test("keeps the owner the server gave, so the report names the right profile", () => {
    expect(findReportableTrack(list, "s1")).toEqual({ id: "s1", title: "Their Song", owner: "theband" });
    expect(findReportableTrack(list, "k1")).toEqual({ id: "k1", title: "Red Dust", owner: "me" });
  });
  test("leaves owner off when the list has none", () => {
    expect(findReportableTrack([{ id: "a", title: "A" }], "a")).toEqual({ id: "a", title: "A" });
  });
});
