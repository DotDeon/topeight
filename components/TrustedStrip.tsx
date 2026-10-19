"use client";

import type { BridgeAction } from "@/lib/bridge-protocol";
import { PROFILE_ACTIONS, STRIP_ACTIONS } from "./profileActions";
import styles from "./TrustedStrip.module.css";

/**
 * OpenSpace's own controls for a profile, outside the artist's iframe. These
 * always work, whatever the artist's code does inside the frame.
 */
export function TrustedStrip({
  displayName,
  onAction,
  throttled,
}: {
  displayName: string;
  onAction: (action: BridgeAction) => void;
  /** The frame hit the bridge throttle; its requests are being ignored. */
  throttled: boolean;
}) {
  return (
    <div className={styles.strip} data-openspace-strip="" role="toolbar" aria-label={`OpenSpace controls for ${displayName}`}>
      <span className={styles.name}>{displayName}</span>
      {throttled && (
        <span className={styles.note} role="status" data-openspace-throttled="">
          This profile is sending too many requests
        </span>
      )}
      <span className={styles.actions}>
        {STRIP_ACTIONS.map((action) => (
          <button key={action} type="button" className={styles.btn} onClick={() => onAction(action)}>
            {PROFILE_ACTIONS[action].label}
          </button>
        ))}
      </span>
    </div>
  );
}
