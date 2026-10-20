"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import styles from "./Header.module.css";

/** Signed-in state links in the header. Small client island. */
export function HeaderAuthLinks() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const unread = useQuery(api.mail.unreadCount, isAuthenticated ? {} : "skip");

  if (isLoading) return <div className={styles.authLinks}>&nbsp;</div>;

  const light = { color: "#fff" };
  if (!isAuthenticated) {
    return (
      <div className={styles.authLinks}>
        <Link href="/login" style={light}>Log In</Link> |{" "}
        <Link href="/signup" style={light}>Sign Up</Link>
      </div>
    );
  }
  return (
    <div className={styles.authLinks}>
      {unread !== undefined && unread > 0 && (
        <>
          <Link href="/mail" className={styles.newMail} data-new-messages="">New Messages!</Link> |{" "}
        </>
      )}
      <Link href={me ? `/${me.username}` : "/edit"} style={light}>My Profile</Link> |{" "}
      <Link href="/edit" style={light}>Edit</Link> |{" "}
      <a href="#logout" style={light} onClick={(e) => { e.preventDefault(); void signOut(); }}>
        Log Out
      </a>
    </div>
  );
}
