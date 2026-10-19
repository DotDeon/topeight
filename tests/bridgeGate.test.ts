import { describe, expect, test } from "vitest";
import {
  BRIDGE_COOLDOWN_MS,
  BRIDGE_RESET_MS,
  BridgeGate,
  MAX_CANCELLED_BRIDGE_DIALOGS,
} from "@/lib/bridgeGate";

const cancelBridge = (g: BridgeGate, now: number, counts = true) =>
  g.closed(now, { fromBridge: true, counts, outcome: "cancelled" });

describe("BridgeGate", () => {
  test("allows a first request", () => {
    expect(new BridgeGate().check(0)).toBe("ok");
  });

  test("ignores requests during the cooldown after a close", () => {
    const g = new BridgeGate();
    cancelBridge(g, 10_000);
    expect(g.check(10_000 + BRIDGE_COOLDOWN_MS - 1)).toBe("cooldown");
    expect(g.check(10_000 + BRIDGE_COOLDOWN_MS)).toBe("ok");
  });

  test("throttles after the cap of cancelled bridge dialogs", () => {
    const g = new BridgeGate();
    let t = 10_000;
    for (let i = 0; i < MAX_CANCELLED_BRIDGE_DIALOGS; i++) {
      expect(g.check(t)).toBe("ok");
      cancelBridge(g, t);
      t += 2_000;
    }
    expect(g.check(t)).toBe("throttled");
  });

  test("dialogs with no run (coming soon) never count", () => {
    const g = new BridgeGate();
    let t = 10_000;
    for (let i = 0; i < 10; i++) {
      expect(g.check(t)).toBe("ok");
      cancelBridge(g, t, false);
      t += 2_000;
    }
    expect(g.check(t)).toBe("ok");
  });

  test("dialogs opened from the trusted strip never count", () => {
    const g = new BridgeGate();
    let t = 10_000;
    for (let i = 0; i < 10; i++) {
      g.closed(t, { fromBridge: false, counts: true, outcome: "cancelled" });
      t += 2_000;
    }
    expect(g.check(t)).toBe("ok");
  });

  test("a confirmed bridge dialog resets the count", () => {
    const g = new BridgeGate();
    cancelBridge(g, 10_000);
    cancelBridge(g, 12_000);
    g.closed(14_000, { fromBridge: true, counts: true, outcome: "done" });
    cancelBridge(g, 16_000);
    cancelBridge(g, 18_000);
    expect(g.check(20_000)).toBe("ok");
  });

  test("the count resets 30 s after the last cancel", () => {
    const g = new BridgeGate();
    let t = 10_000;
    for (let i = 0; i < MAX_CANCELLED_BRIDGE_DIALOGS; i++) cancelBridge(g, (t += 2_000));
    expect(g.check(t + BRIDGE_RESET_MS - 1)).toBe("throttled");
    expect(g.check(t + BRIDGE_RESET_MS)).toBe("ok");
  });

  test("old cancels do not add up with new ones", () => {
    const g = new BridgeGate();
    cancelBridge(g, 10_000);
    cancelBridge(g, 12_000);
    cancelBridge(g, 12_000 + BRIDGE_RESET_MS);
    expect(g.check(14_000 + BRIDGE_RESET_MS)).toBe("ok");
  });

  test("reset() (a trusted strip click) clears the throttle", () => {
    const g = new BridgeGate();
    let t = 10_000;
    for (let i = 0; i < MAX_CANCELLED_BRIDGE_DIALOGS; i++) cancelBridge(g, (t += 2_000));
    expect(g.check(t + 2_000)).toBe("throttled");
    g.reset();
    expect(g.check(t + 2_000)).toBe("ok");
  });
});
