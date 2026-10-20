/**
 * Decides whether the profile frame may open the parent's confirm dialog.
 * Stops artist code from trapping a visitor in a loop of dialogs, without
 * locking out ordinary use:
 * - requests in the second after a dialog closes are ignored (double clicks);
 * - after 3 cancelled bridge dialogs that could act, the frame is throttled
 *   until 30 s pass since the last cancel or the visitor uses the trusted strip;
 * - "Send Message" opens no dialog. It goes straight to the compose page but
 *   passes through the gate and counts as a cancel, so artist code can't loop it;
 * - coming-soon dialogs (no action to run) and strip dialogs never count.
 */
export const BRIDGE_COOLDOWN_MS = 1000;
export const MAX_CANCELLED_BRIDGE_DIALOGS = 3;
export const BRIDGE_RESET_MS = 30_000;

export type GateResult = "ok" | "cooldown" | "throttled";

export class BridgeGate {
  private cancelled = 0;
  private lastCancelAt = -Infinity;
  private closedAt = -Infinity;

  check(now: number): GateResult {
    if (now - this.closedAt < BRIDGE_COOLDOWN_MS) return "cooldown";
    if (now - this.lastCancelAt >= BRIDGE_RESET_MS) this.cancelled = 0;
    return this.cancelled >= MAX_CANCELLED_BRIDGE_DIALOGS ? "throttled" : "ok";
  }

  closed(
    now: number,
    d: { fromBridge: boolean; counts: boolean; outcome: "cancelled" | "done" },
  ): void {
    this.closedAt = now;
    if (!d.fromBridge || !d.counts) return;
    if (d.outcome === "done") {
      this.cancelled = 0;
      return;
    }
    if (now - this.lastCancelAt >= BRIDGE_RESET_MS) this.cancelled = 0;
    this.cancelled += 1;
    this.lastCancelAt = now;
  }

  /** The visitor used the trusted strip. */
  reset(): void {
    this.cancelled = 0;
  }
}
