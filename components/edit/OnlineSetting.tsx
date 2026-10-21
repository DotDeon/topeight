"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import { StatusLine, useSaver } from "./shared";

/** Lets a member hide the Online Now! badge. Turning it off also stops storing when they were last seen. */
export function OnlineSetting({ showOnline }: { showOnline: boolean | undefined }) {
  const setShowOnline = useMutation(api.presence.setShowOnline);
  const { status, run } = useSaver();
  return (
    <Box title="Online Now!" color="orange">
      <label>
        <input
          type="checkbox"
          checked={showOnline !== false}
          onChange={(e) => void run(() => setShowOnline({ value: e.target.checked }), "Saved")}
        />{" "}
        Show when I&apos;m online
      </label>{" "}
      <StatusLine status={status} />
    </Box>
  );
}
