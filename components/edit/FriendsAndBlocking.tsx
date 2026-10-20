"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { errorText } from "./shared";

type Person = { id: Id<"profiles">; card: { displayName: string; username: string; photoUrl: string | null } };

function PersonList({
  people,
  empty,
  action,
  onAction,
  hideAction,
  label,
}: {
  people: Array<Person & { isHouse?: boolean }>;
  empty: string;
  action: string;
  onAction: (p: Person) => Promise<void>;
  hideAction?: (p: Person & { isHouse?: boolean }) => boolean;
  label: string;
}) {
  const [busy, setBusy] = useState<Id<"profiles"> | null>(null);
  const [error, setError] = useState("");

  async function go(p: Person) {
    setBusy(p.id);
    setError("");
    try {
      await onAction(p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div aria-label={label} role="group">
      {error !== "" && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {people.length === 0 ? (
        <p className={styles.note}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {people.map((p) => (
            <li key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small avatar from the media host */}
              {p.card.photoUrl ? <img className={styles.person} src={p.card.photoUrl} alt="" /> : <span className={styles.person} />}
              <span className={styles.personName}>
                {p.card.displayName} (@{p.card.username})
              </span>
              {!hideAction?.(p) && (
                <button type="button" disabled={busy !== null} onClick={() => void go(p)}>
                  {action}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lists friends and blocked people, each with a button to undo it. */
export function FriendsAndBlocking() {
  const friends = useQuery(api.social.myFriendsForTop8, {});
  const blocked = useQuery(api.social.myBlocked, {});
  const removeFriend = useMutation(api.social.removeFriend);
  const unblock = useMutation(api.social.unblock);
  return (
    <Box title="Friends and blocking" color="blue">
      <h3 className={styles.title}>Friends</h3>
      {friends === undefined ? (
        <p className={styles.note}>Loading...</p>
      ) : (
        <PersonList
          label="Friends"
          people={friends}
          empty="No friends yet"
          action="Remove"
          hideAction={(p) => p.isHouse === true}
          onAction={async (p) => {
            if (!confirm(`Remove ${p.card.displayName} from your friends?`)) return;
            await removeFriend({ other: p.id });
          }}
        />
      )}
      <h3 className={styles.title}>People you&apos;ve blocked</h3>
      {blocked === undefined ? (
        <p className={styles.note}>Loading...</p>
      ) : (
        <PersonList
          label="Blocked"
          people={blocked}
          empty="You haven't blocked anyone"
          action="Unblock"
          onAction={async (p) => {
            await unblock({ other: p.id });
          }}
        />
      )}
    </Box>
  );
}
