/** The classic mood emoticons a blog post can carry. Task 7 draws each one. */
export const MOOD_ICONS = [
  "happy",
  "sad",
  "excited",
  "tired",
  "angry",
  "chill",
  "in-love",
  "sick",
  "bored",
  "curious",
  "creative",
  "nostalgic",
  "hyper",
  "sleepy",
  "silly",
  "grumpy",
  "hopeful",
  "stressed",
  "proud",
  "confused",
] as const;

export type MoodIcon = (typeof MOOD_ICONS)[number];
