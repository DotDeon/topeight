import type { MoodIcon } from "./moods";

/**
 * The 20 mood faces as SVG strings. components/MoodIcon.tsx and the profile
 * renderer both draw from here, so the two never drift. Every string is fixed
 * markup with no user input.
 */

const INK = "#222";
const line = (width = 1.2) =>
  `fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round"`;

// Eyes sit at x=5 and x=11, y=6.5. Mouths sit around y=11.
const dots = `<circle cx="5" cy="6.5" r="1.1" fill="${INK}"/><circle cx="11" cy="6.5" r="1.1" fill="${INK}"/>`;
const wide =
  `<circle cx="5" cy="6.5" r="2" fill="#fff" stroke="${INK}" stroke-width="0.8"/><circle cx="5" cy="6.5" r="0.9" fill="${INK}"/>` +
  `<circle cx="11" cy="6.5" r="2" fill="#fff" stroke="${INK}" stroke-width="0.8"/><circle cx="11" cy="6.5" r="0.9" fill="${INK}"/>`;
const arcsUp = `<path d="M3.5 7.2 Q5 5 6.5 7.2 M9.5 7.2 Q11 5 12.5 7.2" ${line()}/>`;
const arcsDown = `<path d="M3.5 6 Q5 8 6.5 6 M9.5 6 Q11 8 12.5 6" ${line()}/>`;
const flatEyes = `<path d="M3.5 6.5 H6.5 M9.5 6.5 H12.5" ${line()}/>`;
const heartPath = "M0 1.2 C-1.6 -0.6 -3 1.2 0 3.4 C3 1.2 1.6 -0.6 0 1.2 Z";
const hearts =
  `<path d="${heartPath}" transform="translate(5 5.2)" fill="#e0245e"/>` +
  `<path d="${heartPath}" transform="translate(11 5.2)" fill="#e0245e"/>`;
const shades =
  `<rect x="2.5" y="5" width="4.5" height="3" rx="1" fill="${INK}"/>` +
  `<rect x="9" y="5" width="4.5" height="3" rx="1" fill="${INK}"/>` +
  `<path d="M7 6 H9" ${line()}/>`;
const crossEyes = `<path d="M3.8 5.3 L6.2 7.7 M6.2 5.3 L3.8 7.7 M9.8 5.3 L12.2 7.7 M12.2 5.3 L9.8 7.7" ${line()}/>`;
const lookUp = `<circle cx="5" cy="5.6" r="1.1" fill="${INK}"/><circle cx="11" cy="5.6" r="1.1" fill="${INK}"/>`;
const browsAngry = `<path d="M3 4.2 L6.5 5.6 M13 4.2 L9.5 5.6" ${line()}/>`;
const browsFlat = `<path d="M3 4.8 H6.5 M9.5 4.8 H13" ${line()}/>`;

const smile = `<path d="M4.5 10 Q8 13.5 11.5 10" ${line()}/>`;
const grin = `<path d="M4 9.8 H12 Q11 13.8 8 13.8 Q5 13.8 4 9.8 Z" fill="#fff" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`;
const open = `<ellipse cx="8" cy="11.5" rx="2.2" ry="2.6" fill="#7a1f1f" stroke="${INK}" stroke-width="0.8"/>`;
const frown = `<path d="M4.5 12.5 Q8 9 11.5 12.5" ${line()}/>`;
const flat = `<path d="M5 11.5 H11" ${line()}/>`;
const small = `<circle cx="8" cy="11.5" r="1.2" fill="none" stroke="${INK}" stroke-width="1"/>`;
const wavy = `<path d="M4 11.5 Q5.5 10 7 11.5 T10 11.5 T12.5 11.5" ${line()}/>`;
const zigzag = `<path d="M4 11.5 L5.8 10.3 L7.6 12.3 L9.4 10.3 L11 11.5" ${line()}/>`;
const tongue =
  `<path d="M4.5 10 Q8 13 11.5 10" ${line()}/>` +
  `<path d="M6.6 11.6 V13.6 Q8 14.8 9.4 13.6 V11.6" fill="#ff7a8a" stroke="${INK}" stroke-width="0.8"/>`;
const blush =
  `<circle cx="3.2" cy="9.6" r="1.2" fill="#ff8a8a" opacity="0.7"/>` +
  `<circle cx="12.8" cy="9.6" r="1.2" fill="#ff8a8a" opacity="0.7"/>`;
const tear = `<path d="M4.6 8 Q3.6 9.6 4.6 10.2 Q5.6 9.6 4.6 8 Z" fill="#4aa3ff"/>`;
const sweat = `<path d="M13.4 2.4 Q12.2 4.2 13.4 4.8 Q14.6 4.2 13.4 2.4 Z" fill="#4aa3ff"/>`;
const sparkle = `<path d="M8 0.8 V3.2 M6.8 2 H9.2" ${line(0.9)}/>`;
const zed = `<path d="M12 1.5 H14.5 L12 4 H14.5" ${line(0.9)}/>`;
const question = `<path d="M12.3 2.6 Q12.3 1 13.7 1 Q15 1 15 2.2 Q15 3 13.8 3.6 V4.4" ${line(0.9)}/>`;

type Face = { fill: string; parts: string[] };

const FACES: Record<MoodIcon, Face> = {
  happy: { fill: "#ffd84a", parts: [dots, smile] },
  sad: { fill: "#ffd84a", parts: [dots, frown, tear] },
  excited: { fill: "#ffd84a", parts: [wide, grin] },
  tired: { fill: "#e6cf8a", parts: [dots, browsFlat, flat] },
  angry: { fill: "#ff9a6a", parts: [dots, browsAngry, frown] },
  chill: { fill: "#ffd84a", parts: [shades, smile] },
  "in-love": { fill: "#ffd84a", parts: [hearts, smile, blush] },
  sick: { fill: "#b9e07a", parts: [dots, wavy] },
  bored: { fill: "#ffd84a", parts: [flatEyes, flat] },
  curious: { fill: "#ffd84a", parts: [dots, browsFlat, small, question] },
  creative: { fill: "#ffd84a", parts: [lookUp, smile, sparkle] },
  nostalgic: { fill: "#f0d9a0", parts: [arcsUp, smile] },
  hyper: { fill: "#ffd84a", parts: [wide, open] },
  sleepy: { fill: "#d6e4f7", parts: [arcsDown, small, zed] },
  silly: { fill: "#ffd84a", parts: [crossEyes, tongue] },
  grumpy: { fill: "#ffc27a", parts: [dots, browsAngry, flat] },
  hopeful: { fill: "#ffd84a", parts: [wide, smile] },
  stressed: { fill: "#ffd84a", parts: [wide, zigzag, sweat] },
  proud: { fill: "#ffd84a", parts: [arcsUp, grin, blush] },
  confused: { fill: "#ffd84a", parts: [dots, wavy, question] },
};

/** The inner markup of one face, for a 16 by 16 viewBox. */
export function moodSvgInner(icon: MoodIcon): string {
  const face = FACES[icon];
  return `<circle cx="8" cy="8" r="7" fill="${face.fill}" stroke="${INK}" stroke-width="0.8"/>${face.parts.map((p) => `<g>${p}</g>`).join("")}`;
}

/** A complete decorative <svg> for the face. `icon` must be one of MOOD_ICONS. */
export function moodSvg(icon: MoodIcon, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" data-mood-icon="${icon}" aria-hidden="true" style="vertical-align:middle">${moodSvgInner(icon)}</svg>`;
}

export function moodLabel(icon: MoodIcon): string {
  return icon.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
