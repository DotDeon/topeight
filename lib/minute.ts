/**
 * The current time rounded down to the minute. Passed as `asOf` to queries that
 * report Online Now!, so their cache key moves every minute (convex/lib/presence.ts).
 */
export function currentMinute(now: number = Date.now()): number {
  return Math.floor(now / 60_000) * 60_000;
}
