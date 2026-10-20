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
  onReportTrack,
  onPickSong,
  hidePick,
  reloadKey = 0,
}: {
  username: string;
  displayName: string;
  onAction: (action: BridgeAction) => void;
  /** A track id the frame asked to report. Unchecked: the parent must look it up itself. */
  onReportTrack: (trackId: string) => void;
  /** A track id the frame asked to use as the visitor's profile song. Unchecked, like onReportTrack. */
  onPickSong: (trackId: string) => void;
  /** True when the visitor is on their own page, so the frame leaves the pick links off. Undefined until known. */
  hidePick: boolean | undefined;
  /** Bump this to load the profile document again, for example after a new comment. */
  reloadKey?: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const router = useRouter();
  const src = `${process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN}/${username}${hidePick ? "?own=1" : ""}`;

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = parseBridgeMessage(ev, ref.current?.contentWindow);
      if (!msg) return;
      if (msg.type === "topeight:resize") setHeight(clampFrameHeight(msg.height));
      else if (msg.type === "topeight:navigate") router.push(navigatePath(msg));
      else if (msg.type === "topeight:reportTrack") onReportTrack(msg.trackId);
      else if (msg.type === "topeight:pickSong") onPickSong(msg.trackId);
      else onAction(msg.action);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, onAction, onReportTrack, onPickSong]);

  // The frame posts its height once on load and then only on change, so it
  // must not load before the listener above exists. The server markup has no
  // src; it is set here, after hydration.
  useEffect(() => {
    // Wait until we know whether the visitor is on their own page, so the frame loads once.
    if (hidePick === undefined) return;
    if (ref.current && ref.current.src !== src) ref.current.src = src;
  }, [src, hidePick]);

  useEffect(() => {
    if (reloadKey > 0 && ref.current) ref.current.src = src;
  }, [reloadKey, src]);

  return (
    <iframe
      ref={ref}
      title={`${displayName}'s profile`}
      data-topeight-profile=""
      sandbox="allow-scripts allow-popups"
      allow="autoplay"
      referrerPolicy="no-referrer"
      // The profile document is 800px wide, the full site width; .site-main pads by 8px.
      style={{ display: "block", width: "calc(100% + 16px)", margin: "0 -8px", height, border: 0 }}
    />
  );
}
