"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { BridgeAction } from "@/lib/bridge-protocol";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import { ProfileFrame } from "./ProfileFrame";
import { TrustedStrip } from "./TrustedStrip";

/** Bridge requests are ignored this long after a dialog closes. */
const BRIDGE_COOLDOWN_MS = 1000;
/** After this many dialogs from the frame are cancelled in a row, the frame can no longer open one. */
const MAX_CANCELLED_BRIDGE_DIALOGS = 3;

/** Trusted strip, sandboxed profile frame and the confirm dialog they share. */
export function ProfileView({ username, displayName }: { username: string; displayName: string }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const nextId = useRef(1);
  const open = useRef(false);
  const fromBridge = useRef(false);
  const closedAt = useRef(0);
  const cancelledBridge = useRef(0);

  const recordView = useMutation(api.profiles.recordView);
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (viewed.current === username) return;
    viewed.current = username;
    void recordView({ username }).catch(() => {});
  }, [username, recordView]);

  const show = useCallback((action: BridgeAction, bridge: boolean) => {
    open.current = true;
    fromBridge.current = bridge;
    setRequest({ id: nextId.current++, action });
  }, []);

  const onStripAction = useCallback(
    (action: BridgeAction) => {
      if (!open.current) show(action, false);
    },
    [show],
  );

  // A request from the frame never replaces an open dialog, so artist code
  // cannot swap what the visitor is about to confirm.
  const onBridgeAction = useCallback(
    (action: BridgeAction) => {
      if (open.current) return;
      if (Date.now() - closedAt.current < BRIDGE_COOLDOWN_MS) return;
      if (cancelledBridge.current >= MAX_CANCELLED_BRIDGE_DIALOGS) return;
      show(action, true);
    },
    [show],
  );

  const onClose = useCallback((outcome: "cancelled" | "done") => {
    open.current = false;
    closedAt.current = Date.now();
    if (fromBridge.current) {
      cancelledBridge.current = outcome === "cancelled" ? cancelledBridge.current + 1 : 0;
    }
    setRequest(null);
  }, []);

  const target = { username, displayName };
  return (
    <>
      <TrustedStrip displayName={displayName} onAction={onStripAction} />
      <ProfileFrame username={username} displayName={displayName} onAction={onBridgeAction} />
      <ConfirmDialog request={request} target={target} onClose={onClose} />
    </>
  );
}
