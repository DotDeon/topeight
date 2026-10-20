"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import { PostBody } from "../PostBody";
import { ReportLink } from "../ReportLink";
import styles from "./Mail.module.css";

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** A bad id or a message that is gone makes the query throw. Show "not found" instead of crashing the page. */
export class MailBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Message({ id }: { id: Id<"messages"> }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [error, setError] = useState("");
  const view = useQuery(api.mail.get, gone ? "skip" : { id });
  const markRead = useMutation(api.mail.markRead);
  const remove = useMutation(api.mail.remove);
  const marked = useRef(false);

  const shouldMark = view !== undefined && view.isRecipient && view.unread;
  useEffect(() => {
    if (!shouldMark || marked.current) return;
    marked.current = true;
    void markRead({ id }).catch(() => {});
  }, [shouldMark, markRead, id]);

  async function onDelete() {
    if (!window.confirm("Delete this message?")) return;
    setError("");
    // Skip the query first: once the row is gone it would throw.
    setGone(true);
    try {
      await remove({ id });
      router.push(view?.isRecipient === false ? "/mail/sent" : "/mail");
    } catch (e) {
      setGone(false);
      setError(errorText(e));
    }
  }

  if (view === undefined) {
    return (
      <Box title="Message">
        <p className={styles.muted}>{gone ? "Deleting..." : "Loading..."}</p>
      </Box>
    );
  }
  const other = view.isRecipient ? view.from : view.to;
  return (
    <Box title="Message">
      <div className={styles.head}>
        <span className={styles.key}>{view.isRecipient ? "From:" : "To:"}</span>
        <span className={styles.val}>
          <Link href={`/${other.username}`}>{other.displayName}</Link>
        </span>
        <span className={styles.key}>Date:</span>
        <span className={styles.val}>{when(view.createdAt)}</span>
        <span className={styles.key}>Subject:</span>
        <span className={styles.val} data-mail-subject="">
          {view.subject}
        </span>
      </div>
      <div className={styles.body} data-mail-body="">
        <PostBody body={view.body} />
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {view.isRecipient && view.canReply && (
          <Link href={`/mail/compose?to=${encodeURIComponent(view.from.username)}&replyTo=${view.id}`}>Reply</Link>
        )}
        {view.isRecipient && !view.canReply && <span className={styles.muted}>You can&apos;t reply to this message.</span>}
        <button type="button" onClick={() => void onDelete()}>
          Delete
        </button>
        {view.isRecipient && <ReportLink targetType="message" targetId={view.id} />}
      </div>
    </Box>
  );
}

export function MessageView({ id }: { id: string }) {
  return (
    <MailBoundary
      fallback={
        <Box title="Message">
          <p>Message not found.</p>
        </Box>
      }
    >
      <Message id={id as Id<"messages">} />
    </MailBoundary>
  );
}
