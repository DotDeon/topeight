import { v } from "convex/values";
import { MOOD_ICONS } from "../../lib/moods";

/** Validator for one of the 20 mood icon ids in lib/moods.ts. */
export const moodIcon = v.union(...MOOD_ICONS.map((icon) => v.literal(icon)));
