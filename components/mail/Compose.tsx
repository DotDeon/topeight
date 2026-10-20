"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import { MAX_MESSAGE, MAX_SUBJECT, quoteBody, replySubject } from "@/lib/mailText";
import { validateUsername } from "@/lib/validation";
import { Box } from "../Box";
import { MailBoundary } from "./MessageView";
import styles from "./Mail.module.css";

/** Loads the message being answered and hands its subject and quoted body up, once. */
function ReplySource({ id, onLoad }: { id: Id<"messages">; onLoad: (subject: string, body: string) => void }) {
  const original = useQuery(api.mail.get, { id });
  const done = useRef(false);
  useEffect(() => {
    if (original === undefined || done.current) return;
    done.current = true;
    onLoad(replySubject(original.subject), quoteBody(original.body));
  }, [original, onLoad]);
  return null;
}

/** The compose form. `to` and `replyTo` come from the page's query string. */
export function Compose({ to: initialTo, replyTo }: { to: string; replyTo?: string }) {
  const router = useRouter();
  const send = useMutation(api.mail.send);
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const touched = useRef(false);
  const prefill = useCallback((s: string, b: string) => {
    if (touched.current) return;
    setSubject(s);
    setBody(b);
  }, []);

  const live = to.trim().toLowerCase();
  const name = useDeferredValue(live);
  const checked = name === "" ? null : validateUsername(name);
  const valid = checked?.ok ? checked.username : null;
  const allowed = useQuery(api.mail.canMessage, valid ? { username: valid } : "skip");

  // Send only to the name that was checked: not while the box is ahead of the deferred check.
  const ready = name === live && valid !== null && allowed === true && subject.trim() !== "" && body.trim() !== "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await send({ to: valid, subject, body, ...(replyTo ? { replyTo: replyTo as Id<"messages"> } : {}) });
      router.push("/mail/sent");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Box title="Compose">
      {replyTo && (
        <MailBoundary fallback={null}>
          <ReplySource
            id={replyTo as Id<"messages">}
            onLoad={prefill}
          />
        </MailBoundary>
      )}
      {valid !== null && allowed === false && (
        <p className={styles.refusal} role="alert" data-compose-refusal="">
          You can&apos;t send a message to {valid}. They may only accept messages from friends, or they may not be
          available.
        </p>
      )}
      {checked !== null && !checked.ok && (
        <p className={styles.refusal} role="alert">
          {checked.reason}
        </p>
      )}
      <form onSubmit={onSubmit}>
        <div className={styles.fields}>
          <label htmlFor="mail-to">To:</label>
          <input id="mail-to" type="text" value={to} maxLength={20} autoComplete="off" onChange={(e) => setTo(e.target.value)} />
          <label htmlFor="mail-subject">Subject:</label>
          <input
            id="mail-subject"
            type="text"
            value={subject}
            maxLength={MAX_SUBJECT}
            onChange={(e) => {
              touched.current = true;
              setSubject(e.target.value);
            }}
          />
          <label htmlFor="mail-body">Message:</label>
          <textarea
            id="mail-body"
            rows={12}
            value={body}
            maxLength={MAX_MESSAGE}
            onChange={(e) => {
              touched.current = true;
              setBody(e.target.value);
            }}
          />
        </div>
        <div className={styles.actions}>
          <button type="submit" disabled={busy || !ready}>
            Send
          </button>
          {error && (
            <span className={styles.error} role="alert">
              {error}
            </span>
          )}
        </div>
      </form>
    </Box>
  );
}
