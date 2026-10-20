"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const TOUCHED_KEY = "topeight:touchedLogin";

/** Calls touchLogin once per browser session after the user is signed in. */
function TouchLogin() {
  const { isAuthenticated } = useConvexAuth();
  const touchLogin = useMutation(api.profiles.touchLogin);
  useEffect(() => {
    if (!isAuthenticated) {
      sessionStorage.removeItem(TOUCHED_KEY);
      return;
    }
    if (sessionStorage.getItem(TOUCHED_KEY)) return;
    sessionStorage.setItem(TOUCHED_KEY, "1");
    void touchLogin().catch(() => sessionStorage.removeItem(TOUCHED_KEY));
  }, [isAuthenticated, touchLogin]);
  return null;
}

const HEARTBEAT_MS = 2 * 60 * 1000;

/**
 * Tells the server the signed-in member is around: on mount, every 2 minutes
 * while the tab is visible, and when the tab becomes visible again. Failures
 * (no profile yet, offline, rate limited) are ignored.
 */
function PresenceHeartbeat() {
  const { isAuthenticated } = useConvexAuth();
  const heartbeat = useMutation(api.presence.heartbeat);
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  // Wait for the profile; send nothing without one or when Online Now! is off.
  const sharing = me != null && !me.banned && me.showOnline !== false;
  useEffect(() => {
    if (!sharing) return;
    const beat = () => {
      if (document.visibilityState === "visible") void heartbeat().catch(() => {});
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [sharing, heartbeat]);
  return null;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      <TouchLogin />
      <PresenceHeartbeat />
      {children}
    </ConvexAuthNextjsProvider>
  );
}
