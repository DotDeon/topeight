"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_COMMENT } from "@/convex/lib/posting";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import { Photo } from "../PhotoGrid";
import { PostBody } from "../PostBody";
import { ReportLink } from "../ReportLink";
import posts from "../Posts.module.css";
import { BlogEntry } from "./BlogEntry";
import styles from "./Blog.module.css";
import { stamp } from "./format";

function CommentForm({ postId }: { postId: Id<"blogPosts"> }) {
  const add = useMutation(api.blog.addComment);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (body.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      await add({ postId, body });
      setBody("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={posts.form} onSubmit={onSubmit}>
      <label>
        Add a comment
        <br />
        <textarea value={body} maxLength={MAX_COMMENT} rows={4} onChange={(e) => setBody(e.target.value)} />
      </label>
      <br />
      <button type="submit" disabled={busy || body.trim() === ""}>
        Add Comment
      </button>
      {error && (
        <span className={posts.error} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

function CommentsPage({ postId, cursor, first, onMore }: { postId: string; cursor: string | null; first: boolean; onMore: (c: string) => void }) {
  const res = useQuery(api.blog.comments, { postId, cursor });
  const remove = useMutation(api.blog.removeComment);
  const [error, setError] = useState("");
  if (res === undefined) return <p className={posts.muted}>Loading...</p>;
  return (
    <>
      {error && (
        <p className={posts.error} role="alert">
          {error}
        </p>
      )}
      {first && res.page.length === 0 && res.isDone && <p className={posts.muted}>No comments yet.</p>}
      {res.page.map((c) => (
        <div className={posts.comment} key={c.id} data-comment="">
          <div className={posts.who}>
            <Link href={`/${c.author.username}`}>
              {c.author.displayName}
              <Photo card={c.author} size={60} />
            </Link>
          </div>
          <div className={posts.what}>
            <span className={posts.date}>
              {stamp(c.createdAt)}
              {c.canDelete && (
                <button
                  type="button"
                  className={posts.del}
                  onClick={() => {
                    setError("");
                    remove({ id: c.id }).catch((e) => setError(errorText(e)));
                  }}
                >
                  Delete
                </button>
              )}
              <ReportLink targetType="blogComment" targetId={c.id} />
            </span>
            <PostBody body={c.body} />
          </div>
        </div>
      ))}
      {!res.isDone && (
        <p className={posts.more}>
          <button type="button" onClick={() => onMore(res.continueCursor)}>
            Load More
          </button>
        </p>
      )}
    </>
  );
}

/** One post with its full body, the author's edit and delete, and its comments. */
export function PostPage({ id, username, displayName }: { id: string; username: string; displayName: string }) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const post = useQuery(api.blog.get, { id });
  const removePost = useMutation(api.blog.remove);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);

  const title = `${displayName}'s Blog`;
  if (post === undefined || deleted) {
    return (
      <Box title={title}>
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (post === null || post.author.username !== username) {
    return (
      <Box title={title}>
        <p>This post is not available</p>
        <p>
          <Link href={`/${username}/blog`}>Back to the blog</Link>
        </p>
      </Box>
    );
  }
  async function onDelete() {
    if (!post || !window.confirm("Delete this post and its comments?")) return;
    setError("");
    try {
      await removePost({ id: post.id });
      setDeleted(true);
      router.push(`/${username}/blog`);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Box title={title}>
      <BlogEntry
        post={post}
        body={post.body}
        actions={
          <>
            {post.canEdit && (
              <>
                <Link href={`/blog/${post.id}/edit`}>Edit</Link>{" "}
                <button type="button" onClick={() => void onDelete()}>
                  Delete
                </button>{" "}
              </>
            )}
            <ReportLink targetType="blogPost" targetId={post.id} />
          </>
        }
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <h5 id="comments">Comments</h5>
      {isAuthenticated ? <CommentForm postId={post.id} /> : <p className={posts.muted}>Log in to leave a comment</p>}
      {cursors.map((cursor, i) => (
        <CommentsPage
          key={cursor ?? "first"}
          postId={post.id}
          cursor={cursor}
          first={i === 0}
          onMore={(c) => setCursors((prev) => (prev.includes(c) ? prev : [...prev, c]))}
        />
      ))}
      <p>
        <Link href={`/${username}/blog`}>Back to the blog</Link>
      </p>
    </Box>
  );
}
