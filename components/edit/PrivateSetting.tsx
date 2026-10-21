"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import { StatusLine, useSaver } from "./shared";

/** Fans only: strangers get the private card instead of the full page. Artists' pages are always public. */
export function PrivateSetting({ isPrivate }: { isPrivate: boolean | undefined }) {
  const setPrivate = useMutation(api.profiles.setPrivate);
  const { status, run } = useSaver();
  return (
    <Box title="Privacy" color="orange">
      <label>
        <input
          type="checkbox"
          checked={isPrivate === true}
          onChange={(e) => void run(() => setPrivate({ value: e.target.checked }), "Saved")}
        />{" "}
        Private profile: only my friends see my full page
      </label>{" "}
      <StatusLine status={status} />
    </Box>
  );
}
