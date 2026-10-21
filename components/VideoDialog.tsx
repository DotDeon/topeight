"use client";

import { useEffect, useRef } from "react";
import styles from "./VideoDialog.module.css";

/**
 * Plays a YouTube video the profile frame asked for. YouTube refuses to play
 * inside the frame (its opaque origin sends no referrer: error 153), so the
 * video plays here, in a modal <dialog> on the main origin. The id was checked
 * by parseBridgeMessage; the embed uses youtube-nocookie and nothing else from
 * the frame.
 */
export function VideoDialog({ videoId, onClose }: { videoId: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (videoId && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-dialog-dismiss]")?.focus();
    }
    if (!videoId && dialog.open) dialog.close();
  }, [videoId]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-topeight-video=""
      aria-labelledby="topeight-video-title"
      onClose={onClose}
    >
      {videoId && (
        <>
          <div className={styles.head}>
            <h4 id="topeight-video-title" className={styles.title}>
              Video
            </h4>
            <button type="button" className={styles.btn} onClick={() => ref.current?.close()} data-dialog-dismiss="">
              Close
            </button>
          </div>
          <div className={styles.screen}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`}
              title="YouTube video"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <a
            className={styles.out}
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch on YouTube
          </a>
        </>
      )}
    </dialog>
  );
}
