"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const TOUCHED_KEY = "openspace:touchedLogin";

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

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      <TouchLogin />
      {children}
    </ConvexAuthNextjsProvider>
  );
}
