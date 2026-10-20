"use client";

import { useRef, useState, type FormEvent } from "react";
import { PHOTO_MAX_BYTES } from "@/convex/lib/media";
import { useMediaUpload } from "../useMediaUpload";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { errorOrMessage, useUploadWatch } from "./shared";

export function PhotoForm({ photoUrl, photoKey }: { photoUrl: string | null; photoKey: string | undefined }) {
  const upload = useMediaUpload();
  const watch = useUploadWatch(photoKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const done = watch.arrived && !error;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    watch.clearFailed();
    try {
      watch.begin();
      await upload(file, { purpose: "photo" });
      watch.uploaded();
    } catch (err) {
      watch.cancel();
      setError(errorOrMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box title="Photo" color="blue">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user photos come from an external bucket
        <img className={styles.photo} src={photoUrl} alt="Your profile photo" />
      ) : (
        <div className={styles.noPhoto}>No Photo</div>
      )}
      <form onSubmit={onSubmit} aria-label="Photo">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/gif,image/webp" aria-label="Photo file" />
        <p className={styles.note}>JPEG, PNG, GIF or WebP, up to {PHOTO_MAX_BYTES / (1024 * 1024)} MB.</p>
        <div className={styles.actions}>
          <button type="submit" disabled={busy || watch.checking}>Upload Photo</button>
          {watch.checking && !error && <span>Checking your file...</span>}
          {done && <span className={styles.saved} role="status">Saved</span>}
          {error && <span className={styles.error} role="alert">{error}</span>}
          {watch.failed && !error && (
            <span className={styles.error} role="alert">Upload failed: file was rejected</span>
          )}
        </div>
      </form>
    </Box>
  );
}
