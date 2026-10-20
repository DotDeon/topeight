import { ConvexError } from "convex/values";

/** User-facing text for an error thrown by a Convex function. */
export function errorText(e: unknown, fallback = "Something went wrong."): string {
  return e instanceof ConvexError && typeof e.data === "string" ? e.data : fallback;
}
