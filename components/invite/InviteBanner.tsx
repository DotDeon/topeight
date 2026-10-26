"use client";

import { useQuery } from "convex/react";
import { useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import styles from "./Invite.module.css";

const KEY = "topeight.invite";

/** Reads ?invite= and keeps it in session storage, so it survives the email code step and a reload. */
function readToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("invite")?.trim().slice(0, 64);
  if (fromUrl) sessionStorage.setItem(KEY, fromUrl);
  return fromUrl || sessionStorage.getItem(KEY);
}

const noSubscribe = () => () => {};

/** The invite token for the sign-up page, or null when there is none. */
export function useInviteToken(): string | null {
  return useSyncExternalStore(noSubscribe, readToken, () => null);
}

/** Forgets the token once the new profile exists. */
export function clearInviteToken(): void {
  sessionStorage.removeItem(KEY);
}

/** "Name invited you" above the sign-up form. Nothing for a used or expired link. */
export function InviteBanner({ token }: { token: string }) {
  const who = useQuery(api.invites.preview, { token });
  if (!who) return null;
  return (
    <div className={styles.banner} data-invite-banner="">
      {/* eslint-disable-next-line @next/next/no-img-element -- user photos come from an external bucket */}
      {who.photoUrl && <img src={who.photoUrl} alt="" />}
      <span>
        <b>{who.displayName}</b> invited you. When you join, you two become friends.
      </span>
    </div>
  );
}
