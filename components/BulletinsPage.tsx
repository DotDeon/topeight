"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Box } from "@/components/Box";
import { api } from "@/convex/_generated/api";
import { BulletinForm } from "./CommentForm";
import { Photo } from "./PhotoGrid";
import { PostBody } from "./PostBody";
import styles from "./Posts.module.css";

function Feed() {
  const feed = useQuery(api.bulletins.feed, {});
  const me = useQuery(api.profiles.me, {});
  const remove = useMutation(api.bulletins.remove);
  if (feed === undefined) return <p className={styles.muted}>Loading...</p>;
  if (feed.length === 0) return <p className={styles.muted}>No bulletins from the last 10 days</p>;
  return (
    <>
      {feed.map((b) => (
        <div className={`${styles.comment} ${styles.bulletin}`} key={b.id} data-bulletin="">
          <div className={styles.who}>
            <Link href={`/${b.author.username}`}>
              {b.author.displayName}
              <Photo card={b.author} size={60} />
            </Link>
          </div>
          <div className={styles.what}>
            <span className={styles.date}>
              {new Date(b.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
              {me && me.username === b.author.username && (
                <button type="button" className={styles.del} onClick={() => void remove({ bulletinId: b.id }).catch(() => {})}>
                  Delete
                </button>
              )}
            </span>
            <PostBody body={b.body} />
          </div>
        </div>
      ))}
    </>
  );
}

export function BulletinsPage() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <Box title="Bulletins"><p className={styles.muted}>Loading...</p></Box>;
  if (!isAuthenticated) {
    return (
      <Box title="Bulletins">
        <p>
          Log in to read bulletins. <Link href="/login">Log in</Link>
        </p>
      </Box>
    );
  }
  return (
    <>
      <Box title="Post a Bulletin">
        <BulletinForm />
      </Box>
      <Box title="Bulletins" color="blue">
        <Feed />
      </Box>
    </>
  );
}
