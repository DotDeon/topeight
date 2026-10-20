"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Box } from "./Box";

/** Pages a suspended member can still read. */
const OPEN_PATHS = ["/login", "/about", "/terms", "/privacy", "/safety"];

/**
 * Shows the suspension notice instead of the page when the signed-in member is
 * banned. The server already refuses every write and hides the profile, this
 * just tells the member why.
 */
export function SuspendedGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const open = OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // Render nothing until the member's status is known, so a suspended member never sees the page flash.
  if (!open && isAuthenticated && me === undefined) return null;
  if (open || !me?.banned) return <>{children}</>;
  return (
    <Box title="Account Suspended">
      <p>Your account has been suspended</p>
      <p>
        Read the <Link href="/terms">Terms</Link> and <Link href="/safety">Safety Tips</Link>, or{" "}
        <Link href="/about#contact">contact us</Link>.
      </p>
    </Box>
  );
}
