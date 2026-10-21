"use client";

import { useAction, useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { clampFrameHeight, navigatePath, parseBridgeMessage } from "@/lib/bridge";
import type { BridgeAction } from "@/lib/bridge-protocol";

const INITIAL_HEIGHT = 900;
/** How long the frame waits to learn whether the visitor is on their own page. */
export const VIEWER_WAIT_MS = 3000;

/** The frame's address. Public profiles get none of the optional parameters, so the plain address stays the same. */
export function frameSrc(origin: string | undefined, username: string, opts: { own?: boolean; pass?: string }): string {
  const params = new URLSearchParams();
  if (opts.own) params.set("own", "1");
  if (opts.pass) params.set("pass", opts.pass);
  const query = params.toString();
  return `${origin}/${username}${query ? `?${query}` : ""}`;
}

/** Loads `src`, handing focus back to the page so the next click into the frame registers as entering it. */
function loadFrame(frame: HTMLIFrameElement, src: string, entered: { current: boolean }) {
  entered.current = false;
  if (document.activeElement === frame) frame.blur();
  frame.src = src;
}

/**
 * The profile document from the usercontent origin. The sandbox has no
 * allow-same-origin, so artist code runs in an opaque origin with no cookies
 * or storage and reaches this page only through checked postMessage calls.
 *
 * A private profile's document needs a frame pass in its address
 * (convex/framePass.ts). The usercontent origin can't see who is signed in, so
 * this asks for one with the viewer's login first, and shows `noPass` instead
 * of the frame when the server won't give one.
 */
export function ProfileFrame({
  username,
  displayName,
  onAction,
  onReportTrack,
  onPickSong,
  onPlayVideo,
  hidePick,
  reloadKey = 0,
  needsPass = false,
  noPass,
}: {
  username: string;
  displayName: string;
  onAction: (action: BridgeAction) => void;
  /** A track id the frame asked to report. Unchecked: the parent must look it up itself. */
  onReportTrack: (trackId: string) => void;
  /** A track id the frame asked to use as the visitor's profile song. Unchecked, like onReportTrack. */
  onPickSong: (trackId: string) => void;
  /** A YouTube id the frame asked to play. Checked against YOUTUBE_ID_PATTERN; the parent decides whether to open it. */
  onPlayVideo: (videoId: string) => void;
  /** True when the visitor is on their own page, so the frame leaves the pick links off. Undefined until known. */
  hidePick: boolean | undefined;
  /** Bump this to load the profile document again, for example after a new comment. */
  reloadKey?: number;
  /** The profile is private: load the frame only with a frame pass. */
  needsPass?: boolean;
  /** Shown instead of the frame when the server gives no pass. */
  noPass?: ReactNode;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const router = useRouter();
  // If the viewer lookup hasn't answered in time (a dead websocket), load anyway with the links visible.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (hidePick !== undefined) return;
    const timer = setTimeout(() => setGaveUp(true), VIEWER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [hidePick]);

  // A fresh pass for each load, so a reload after a comment never uses an expired one.
  // undefined while it is on its way, null when refused, "error" when the call failed.
  // The pass depends on who is asking, so wait until the client has the login.
  const issue = useAction(api.framePass.issue);
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const [pass, setPass] = useState<{ username: string; value: string | null | "error" } | undefined>();
  useEffect(() => {
    if (!needsPass || authLoading) return;
    let live = true;
    issue({ username }).then(
      (value) => live && setPass({ username, value }),
      () => live && setPass({ username, value: "error" }),
    );
    return () => {
      live = false;
    };
  }, [needsPass, authLoading, isAuthenticated, username, reloadKey, issue]);
  // A pass is for one profile. On a reload the old one stays in use until the new one is in.
  const current = pass?.username === username ? pass.value : undefined;
  const passValue = needsPass ? (current === null || current === "error" ? undefined : current) : undefined;
  const src = frameSrc(process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN, username, { own: hidePick, pass: passValue });

  // Whether the visitor has moved focus into this frame (clicked or tabbed into it)
  // since it last loaded. A video request needs that, so a profile can't open one
  // on arrival off the back of the click that brought the visitor there.
  const entered = useRef(false);
  useEffect(() => {
    function onBlur() {
      // Focus moves to the iframe element after the window's blur event.
      setTimeout(() => {
        if (document.activeElement === ref.current) entered.current = true;
      }, 0);
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = parseBridgeMessage(ev, ref.current?.contentWindow);
      if (!msg) return;
      if (msg.type === "topeight:resize") setHeight(clampFrameHeight(msg.height));
      else if (msg.type === "topeight:navigate") router.push(navigatePath(msg));
      else if (msg.type === "topeight:reportTrack") onReportTrack(msg.trackId);
      else if (msg.type === "topeight:pickSong") onPickSong(msg.trackId);
      else if (msg.type === "topeight:playVideo") {
        if (entered.current && document.activeElement === ref.current) onPlayVideo(msg.videoId);
      }
      else onAction(msg.action);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, onAction, onReportTrack, onPickSong, onPlayVideo]);

  // The frame posts its height once on load and then only on change, so it
  // must not load before the listener above exists. The server markup has no
  // src; it is set here, after hydration.
  useEffect(() => {
    // Wait until we know whether the visitor is on their own page, so the frame loads once.
    if (hidePick === undefined && !gaveUp) return;
    if (needsPass && passValue === undefined) return;
    if (ref.current && ref.current.src !== src) loadFrame(ref.current, src, entered);
  }, [src, hidePick, gaveUp, needsPass, passValue]);

  // Private profiles reload through the fresh pass above, which changes src.
  useEffect(() => {
    if (reloadKey > 0 && !needsPass && ref.current) loadFrame(ref.current, src, entered);
  }, [reloadKey, src, needsPass]);

  if (needsPass && current === null) return <>{noPass}</>;
  if (needsPass && current === "error") return <p role="alert">This profile couldn&apos;t load. Reload the page to try again.</p>;
  if (needsPass && current === undefined) return <p>Loading…</p>;

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
