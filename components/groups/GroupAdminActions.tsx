"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import styles from "../Posts.module.css";

/** Admin only: Restore (for a deleted or hidden group) and Set owner. The server checks the admin role. */
export function GroupAdminActions({
  groupId,
  deleted,
  hidden,
}: {
  groupId: Id<"groups">;
  deleted: boolean;
  hidden: boolean;
}) {
  const restoreGroup = useMutation(api.moderation.restoreGroup);
  const setGroupOwner = useMutation(api.moderation.setGroupOwner);
  const inputId = useId();
  const [newOwner, setNewOwner] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (p: Promise<null>, done: string) => {
    setStatus(null);
    p.then(
      () => setStatus({ ok: true, text: done }),
      (e) => setStatus({ ok: false, text: errorText(e) }),
    );
  };
  return (
    <p data-group-admin="">
      {(deleted || hidden) && (
        <>
          <button type="button" onClick={() => run(restoreGroup({ groupId }), "Restored.")}>
            Restore group
          </button>{" "}
        </>
      )}
      <label htmlFor={inputId}>New owner (username):</label>{" "}
      <input id={inputId} value={newOwner} maxLength={20} onChange={(e) => setNewOwner(e.target.value)} />{" "}
      <button
        type="button"
        disabled={newOwner.trim() === ""}
        onClick={() => {
          const name = newOwner.trim();
          run(setGroupOwner({ groupId, username: name }), `${name} is the new owner.`);
          setNewOwner("");
        }}
      >
        Set owner
      </button>
      {status && (
        <span className={status.ok ? styles.muted : styles.error} role={status.ok ? "status" : "alert"}>
          {" "}
          {status.text}
        </span>
      )}
    </p>
  );
}
