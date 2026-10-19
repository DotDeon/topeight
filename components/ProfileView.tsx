"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { BridgeAction } from "@/lib/bridge-protocol";
import { BRIDGE_RESET_MS, BridgeGate } from "@/lib/bridgeGate";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { PROFILE_ACTIONS } from "./profileActions";
import { ProfileFrame } from "./ProfileFrame";
import { TrustedStrip } from "./TrustedStrip";

/** Trusted strip, sandboxed profile frame and the confirm dialog they share. */
export function ProfileView({ username, displayName }: { username: string; displayName: string }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [throttled, setThrottled] = useState(false);
  const nextId = useRef(1);
  const open = useRef<{ action: BridgeAction; fromBridge: boolean } | null>(null);
  const gate = useRef(new BridgeGate());
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recordView = useMutation(api.profiles.recordView);
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (viewed.current === username) return;
    viewed.current = username;
    void recordView({ username }).catch(() => {});
  }, [username, recordView]);

  const show = useCallback((action: BridgeAction, fromBridge: boolean) => {
    open.current = { action, fromBridge };
    setRequest({ id: nextId.current++, action });
  }, []);

  const onStripAction = useCallback(
    (action: BridgeAction) => {
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
    (action: BridgeAction) => {
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
      show(action, true);
    },
    [show],
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
      <TrustedStrip displayName={displayName} onAction={onStripAction} throttled={throttled} />
      <ProfileFrame username={username} displayName={displayName} onAction={onBridgeAction} />
      <ConfirmDialog request={request} target={target} onClose={onClose} />
    </>
  );
}
