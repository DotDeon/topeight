import { ONLINE_ICON_INNER, ONLINE_NOW_TEXT } from "@/lib/onlineBadge";
import styles from "./OnlineNow.module.css";

/** The small orange "Online Now!" badge. Render it only for members who are online. */
export function OnlineNow() {
  return (
    <span className={styles.badge}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: ONLINE_ICON_INNER }}
      />
      {ONLINE_NOW_TEXT}
    </span>
  );
}
