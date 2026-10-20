"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { StatusLine, useSaver } from "./shared";

/** Over this many picks the count reads "1000+". The server counts up to 1001. */
export const USAGE_DISPLAY_MAX = 1000;

/** "1000+" above 1000, else the number. */
export function usageLabel(count: number): string {
  return count > USAGE_DISPLAY_MAX ? `${USAGE_DISPLAY_MAX}+` : String(count);
}

/**
 * The member's profile song with a Remove button, and for artists the switch
 * that lets other members use their songs, with how many profiles do.
 * `hasPick` is true when a pick exists even if the song is unavailable now
 * (track deleted, artist banned or sharing off), so it can still be removed.
 */
export function ProfileSongForm({
  song,
  hasPick,
  loading,
  artist,
  shareSongs,
}: {
  song: { title: string; artist: { displayName: string } } | null;
  hasPick: boolean;
  /** True while the public profile is still loading, so a pick doesn't flash as unavailable. */
  loading: boolean;
  artist: boolean;
  shareSongs: boolean;
}) {
  const clear = useMutation(api.profileSongs.clear);
  const setShare = useMutation(api.profileSongs.setShareSongs);
  const usage = useQuery(api.profileSongs.usageCount, artist ? {} : "skip");
  const remove = useSaver();
  const share = useSaver();
  return (
    <Box title="Profile song" color="orange">
      {song ? (
        <p data-profile-song="">
          <b>{song.title}</b> by {song.artist.displayName}{" "}
          <button type="button" disabled={remove.busy} onClick={() => void remove.run(() => clear({}), "Removed")}>
            Remove
          </button>{" "}
          <StatusLine status={remove.status} />
        </p>
      ) : hasPick && loading ? (
        <p className={styles.note}>Loading...</p>
      ) : hasPick ? (
        <p data-profile-song="">
          Your profile song isn&apos;t available right now.{" "}
          <button type="button" disabled={remove.busy} onClick={() => void remove.run(() => clear({}), "Removed")}>
            Remove
          </button>{" "}
          <StatusLine status={remove.status} />
        </p>
      ) : (
        <p className={styles.note}>
          No profile song yet. Find a band you like and click Add to my profile.
          <StatusLine status={remove.status} />
        </p>
      )}
      {artist && (
        <p>
          <label>
            <input
              type="checkbox"
              checked={shareSongs}
              disabled={share.busy}
              onChange={(e) => void share.run(() => setShare({ value: e.target.checked }), "Saved")}
            />{" "}
            Let people use my songs as profile songs
          </label>{" "}
          <StatusLine status={share.status} />
          <br />
          {usage !== undefined && (
            <span className={styles.note} data-song-usage="">
              Your songs are on {usageLabel(usage)} {usage === 1 ? "profile" : "profiles"}
            </span>
          )}
        </p>
      )}
    </Box>
  );
}
