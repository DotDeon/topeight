import { describe, expect, test } from "vitest";
import { classifyHost, routeForHost } from "@/lib/hosts";

describe("hosts", () => {
  test("classifies hosts from env origins", () => {
    expect(classifyHost("localhost:3000")).toBe("main");
    expect(classifyHost("127.0.0.1:3000")).toBe("usercontent");
    expect(classifyHost("evil.com")).toBe("unknown");
  });

  test("usercontent host only serves profile documents", () => {
    expect(routeForHost("usercontent", "/lowveld")).toEqual({
      action: "rewrite",
      to: "/usercontent/lowveld",
    });
    expect(routeForHost("usercontent", "/admin")).toEqual({
      action: "rewrite",
      to: "/usercontent/admin",
    });
    expect(routeForHost("usercontent", "/a/b")).toEqual({ action: "notFound" });
  });

  test("usercontent host serves the tracks JSON on the profile path only", () => {
    expect(routeForHost("usercontent", "/lowveld", "?format=tracks")).toEqual({
      action: "rewrite",
      to: "/usercontent/lowveld?format=tracks",
    });
    // Any other query is dropped, so the route only ever sees format=tracks.
    expect(routeForHost("usercontent", "/lowveld", "?format=html&x=1")).toEqual({
      action: "rewrite",
      to: "/usercontent/lowveld",
    });
    expect(routeForHost("usercontent", "/a/b", "?format=tracks")).toEqual({ action: "notFound" });
    expect(routeForHost("usercontent", "/lowveld", "?own=1")).toEqual({
      action: "rewrite",
      to: "/usercontent/lowveld?own=1",
    });
    expect(routeForHost("usercontent", "/lowveld", "?own=1&format=tracks")).toEqual({
      action: "rewrite",
      to: "/usercontent/lowveld?format=tracks&own=1",
    });
    // Only the exact value 1 counts.
    for (const own of ["0", "true", "", "11", "1x"]) {
      expect(routeForHost("usercontent", "/lowveld", `?own=${own}`)).toEqual({
        action: "rewrite",
        to: "/usercontent/lowveld",
      });
    }
    expect(routeForHost("main", "/lowveld", "?format=tracks")).toEqual({ action: "next" });
  });

  test("usercontent host forwards a well-formed frame pass explicitly", () => {
    const pass = `1792000000000.${"Ab_-".repeat(10)}xyz`;
    expect(routeForHost("usercontent", "/lowveld", `?pass=${pass}`)).toEqual({
      action: "rewrite",
      to: `/usercontent/lowveld?pass=${pass}`,
    });
    expect(routeForHost("usercontent", "/lowveld", `?own=1&pass=${pass}`)).toEqual({
      action: "rewrite",
      to: `/usercontent/lowveld?own=1&pass=${pass}`,
    });
    expect(routeForHost("usercontent", "/lowveld", `?format=tracks&pass=${pass}&x=1`)).toEqual({
      action: "rewrite",
      to: `/usercontent/lowveld?format=tracks&pass=${pass}`,
    });
    // Anything not shaped like a pass is dropped, so the route never sees it.
    const bad = [
      "",
      "abc",
      `0.${"A".repeat(43)}`,
      `01.${"A".repeat(43)}`,
      `${"1".repeat(17)}.${"A".repeat(43)}`,
      `1.${"A".repeat(42)}`,
      `1.${"A".repeat(44)}`,
      `1.${"A".repeat(42)}=`,
      `1.${"A".repeat(42)}+`,
      `${pass}%0A`,
    ];
    for (const p of bad) {
      expect(routeForHost("usercontent", "/lowveld", `?own=1&pass=${p}`)).toEqual({
        action: "rewrite",
        to: "/usercontent/lowveld?own=1",
      });
    }
    expect(routeForHost("usercontent", "/a/b", `?pass=${pass}`)).toEqual({ action: "notFound" });
  });

  test("main host never serves /usercontent", () => {
    expect(routeForHost("main", "/usercontent/lowveld")).toEqual({
      action: "notFound",
    });
    expect(routeForHost("main", "/lowveld")).toEqual({ action: "next" });
  });
});
