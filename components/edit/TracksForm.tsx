"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TRACK_MAX_BYTES, TRACK_TITLE_MAX } from "@/convex/lib/media";
import { useMediaUpload } from "../useMediaUpload";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { errorText, StatusLine, useSaver, useUploadWatch } from "./shared";

type Track = { id: Id<"tracks">; title: string; autoplay: boolean };

function TrackRow({
  track,
  index,
  count,
  move,
  onError,
}: {
  track: Track;
  index: number;
  count: number;
  move: (from: number, to: number) => void;
  onError: (message: string) => void;
}) {
  const rename = useMutation(api.media.renameTrack);
  const setAutoplay = useMutation(api.media.setAutoplay);
  const remove = useMutation(api.media.deleteTrack);
  const [title, setTitle] = useState(track.title);
  const guard = (p: Promise<unknown>) => p.then(() => onError(""), (e) => onError(errorText(e)));
  return (
    <li data-track="">
      <button type="button" aria-label={`Move ${track.title} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
        &uarr;
      </button>
      <button type="button" aria-label={`Move ${track.title} down`} disabled={index === count - 1} onClick={() => move(index, index + 1)}>
        &darr;
      </button>
      <input type="text" aria-label={`Title of ${track.title}`} value={title} maxLength={TRACK_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      <button type="button" disabled={title.trim() === track.title} onClick={() => void guard(rename({ trackId: track.id, title }))}>
        Rename
      </button>
      <label>
        <input type="radio" name="autoplay" checked={track.autoplay} onChange={() => void guard(setAutoplay({ trackId: track.id }))} /> Autoplay
      </label>
      <button
        type="button"
        onClick={() => {
          if (confirm(`Delete "${track.title}"?`)) void guard(remove({ trackId: track.id }));
        }}
      >
        Delete
      </button>
    </li>
  );
}

export function TracksForm() {
  const tracks = useQuery(api.media.myTracks, {});
  const reorder = useMutation(api.media.reorderTracks);
  const upload = useMediaUpload();
  const watch = useUploadWatch(tracks?.length);
  const { status, busy, run } = useSaver();
  const [rowError, setRowError] = useState("");
  const [title, setTitle] = useState("");
  const [converting, setConverting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const original = input.current?.files?.[0];
    if (!original) return;
    watch.begin();
    await run(async () => {
      try {
        // Only a 128 kbps copy is uploaded. The encoder loads here, not with the page.
        setConverting(true);
        let file: File;
        let tooLong: string;
        try {
          const transcode = await import("@/lib/transcode");
          tooLong = transcode.TOO_LONG;
          file = await transcode.transcodeToMp3_128(original);
        } finally {
          setConverting(false);
        }
        if (file.size > TRACK_MAX_BYTES) throw new Error(tooLong);
        await upload(file, { purpose: "track", title });
        watch.uploaded();
      } catch (err) {
        watch.cancel();
        throw err;
      }
    }, "Uploaded, checking your file...");
    setTitle("");
    if (input.current) input.current.value = "";
  }

  function move(from: number, to: number) {
    if (!tracks) return;
    const ids = tracks.map((t) => t.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder({ ids }).then(() => setRowError(""), (e) => setRowError(errorText(e)));
  }

  return (
    <Box title="Music" color="orange">
      <p className={styles.note}>MP3 only, up to 5 MB, 10 tracks max</p>
      {tracks === undefined ? (
        <p className={styles.note}>Loading...</p>
      ) : tracks.length === 0 ? (
        <p className={styles.note}>No tracks yet.</p>
      ) : (
        <ul className={styles.list}>
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} count={tracks.length} move={move} onError={setRowError} />
          ))}
        </ul>
      )}
      {rowError && <p className={styles.error} role="alert">{rowError}</p>}
      <form onSubmit={onSubmit} aria-label="Upload track">
        <div className={styles.row}>
          <label htmlFor="track-title">Title</label>
          <div className={styles.val}>
            <input id="track-title" type="text" value={title} maxLength={TRACK_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required />
          </div>
        </div>
        <div className={styles.row}>
          <label htmlFor="track-file">MP3 file</label>
          <div className={styles.val}>
            <input id="track-file" ref={input} type="file" accept="audio/mpeg,.mp3" required />
          </div>
        </div>
        <div className={styles.actions}>
          <button type="submit" disabled={busy || watch.checking}>Upload Track</button>
          {converting && <span className={styles.note} role="status">Converting to 128 kbps…</span>}
          <StatusLine status={status} />
          {watch.arrived && <span className={styles.saved} role="status">Saved</span>}
          {watch.failed && <span className={styles.error} role="alert">Upload failed: file was rejected</span>}
        </div>
      </form>
    </Box>
  );
}
