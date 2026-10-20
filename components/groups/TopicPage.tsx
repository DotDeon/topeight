"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import { Photo } from "../PhotoGrid";
import { PostBody } from "../PostBody";
import { ReportLink } from "../ReportLink";
import { Cursored, formatWhen } from "./Cursored";
import styles from "./Groups.module.css";

function ReplyForm({ topicId }: { topicId: string }) {
  const reply = useMutation(api.groups.reply);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || body.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      await reply({ topicId: topicId as Id<"groupTopics">, body });
      setBody("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label htmlFor="r-body">Reply:</label>
      <textarea id="r-body" rows={4} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
      <p>
        <button type="submit" disabled={busy || body.trim() === ""}>
          Post reply
        </button>
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </p>
    </form>
  );
}

/** /groups/[slug]/t/[topicId]: the posts oldest first, a reply form for members, Remove for the owner. */
export function TopicPage({ topicId }: { topicId: string }) {
  const topic = useQuery(api.groups.topic, { topicId });
  const removePost = useMutation(api.groups.removePost);
  const [error, setError] = useState("");

  if (topic === undefined) {
    return (
      <Box title="Topic">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (topic === null) {
    return (
      <Box title="Topic">
        <p>This topic is not available</p>
        <p>
          <Link href="/groups">Back to groups</Link>
        </p>
      </Box>
    );
  }
  return (
    <Box title={topic.title}>
      <p>
        <Link href={`/groups/${topic.slug}`}>{topic.groupName}</Link> &gt; topic by{" "}
        <Link href={`/${topic.author.username}`}>{topic.author.displayName}</Link>
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Cursored
        useQ={(cursor) =>
          // eslint-disable-next-line react-hooks/rules-of-hooks -- one stable hook call per page component
          useQuery(api.groups.replies, { topicId, cursor })
        }
      >
        {(items) =>
          items.map((r) => (
            <div className={styles.post} key={r.id} data-post="">
              <div className={styles.who}>
                <Link href={`/${r.author.username}`}>
                  {r.author.displayName}
                  <Photo card={r.author} size={60} />
                </Link>
              </div>
              <div className={styles.what}>
                <span className={styles.date}>
                  {formatWhen(r.createdAt)}
                  {r.canRemove && (
                    <button
                      type="button"
                      className={styles.small}
                      onClick={() => {
                        setError("");
                        removePost({ replyId: r.id }).catch((e) => setError(errorText(e)));
                      }}
                    >
                      Remove
                    </button>
                  )}
                  <span className={styles.small}>
                    <ReportLink targetType="groupReply" targetId={r.id} />
                  </span>
                </span>
                <PostBody body={r.body} />
              </div>
            </div>
          ))
        }
      </Cursored>
      {topic.canPost ? (
        <ReplyForm topicId={topicId} />
      ) : (
        <p className={styles.muted}>Join the group to reply</p>
      )}
      <p>
        <ReportLink targetType="groupTopic" targetId={topic.id} />
      </p>
    </Box>
  );
}
