import type { Id } from "../_generated/dataModel";

/** Friendship rows store the two profile ids sorted by id string, a < b. */
export function friendshipPair(
  x: Id<"profiles">,
  y: Id<"profiles">,
): { a: Id<"profiles">; b: Id<"profiles"> } {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}
