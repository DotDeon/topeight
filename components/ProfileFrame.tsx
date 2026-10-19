"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clampFrameHeight, navigatePath, parseBridgeMessage } from "@/lib/bridge";
import type { BridgeAction } from "@/lib/bridge-protocol";

const INITIAL_HEIGHT = 900;

/**
 * The profile document from the usercontent origin. The sandbox has no
 * allow-same-origin, so artist code runs in an opaque origin with no cookies
 * or storage and reaches this page only through checked postMessage calls.
 */
export function ProfileFrame({
  username,
  displayName,
  onAction,
  reloadKey = 0,
}: {
  username: string;
  displayName: string;
  onAction: (action: BridgeAction) => void;
  /** Bump this to load the profile document again, for example after a new comment. */
  reloadKey?: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const router = useRouter();
  const src = `${process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN}/${username}`;

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = parseBridgeMessage(ev, ref.current?.contentWindow);
      if (!msg) return;
      if (msg.type === "openspace:resize") setHeight(clampFrameHeight(msg.height));
      else if (msg.type === "openspace:navigate") router.push(navigatePath(msg));
      else onAction(msg.action);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, onAction]);

  // The frame posts its height once on load and then only on change, so it
  // must not load before the listener above exists. The server markup has no
  // src; it is set here, after hydration.
  useEffect(() => {
    if (ref.current && ref.current.src !== src) ref.current.src = src;
  }, [src]);

  useEffect(() => {
    if (reloadKey > 0 && ref.current) ref.current.src = src;
  }, [reloadKey, src]);

  return (
    <iframe
      ref={ref}
      title={`${displayName}'s profile`}
      data-openspace-profile=""
      sandbox="allow-scripts allow-popups"
      allow="autoplay"
      referrerPolicy="no-referrer"
      // The profile document is 800px wide, the full site width; .site-main pads by 8px.
      style={{ display: "block", width: "calc(100% + 16px)", margin: "0 -8px", height, border: 0 }}
    />
  );
}
