"use client";

import type { DialogAction } from "./profileActions";
import type { StripButton } from "./stripActions";
import styles from "./TrustedStrip.module.css";

/**
 * TopEight's own controls for a profile, outside the artist's iframe. These
 * always work, whatever the artist's code does inside the frame.
 */
export function TrustedStrip({
  displayName,
  buttons,
  onAction,
  throttled,
}: {
  displayName: string;
  buttons: readonly StripButton[];
  onAction: (action: DialogAction) => void;
  /** The frame hit the bridge throttle; its requests are being ignored. */
  throttled: boolean;
}) {
  return (
    <div className={styles.strip} data-topeight-strip="" role="toolbar" aria-label={`TopEight controls for ${displayName}`}>
      <span className={styles.name}>{displayName}</span>
      {throttled && (
        <span className={styles.note} role="status" data-topeight-throttled="">
          This profile is sending too many requests
        </span>
      )}
      <span className={styles.actions}>
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            className={styles.btn}
            disabled={b.disabled}
            onClick={() => onAction(b.action)}
          >
            {b.label}
          </button>
        ))}
      </span>
    </div>
  );
}
