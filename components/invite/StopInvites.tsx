"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { Box } from "@/components/Box";
import { api } from "@/convex/_generated/api";
import styles from "./Invite.module.css";

/** A button, not an automatic opt-out, so link scanners that open the page change nothing. */
export function StopInvites({ token }: { token: string }) {
  const optOut = useMutation(api.invites.optOut);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function stop() {
    setState("busy");
    try {
      await optOut({ token });
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <Box title="Stop Invites">
      {state === "done" ? (
        <p data-invite-stopped="">Done. TopEight won&apos;t send invites to this address again.</p>
      ) : token === "" ? (
        <p className={styles.muted}>This link is missing its code. Use the link from your invite email.</p>
      ) : (
        <>
          <p className={styles.intro}>Click below and TopEight will never send another invite to this email address.</p>
          <button type="button" onClick={() => void stop()} disabled={state === "busy"}>
            Stop invites
          </button>
          {state === "error" && (
            <span className={styles.error} role="alert">
              Something went wrong. Try again.
            </span>
          )}
        </>
      )}
    </Box>
  );
}
