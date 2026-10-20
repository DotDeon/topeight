import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/** Most rows any public listing query scans before giving up. */
export const MAX_SCAN = 200;
/** Most friendship rows read per index when listing a profile's friends. */
export const MAX_FRIENDS = 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Profile views counted per signed-in viewer per minute. */
export const VIEWS_PER_MINUTE = 60;
/** Profile views counted per minute across every anonymous visitor together. */
export const ANON_VIEWS_PER_MINUTE = 600;

/** Buckets the anonymous view limit is split across. */
export const ANON_VIEW_SHARDS = 10;

/** Per-account limits keyed by profile id, plus the shared anonymous view bucket. */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  friendRequest: { kind: "fixed window", rate: 50, period: HOUR },
  comment: { kind: "fixed window", rate: 30, period: HOUR },
  bulletin: { kind: "fixed window", rate: 10, period: HOUR },
  blogPost: { kind: "fixed window", rate: 10, period: DAY },
  blogEdit: { kind: "fixed window", rate: 30, period: HOUR },
  event: { kind: "fixed window", rate: 5, period: DAY },
  // Keyed by the profile id.
  rsvp: { kind: "fixed window", rate: 60, period: MINUTE },
  eventEdit: { kind: "fixed window", rate: 30, period: HOUR },
  groupCreate: { kind: "fixed window", rate: 3, period: DAY },
  groupTopic: { kind: "fixed window", rate: 10, period: HOUR },
  groupReply: { kind: "fixed window", rate: 60, period: HOUR },
  groupEdit: { kind: "fixed window", rate: 30, period: HOUR },
  upload: { kind: "fixed window", rate: 30, period: HOUR },
  report: { kind: "fixed window", rate: 20, period: HOUR },
  mail: { kind: "fixed window", rate: 30, period: HOUR },
  mailDaily: { kind: "fixed window", rate: 200, period: DAY },
  // Keyed by the normalized username being played.
  playback: { kind: "fixed window", rate: 120, period: MINUTE },
  // Keyed by the viewer's profile id.
  view: { kind: "fixed window", rate: VIEWS_PER_MINUTE, period: MINUTE },
  // One global bucket split across shards so concurrent anonymous views don't
  // all write the same row. `rate` is the total, so each shard holds 60.
  anonView: { kind: "fixed window", rate: ANON_VIEWS_PER_MINUTE, period: MINUTE, shards: ANON_VIEW_SHARDS },
});
