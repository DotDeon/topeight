"use client";

import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Edit.module.css";

export function errorText(e: unknown): string {
  if (e instanceof ConvexError && typeof e.data === "string") return e.data;
  if (e instanceof Error && e.message && !e.message.includes("Server Error")) return e.message;
  return "Something went wrong.";
}

export type Status = { kind: "idle" } | { kind: "saved"; text: string } | { kind: "error"; text: string };

/** Runs an action and tracks its busy flag and its "Saved" or error line. */
export function useSaver() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<unknown>, savedText = "Saved") => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      await action();
      setStatus({ kind: "saved", text: savedText });
    } catch (e) {
      setStatus({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }, []);
  return { status, setStatus, busy, run };
}

export function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  return (
    <span className={status.kind === "saved" ? styles.saved : styles.error} role={status.kind === "saved" ? "status" : "alert"}>
      {status.text}
    </span>
  );
}

export const UPLOAD_WAIT_MS = 30_000;

/**
 * After an upload resolves the server still checks the file, and a rejected
 * file is only logged there. So watch a reactive value (the photo key, the
 * track count): if it has not changed within 30 s, report the rejection.
 */
export function useUploadWatch<T>(signal: T) {
  const [waiting, setWaiting] = useState<{ from: T } | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const arrived = waiting !== null && signal !== waiting.from;
  useEffect(() => {
    if (arrived) {
      clearTimeout(timer.current);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the new item showing up ends the wait
      setWaiting(null);
    }
  }, [arrived]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Snapshot before the upload starts: the server can accept the file before the hook resolves.
  const begin = useCallback(() => {
    clearTimeout(timer.current);
    setFailed(false);
    setWaiting({ from: signal });
  }, [signal]);
  // The file is in R2. If nothing new shows up within 30 s, the server rejected it.
  const uploaded = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setWaiting(null);
      setFailed(true);
    }, UPLOAD_WAIT_MS);
  }, []);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    setWaiting(null);
  }, []);

  return { begin, uploaded, cancel, checking: waiting !== null && !arrived, arrived, failed, clearFailed: () => setFailed(false) };
}
