"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Box } from "@/components/Box";
import { LoginBox } from "@/components/LoginBox";
import { Photo } from "@/components/PhotoGrid";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./Home.module.css";

function RequestButtons({ requestId }: { requestId: Id<"friendRequests"> }) {
  const respond = useMutation(api.social.respondFriendRequest);
  const [busy, setBusy] = useState(false);
  const answer = (accept: boolean) => {
    setBusy(true);
    void respond({ requestId, accept })
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  return (
    <span className={styles.reqBtns}>
      <button type="button" disabled={busy} onClick={() => answer(true)}>
        Accept
      </button>{" "}
      <button type="button" disabled={busy} onClick={() => answer(false)}>
        Decline
      </button>
    </span>
  );
}

function useDashboard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const dashboard = useQuery(api.home.dashboard, isAuthenticated ? {} : "skip");
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  return { isLoading, isAuthenticated, dashboard, me };
}

/** Top of the right column. Member Login when signed out, the member's own panel when in. */
export function MemberPanel() {
  const { isLoading, isAuthenticated, dashboard, me: profile } = useDashboard();
  if (isLoading) return null;
  if (!isAuthenticated) return <LoginBox />;
  if (dashboard === null) {
    return (
      <>
        {profile === null && (
          <Box title="Welcome">
            <Link href="/signup">Finish setting up your profile</Link>
          </Box>
        )}
        <LoginBox />
      </>
    );
  }
  if (dashboard === undefined) return <Box title="Welcome">Loading...</Box>;
  const { me, pendingRequests } = dashboard;
  return (
    <Box title="Member Login">
      <p className={styles.hello}>Hello, {me.displayName}!</p>
      <div className={styles.me}>
        <Photo card={me} />
        <div>
          View My: <Link href={`/${me.username}`}>Profile</Link> | <Link href="/edit">Edit Profile</Link>
        </div>
      </div>
      <div className={styles.reqs}>
        <b>Friend requests waiting: {pendingRequests.length}</b>
        {pendingRequests.map((c) => (
          <div className={styles.reqRow} key={c.requestId}>
            <Link href={`/${c.username}`}>
              <Photo card={c} size={40} />
            </Link>
            <Link href={`/${c.username}`}>{c.displayName}</Link>
            <RequestButtons requestId={c.requestId} />
          </div>
        ))}
      </div>
    </Box>
  );
}

/** Friends' bulletins, shown only when signed in. */
export function HomeBulletins() {
  const { isAuthenticated, dashboard } = useDashboard();
  if (!isAuthenticated || !dashboard) return null;
  const { bulletins } = dashboard;
  return (
    <Box title="Bulletins From Friends" color="blue">
      {bulletins.length === 0 ? (
        <span className={styles.muted}>No new bulletins from your friends</span>
      ) : (
        bulletins.map((b) => (
          <div className={styles.bulletin} key={b.id}>
            <Link href={`/${b.author.username}`}><b>{b.author.displayName}</b></Link>{" "}
            <span className={styles.muted}>{new Date(b.createdAt).toLocaleDateString("en-GB")}</span>
            <div className={styles.body}>{b.body}</div>
          </div>
        ))
      )}
    </Box>
  );
}
