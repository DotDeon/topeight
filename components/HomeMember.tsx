"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { Box } from "@/components/Box";
import { LoginBox } from "@/components/LoginBox";
import { Photo } from "@/components/PhotoGrid";
import { MoodForm } from "@/components/edit/MoodForm";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./Home.module.css";

function RequestButtons({ respond }: { respond: (accept: boolean) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = (accept: boolean) => {
    setBusy(true);
    setError("");
    void respond(accept)
      .catch((e) => setError(e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong."))
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
      {error && (
        <span className={styles.reqError} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function FriendRequestButtons({ requestId }: { requestId: Id<"friendRequests"> }) {
  const respond = useMutation(api.social.respondFriendRequest);
  return <RequestButtons respond={(accept) => respond({ requestId, accept })} />;
}

function LinkRequestButtons({ linkId }: { linkId: Id<"links"> }) {
  const respond = useMutation(api.links.respond);
  return <RequestButtons respond={(accept) => respond({ linkId, accept })} />;
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
  const { me, pendingRequests, linkRequests } = dashboard;
  return (
    <Box title="Member Login">
      <p className={styles.hello}>Hello, {me.displayName}!</p>
      <div className={styles.me}>
        <Photo card={me} />
        <div>
          View My: <Link href={`/${me.username}`}>Profile</Link> | <Link href="/edit">Edit Profile</Link>
        </div>
      </div>
      <div className={styles.moodBox}>
        <b>Update your mood</b>
        <MoodForm key={profile?._id} mood={profile?.mood} label="Update your mood" />
      </div>
      <div className={styles.reqs}>
        <b>Friend requests waiting: {pendingRequests.length}</b>
        {pendingRequests.map((c) => (
          <div className={styles.reqRow} key={c.requestId}>
            <Link href={`/${c.username}`}>
              <Photo card={c} size={40} />
            </Link>
            <Link href={`/${c.username}`}>{c.displayName}</Link>
            <FriendRequestButtons requestId={c.requestId} />
          </div>
        ))}
      </div>
      {linkRequests.length > 0 && (
        <div className={styles.reqs} data-topeight-link-requests="">
          <b>Roster and label requests waiting: {linkRequests.length}</b>
          {linkRequests.map((c) => (
            <div className={styles.reqRow} key={c.linkId}>
              <Link href={`/${c.username}`}>
                <Photo card={c} size={40} />
              </Link>
              <span>
                <Link href={`/${c.username}`}>{c.displayName}</Link>{" "}
                {c.type === "venue" ? "wants you on their roster" : "wants to be your label"}
              </span>
              <LinkRequestButtons linkId={c.linkId} />
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}
