"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import styles from "./Blog.module.css";
import { PostForm } from "./PostForm";

/** Signed-in, profiled viewer or a message. `children` gets the viewer's username. */
function Gate({ children }: { children: (username: string) => React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <Box title="Blog">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (!isAuthenticated || me === null || me === undefined || me.banned) {
    return (
      <Box title="Blog">
        <p>
          <Link href="/login">Log in</Link> to write a blog post
        </p>
      </Box>
    );
  }
  return <>{children(me.username)}</>;
}

export function NewPost() {
  return <Gate>{(username) => <PostForm username={username} />}</Gate>;
}

export function EditPost({ id }: { id: string }) {
  const post = useQuery(api.blog.get, { id });
  return (
    <Gate>
      {(username) => {
        if (post === undefined) return <p className={styles.muted}>Loading...</p>;
        if (post === null || !post.canEdit) {
          return (
            <Box title="Edit blog post">
              <p>You can&apos;t edit this post</p>
            </Box>
          );
        }
        return (
          <PostForm
            postId={post.id}
            username={username}
            initial={{ title: post.title, body: post.body, mood: post.mood, listening: post.listening }}
          />
        );
      }}
    </Gate>
  );
}
