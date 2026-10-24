import { v, type Infer } from "convex/values";

/** What a profile is. Picked at sign-up; only fans can switch, and only to artist. */
export const profileKind = v.union(v.literal("fan"), v.literal("artist"), v.literal("venue"), v.literal("label"));

export type ProfileKind = Infer<typeof profileKind>;

/** Artists, venues and labels may use custom HTML and JS. Fans get CSS only. */
export function canUseCode(kind: ProfileKind): boolean {
  return kind !== "fan";
}
