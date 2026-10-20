"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { BRIDGE_RESET_MS, BridgeGate } from "@/lib/bridgeGate";
import { findReportableTrack, type ProfileTrack } from "@/lib/reportableTrack";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { PROFILE_ACTIONS, type DialogAction } from "./profileActions";
import { ProfileFrame } from "./ProfileFrame";
import { stripButtons } from "./stripActions";
import { TrustedStrip } from "./TrustedStrip";

/** Trusted strip, sandboxed profile frame and the confirm dialog they share. */
export function ProfileView({
  username,
  displayName,
  tracks,
}: {
  username: string;
  displayName: string;
  /** This profile's tracks from getPublicProfile, at most 10. */
  tracks: readonly ProfileTrack[];
}) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [throttled, setThrottled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const nextId = useRef(1);
  const open = useRef<{ action: DialogAction; fromBridge: boolean } | null>(null);
  const gate = useRef(new BridgeGate());
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recordView = useMutation(api.profiles.recordView);
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (viewed.current === username) return;
    viewed.current = username;
    void recordView({ username }).catch(() => {});
  }, [username, recordView]);

  const rel = useQuery(api.social.relationship, { username });
  const isHouse = useQuery(api.social.isHouseProfile, { username }) ?? false;
  const buttons = stripButtons(rel, isHouse);

  const show = useCallback((action: DialogAction, fromBridge: boolean, track?: ProfileTrack) => {
    open.current = { action, fromBridge };
    setRequest({ id: nextId.current++, action, ...(track ? { track } : {}) });
  }, []);

  const onStripAction = useCallback(
    (action: DialogAction) => {
      gate.current.reset();
      clearTimeout(noteTimer.current);
      setThrottled(false);
      if (!open.current) show(action, false);
    },
    [show],
  );

  // A request from the frame never replaces an open dialog, so artist code
  // cannot swap what the visitor is about to confirm.
  const onBridgeAction = useCallback(
    (action: DialogAction, track?: ProfileTrack) => {
      if (open.current) return;
      const verdict = gate.current.check(Date.now());
      if (verdict === "cooldown") return;
      if (verdict === "throttled") {
        // Say so in the strip rather than dropping the request silently.
        setThrottled(true);
        clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setThrottled(false), BRIDGE_RESET_MS);
        return;
      }
      setThrottled(false);
      show(action, true, track);
    },
    [show],
  );

  // Only ids in the server's list for this profile open a dialog, with the
  // server's title. Anything else is dropped before the gate sees it.
  const onReportTrack = useCallback(
    (trackId: string) => {
      const track = findReportableTrack(tracks, trackId);
      if (track) onBridgeAction("reportTrack", track);
    },
    [tracks, onBridgeAction],
  );

  const onClose = useCallback((outcome: "cancelled" | "done") => {
    const closing = open.current;
    open.current = null;
    if (closing) {
      gate.current.closed(Date.now(), {
        fromBridge: closing.fromBridge,
        // Coming-soon dialogs have nothing to run and never count.
        counts: PROFILE_ACTIONS[closing.action].run !== undefined,
        outcome,
      });
    }
    setRequest(null);
  }, []);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const target = { username, displayName };
  return (
    <>
      <TrustedStrip displayName={displayName} buttons={buttons} onAction={onStripAction} throttled={throttled} />
      <ProfileFrame
        username={username}
        displayName={displayName}
        onAction={onBridgeAction}
        onReportTrack={onReportTrack}
        reloadKey={reloadKey}
      />
      <ConfirmDialog
        request={request}
        target={target}
        onClose={onClose}
        onResult={(action, result) => {
          if (result.ok && action === "addComment") setReloadKey((k) => k + 1);
        }}
      />
    </>
  );
}
