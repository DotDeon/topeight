"use client";

import { useEffect, useState } from "react";
import { currentMinute } from "@/lib/minute";

/**
 * The current minute (lib/minute.ts), updated once a minute. Pass it as `asOf`
 * so a live query re-subscribes every minute and Online Now! can't go stale.
 */
export function useMinute(): number {
  const [minute, setMinute] = useState(currentMinute);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    // Wake just after the next minute starts.
    const schedule = () => {
      const now = Date.now();
      timer = setTimeout(tick, currentMinute(now) + 60_000 - now + 50);
    };
    const tick = () => {
      setMinute(currentMinute());
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return minute;
}
