"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { StatusLine, useSaver } from "./shared";

const SLOTS = 8;

type Friend = { id: Id<"profiles">; card: { displayName: string; username: string } };

function Slots({ friends, initial }: { friends: Friend[]; initial: Id<"profiles">[] }) {
  const setTop8 = useMutation(api.social.setTop8);
  const { status, busy, run } = useSaver();
  const known = new Set(friends.map((f) => f.id));
  const [picked, setPicked] = useState<string[]>(() => {
    const start = initial.filter((id) => known.has(id)).slice(0, SLOTS) as string[];
    return [...start, ...Array<string>(SLOTS - start.length).fill("")];
  });

  function change(slot: number, value: string) {
    setPicked((p) => p.map((x, i) => (i === slot ? value : x)));
  }

  return (
    <form
      aria-label="Top 8"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => setTop8({ ids: picked.filter(Boolean) as Id<"profiles">[] }));
      }}
    >
      {picked.map((value, slot) => (
        <div className={styles.row} key={slot}>
          <label htmlFor={`top8-${slot}`}>Slot {slot + 1}</label>
          <div className={styles.val}>
            <select id={`top8-${slot}`} value={value} onChange={(e) => change(slot, e.target.value)}>
              <option value="">(empty)</option>
              {friends.map((f) => (
                <option key={f.id} value={f.id} disabled={picked.includes(f.id) && value !== f.id}>
                  {f.card.displayName} (@{f.card.username})
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>Save Top 8</button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

export function Top8Picker({ top8 }: { top8: Id<"profiles">[] }) {
  const friends = useQuery(api.social.myFriendsForTop8, {});
  return (
    <Box title="Top 8" color="orange">
      {friends === undefined ? (
        <p className={styles.note}>Loading...</p>
      ) : friends.length === 0 ? (
        <p className={styles.note}>Add some friends first, then pick your Top 8 here.</p>
      ) : (
        <Slots friends={friends} initial={top8} />
      )}
    </Box>
  );
}
