"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import { MoodIcon, moodLabel } from "../MoodIcon";
import styles from "./Blog.module.css";
import { entryDate } from "./format";

/** The /blog page: friends' recent posts, a link to the viewer's own blog, and a write button. */
export function BlogHome() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const feed = useQuery(api.blog.friendsFeed, isAuthenticated ? {} : "skip");

  if (isLoading) {
    return (
      <Box title="Blog">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (!isAuthenticated) {
    return (
      <Box title="Blog">
        <p>
          <Link href="/login">Log in</Link> to read your friends&apos; blogs
        </p>
      </Box>
    );
  }
  return (
    <Box title="Blog">
      <p>
        {me && <Link href={`/${me.username}/blog`}>My blog</Link>}{" "}
        <button type="button" onClick={() => router.push("/blog/new")}>
          Write a new post
        </button>
      </p>
      <h5>Recent posts from friends</h5>
      {feed === undefined && <p className={styles.muted}>Loading...</p>}
      {feed?.length === 0 && <p className={styles.muted}>No recent posts from your friends.</p>}
      {feed?.map((p) => (
        <p className={styles.feedItem} key={p.id} data-feed-item="">
          <Link href={`/${p.author.username}/blog/${p.id}`}>
            <b>{p.title}</b>
          </Link>{" "}
          by <Link href={`/${p.author.username}`}>{p.author.displayName}</Link>, {entryDate(p.createdAt)}
          {p.mood && (
            <>
              {" "}
              <MoodIcon icon={p.mood.icon} title={p.mood.text || moodLabel(p.mood.icon)} />
            </>
          )}
        </p>
      ))}
    </Box>
  );
}
