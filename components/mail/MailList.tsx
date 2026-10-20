"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { mailDate } from "@/lib/mailText";
import { Box } from "../Box";
import styles from "./Mail.module.css";

/**
 * Inbox or sent mail, 25 a page. The queries take a cursor, so Next pushes the
 * returned cursor on a stack and Previous pops it. A page can come back empty
 * with more behind it (hidden senders), so it offers "Load more" then.
 */
export function MailList({ kind }: { kind: "inbox" | "sent" }) {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack[stack.length - 1];
  const inbox = useQuery(api.mail.inbox, kind === "inbox" ? { cursor } : "skip");
  const sent = useQuery(api.mail.sent, kind === "sent" ? { cursor } : "skip");
  const data = kind === "inbox" ? inbox : sent;
  const title = kind === "inbox" ? "Inbox" : "Sent";

  if (data === undefined) {
    return (
      <Box title={title}>
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  const first = stack.length === 1;
  return (
    <Box title={title}>
      {data.page.length === 0 && data.isDone && (
        <p className={styles.muted}>{kind === "inbox" ? "Your inbox is empty." : "You haven't sent any messages."}</p>
      )}
      {data.page.length === 0 && !data.isDone && <p className={styles.muted}>Nothing to show on this page yet.</p>}
      {data.page.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{kind === "inbox" ? "From" : "To"}</th>
              <th>Subject</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {data.page.map((m) => (
              <tr key={m.id} className={m.unread ? styles.unread : undefined} data-mail-row="" data-unread={m.unread ? "true" : "false"}>
                <td>
                  <Link href={`/${m.other.username}`}>{m.other.displayName}</Link>
                </td>
                <td>
                  <Link href={`/mail/${m.id}`}>{m.subject}</Link>
                </td>
                <td>{mailDate(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={styles.pager}>
        {!first && (
          <button type="button" onClick={() => setStack((s) => s.slice(0, -1))}>
            Previous
          </button>
        )}
        {!data.isDone && (
          <button type="button" onClick={() => setStack((s) => [...s, data.continueCursor])}>
            {data.page.length === 0 ? "Load more" : "Next"}
          </button>
        )}
      </div>
    </Box>
  );
}
