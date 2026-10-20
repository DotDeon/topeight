"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  profileSong,
}: {
  username: string;
  displayName: string;
  /** This profile's tracks from getPublicProfile, at most 10. */
  tracks: readonly ProfileTrack[];
  /** The profile's own profile song, so its Report link works. Reports name its artist's username. */
  profileSong: { id: string; title: string; artistUsername: string } | null;
}) {
  const router = useRouter();
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
  const isHouse = useQuery(api.social.isHouseProfile, { username });
  const buttons = stripButtons(rel, isHouse);
  // null when signed out. Pick links are left off the visitor's own page.
  const me = useQuery(api.profiles.me);
  const ownPage = me === undefined ? undefined : me?.username === username;

  const show = useCallback((action: DialogAction, fromBridge: boolean, track?: ProfileTrack) => {
    open.current = { action, fromBridge };
    setRequest({ id: nextId.current++, action, ...(track ? { track } : {}) });
  }, []);

  // Mail is its own page, so Send Message leaves the profile instead of opening a dialog.
  const openCompose = useCallback(() => {
    router.push(`/mail/compose?to=${encodeURIComponent(username)}`);
  }, [router, username]);

  const onStripAction = useCallback(
    (action: DialogAction) => {
      gate.current.reset();
      clearTimeout(noteTimer.current);
      setThrottled(false);
      if (open.current) return;
      if (action === "message") openCompose();
      else show(action, false);
    },
    [show, openCompose],
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
      if (action === "message") {
        // No dialog, but it counts like a cancelled one so artist code cannot loop the redirect.
        gate.current.closed(Date.now(), { fromBridge: true, counts: true, outcome: "cancelled" });
        openCompose();
        return;
      }
      show(action, true, track);
    },
    [show, openCompose],
  );

  // Only ids in the server's list for this profile open a dialog, with the
  // server's title. Anything else is dropped before the gate sees it.
  const reportable = useMemo<ProfileTrack[]>(
    () => [
      ...tracks.map((t) => ({ ...t, owner: username })),
      ...(profileSong ? [{ id: profileSong.id, title: profileSong.title, owner: profileSong.artistUsername }] : []),
    ],
    [tracks, profileSong, username],
  );
  const onReportTrack = useCallback(
    (trackId: string) => {
      const track = findReportableTrack(reportable, trackId);
      if (track) onBridgeAction("reportTrack", track);
    },
    [reportable, onBridgeAction],
  );

  // Only this profile's own songs can be picked. The profile song is already someone's pick.
  const onPickSong = useCallback(
    (trackId: string) => {
      const track = findReportableTrack(tracks, trackId);
      if (track) onBridgeAction("pickSong", track);
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
        onPickSong={onPickSong}
        hidePick={ownPage}
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
