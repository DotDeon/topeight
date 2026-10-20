import Link from "next/link";
import type { ReactNode } from "react";
import type { BlogPostSummary } from "@/convex/blog";
import { MoodIcon, moodLabel } from "../MoodIcon";
import { PostBody } from "../PostBody";
import styles from "./Blog.module.css";
import { commentLabel, entryDate } from "./format";

/** One post in the 2006 blog style. Shows the full body when `body` is given, the excerpt otherwise. */
export function BlogEntry({
  post,
  body,
  actions,
}: {
  post: BlogPostSummary;
  body?: string;
  actions?: ReactNode;
}) {
  const href = `/${post.author.username}/blog/${post.id}`;
  const full = body !== undefined;
  const text = full ? body : post.excerpt;
  return (
    <article className={styles.entry} data-blog-entry="">
      <h5 className={styles.dateBar}>{entryDate(post.createdAt)}</h5>
      <div className={styles.title}>{full ? post.title : <Link href={href}>{post.title}</Link>}</div>
      <div className={styles.text}>
        <PostBody body={text} />
        {!full && post.excerpt.length >= 200 && <> ... <Link href={href}>Read more</Link></>}
      </div>
      {post.mood && (
        <div className={styles.meta} data-blog-mood="">
          <b>Current mood:</b> <MoodIcon icon={post.mood.icon} /> {post.mood.text || moodLabel(post.mood.icon)}
        </div>
      )}
      {post.listening && (
        <div className={styles.meta} data-blog-listening="">
          <b>Currently listening:</b> {post.listening}
        </div>
      )}
      <p className={styles.foot}>
        <Link href={`${href}#comments`}>{commentLabel(post.commentCount)}</Link>
        {actions && <span className={styles.actions}>{actions}</span>}
      </p>
    </article>
  );
}
