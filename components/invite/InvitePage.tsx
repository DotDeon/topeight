"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Box } from "@/components/Box";
import { api } from "@/convex/_generated/api";
import type { InviteResult } from "@/convex/invites";
import { errorText } from "@/lib/errorText";
import { INVITE_COOLDOWN_DAYS, MAX_INVITE_MESSAGE } from "@/lib/inviteText";
import styles from "./Invite.module.css";

const NOT_SENT: Record<Exclude<InviteResult["status"], "sent">, string> = {
  skipped: `not sent. This address is already on TopEight, asked not to get invites, or was invited in the last ${INVITE_COOLDOWN_DAYS} days.`,
  invalid: "not sent. That doesn't look like an email address.",
  limit: "not sent. You've reached today's invite limit.",
};

function Results({ results }: { results: InviteResult[] }) {
  return (
    <ul className={styles.results} data-invite-results="">
      {results.map((r) =>
        r.status === "sent" ? (
          <li key={r.email} className={styles.sent}>
            {r.email}: sent
          </li>
        ) : (
          <li key={r.email} className={styles.notSent}>
            {r.email}: {NOT_SENT[r.status]}
          </li>
        ),
      )}
    </ul>
  );
}

function InviteForm({ left }: { left: number }) {
  const send = useMutation(api.invites.send);
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<InviteResult[] | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const out = await send({ emails, message });
      setResults(out);
      if (out.some((r) => r.status === "sent")) {
        setEmails("");
        setMessage("");
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={styles.intro}>
        Invite your friends by email. When a friend joins from your invite, you two become friends straight away.
      </p>
      <form onSubmit={onSubmit}>
        <div className={styles.fields}>
          <label htmlFor="invite-to">To:</label>
          <textarea id="invite-to" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} required />
          <p className={styles.hint}>Separate email addresses with commas.</p>
          <label htmlFor="invite-message">Your message:</label>
          <textarea
            id="invite-message"
            rows={5}
            value={message}
            maxLength={MAX_INVITE_MESSAGE}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className={styles.hint}>Optional. No links.</p>
        </div>
        <div className={styles.actions}>
          <button type="submit" disabled={busy || left === 0 || emails.trim() === ""}>
            Send Invite
          </button>
          {error && (
            <span className={styles.error} role="alert">
              {error}
            </span>
          )}
          <p className={styles.muted}>
            {left === 0 ? "You've sent 20 invites in the last 24 hours. Try again tomorrow." : `You can send ${left} more today.`}
          </p>
        </div>
      </form>
      {results && <Results results={results} />}
    </>
  );
}

function History({ invites }: { invites: NonNullable<ReturnType<typeof useMine>>["invites"] }) {
  if (invites.length === 0) return <p className={styles.muted}>You haven&apos;t invited anyone yet.</p>;
  return (
    <table className={styles.table} data-invite-history="">
      <thead>
        <tr>
          <th>Email</th>
          <th>Sent</th>
          <th>Joined</th>
        </tr>
      </thead>
      <tbody>
        {invites.map((i) => (
          <tr key={`${i.email}-${i.sentAt}`}>
            <td>{i.email}</td>
            <td>{new Date(i.sentAt).toLocaleDateString()}</td>
            <td>{i.joined ? <Link href={`/${i.joined.username}`}>{i.joined.displayName}</Link> : "Not yet"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function useMine() {
  return useQuery(api.invites.mine, {});
}

function SignedIn() {
  const mine = useMine();
  if (mine === undefined) return <Box title="Invite Your Friends to TopEight!"><p className={styles.muted}>Loading...</p></Box>;
  if (mine === null) {
    return (
      <Box title="Invite Your Friends to TopEight!">
        <p className={styles.muted}>Finish making your profile to invite friends.</p>
      </Box>
    );
  }
  return (
    <>
      <Box title="Invite Your Friends to TopEight!">
        <InviteForm left={mine.left} />
      </Box>
      <Box title="Your Invites" color="blue">
        <History invites={mine.invites} />
      </Box>
    </>
  );
}

export function InvitePage() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <Box title="Invite Your Friends to TopEight!"><p className={styles.muted}>Loading...</p></Box>;
  if (!isAuthenticated) {
    return (
      <Box title="Invite Your Friends to TopEight!">
        <p className={styles.muted}>
          <Link href="/login">Log in</Link> to invite your friends.
        </p>
      </Box>
    );
  }
  return <SignedIn />;
}
