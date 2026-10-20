"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { BlogEntry } from "./BlogEntry";
import styles from "./Blog.module.css";

function Page({ username, cursor, first, onMore }: { username: string; cursor: string | null; first: boolean; onMore: (c: string) => void }) {
  const res = useQuery(api.blog.listByUser, { username, cursor });
  if (res === undefined) return <p className={styles.muted}>Loading...</p>;
  return (
    <>
      {first && res.page.length === 0 && res.isDone && <p className={styles.muted}>No blog posts yet.</p>}
      {res.page.map((p) => (
        <BlogEntry key={p.id} post={p} />
      ))}
      {!res.isDone && (
        <p>
          <button type="button" onClick={() => onMore(res.continueCursor)}>
            Load More
          </button>
        </p>
      )}
    </>
  );
}

/** A member's posts, newest first, ten at a time. */
export function UserBlog({ username }: { username: string }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  return (
    <>
      {cursors.map((cursor, i) => (
        <Page
          key={cursor ?? "first"}
          username={username}
          cursor={cursor}
          first={i === 0}
          onMore={(c) => setCursors((prev) => (prev.includes(c) ? prev : [...prev, c]))}
        />
      ))}
    </>
  );
}
