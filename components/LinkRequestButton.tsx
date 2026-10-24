"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import styles from "./TrustedStrip.module.css";

const LABELS = {
  venue: { ask: "Add to our roster", sent: "Request sent", done: "On our roster" },
  label: { ask: "Add to our label", sent: "Request sent", done: "On our label" },
} as const;

/**
 * For a venue or label looking at an artist's page: asks the artist onto the
 * roster or label. Renders nothing for anyone else.
 */
export function LinkRequestButton({ username }: { username: string }) {
  const status = useQuery(api.links.status, { username });
  const profileId = useQuery(api.social.profileIdByUsername, status ? { username } : "skip");
  const request = useMutation(api.links.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!status) return null;
  const text = LABELS[status.type];
  const label = status.state === "accepted" ? text.done : status.state === "none" ? text.ask : text.sent;

  async function ask(artist: Id<"profiles">) {
    setBusy(true);
    setError("");
    try {
      await request({ artist });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.btn}
        data-topeight-link-request=""
        disabled={busy || status.state !== "none" || !profileId}
        onClick={() => profileId && void ask(profileId)}
      >
        {label}
      </button>
      {error && (
        <span className={styles.note} role="alert">
          {error}
        </span>
      )}
    </>
  );
}
