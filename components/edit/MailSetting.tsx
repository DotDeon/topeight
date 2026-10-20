"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { StatusLine, useSaver } from "./shared";

/** Who may send this member mail. Saves when the choice changes. */
export function MailSetting({ mailFrom }: { mailFrom: "friends" | "anyone" | undefined }) {
  const setMailFrom = useMutation(api.mail.setMailFrom);
  const { status, busy, run } = useSaver();
  const [value, setValue] = useState<"friends" | "anyone">(mailFrom ?? "friends");
  return (
    <Box title="Mail" color="blue">
      <div className={styles.row}>
        <label htmlFor="mail-from">Who can send me messages</label>
        <div className={styles.val}>
          <select
            id="mail-from"
            value={value}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value === "anyone" ? "anyone" : "friends";
              setValue(next);
              void run(() => setMailFrom({ value: next }));
            }}
          >
            <option value="friends">Friends only</option>
            <option value="anyone">Anyone</option>
          </select>{" "}
          <StatusLine status={status} />
        </div>
      </div>
    </Box>
  );
}
