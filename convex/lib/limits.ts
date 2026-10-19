import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/** Most rows any public listing query scans before giving up. */
export const MAX_SCAN = 200;
/** Most friendship rows read per index when listing a profile's friends. */
export const MAX_FRIENDS = 1000;

const HOUR = 60 * 60 * 1000;

/** Per-account hourly limits, keyed by profile id. */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  friendRequest: { kind: "fixed window", rate: 50, period: HOUR },
  comment: { kind: "fixed window", rate: 30, period: HOUR },
  bulletin: { kind: "fixed window", rate: 10, period: HOUR },
  upload: { kind: "fixed window", rate: 30, period: HOUR },
});
