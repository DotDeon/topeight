/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as blog from "../blog.js";
import type * as bulletins from "../bulletins.js";
import type * as comments from "../comments.js";
import type * as events from "../events.js";
import type * as favorites from "../favorites.js";
import type * as groups from "../groups.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_bulletins from "../lib/bulletins.js";
import type * as lib_cards from "../lib/cards.js";
import type * as lib_friendships from "../lib/friendships.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_moods from "../lib/moods.js";
import type * as lib_otp from "../lib/otp.js";
import type * as lib_password from "../lib/password.js";
import type * as lib_posting from "../lib/posting.js";
import type * as lib_presence from "../lib/presence.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_rsvps from "../lib/rsvps.js";
import type * as mail from "../mail.js";
import type * as media from "../media.js";
import type * as migrations from "../migrations.js";
import type * as moderation from "../moderation.js";
import type * as presence from "../presence.js";
import type * as profiles from "../profiles.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as shows from "../shows.js";
import type * as social from "../social.js";
import type * as testing from "../testing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  blog: typeof blog;
  bulletins: typeof bulletins;
  comments: typeof comments;
  events: typeof events;
  favorites: typeof favorites;
  groups: typeof groups;
  home: typeof home;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/bulletins": typeof lib_bulletins;
  "lib/cards": typeof lib_cards;
  "lib/friendships": typeof lib_friendships;
  "lib/limits": typeof lib_limits;
  "lib/media": typeof lib_media;
  "lib/moods": typeof lib_moods;
  "lib/otp": typeof lib_otp;
  "lib/password": typeof lib_password;
  "lib/posting": typeof lib_posting;
  "lib/presence": typeof lib_presence;
  "lib/r2": typeof lib_r2;
  "lib/rsvps": typeof lib_rsvps;
  mail: typeof mail;
  media: typeof media;
  migrations: typeof migrations;
  moderation: typeof moderation;
  presence: typeof presence;
  profiles: typeof profiles;
  search: typeof search;
  seed: typeof seed;
  shows: typeof shows;
  social: typeof social;
  testing: typeof testing;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
};
