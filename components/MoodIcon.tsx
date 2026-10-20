import type { MoodIcon as MoodIconId } from "@/lib/moods";
import { moodLabel, moodSvgInner } from "@/lib/moodSvg";

export { moodLabel };

/**
 * One of the 20 mood faces, drawn as inline SVG from lib/moodSvg.ts (the same
 * markup the profile renderer uses). Decorative unless `title` is given, so put
 * the mood text next to it.
 */
export function MoodIcon({ icon, title, size = 16 }: { icon: MoodIconId; title?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      data-mood-icon={icon}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      style={{ verticalAlign: "middle" }}
      dangerouslySetInnerHTML={{ __html: moodSvgInner(icon) }}
    />
  );
}
