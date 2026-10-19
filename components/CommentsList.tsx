"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CommentForm } from "./CommentForm";
import { Photo } from "./PhotoGrid";
import { PostBody } from "./PostBody";
import { ReportLink } from "./ReportLink";
import styles from "./Posts.module.css";

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function Page({ username, cursor, onMore }: { username: string; cursor: string | null; onMore: (c: string) => void }) {
  const res = useQuery(api.comments.list, { username, cursor });
  const remove = useMutation(api.comments.remove);
  const [error, setError] = useState("");
  if (res === undefined) return <p className={styles.muted}>Loading...</p>;
  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {res.page.length === 0 && cursor === null && res.isDone && <p className={styles.muted}>No comments yet.</p>}
      {res.page.map((c) => (
        <div className={styles.comment} key={c.id} data-comment="">
          <div className={styles.who}>
            <Link href={`/${c.author.username}`}>
              {c.author.displayName}
              <Photo card={c.author} size={60} />
            </Link>
          </div>
          <div className={styles.what}>
            <span className={styles.date}>
              {formatDate(c.createdAt)}
              {c.canDelete && (
                <button
                  type="button"
                  className={styles.del}
                  onClick={() => {
                    setError("");
                    remove({ commentId: c.id as Id<"comments"> }).catch((e) =>
                      setError(e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong."),
                    );
                  }}
                >
                  Delete
                </button>
              )}
              <ReportLink targetType="comment" targetId={c.id} />
            </span>
            <PostBody body={c.body} />
          </div>
        </div>
      ))}
      {!res.isDone && (
        <p className={styles.more}>
          <button type="button" onClick={() => onMore(res.continueCursor)}>
            Load More
          </button>
        </p>
      )}
    </>
  );
}

/** Comments page body: add form for signed-in users, then 50 comments per Load More. */
export function CommentsList({ username, profileId }: { username: string; profileId: Id<"profiles"> }) {
  const { isAuthenticated } = useConvexAuth();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  return (
    <>
      {isAuthenticated ? <CommentForm profileId={profileId} /> : <p className={styles.muted}>Log in to leave a comment</p>}
      {cursors.map((cursor) => (
        <Page
          key={cursor ?? "first"}
          username={username}
          cursor={cursor}
          onMore={(c) => setCursors((prev) => (prev.includes(c) ? prev : [...prev, c]))}
        />
      ))}
    </>
  );
}
