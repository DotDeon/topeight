"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import { PhotoGrid } from "../PhotoGrid";
import { PostBody } from "../PostBody";
import { ReportLink } from "../ReportLink";
import { Cursored, formatWhen } from "./Cursored";
import { GroupAdminActions } from "./GroupAdminActions";
import { GroupThumb } from "./GroupThumb";
import { CATEGORY_LABEL } from "./GroupsHome";
import styles from "./Groups.module.css";

function NewTopic({ groupId, onDone }: { groupId: Id<"groups">; onDone: (topicId: Id<"groupTopics">) => void }) {
  const start = useMutation(api.groups.startTopic);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { topicId } = await start({ groupId, title, body });
      onDone(topicId);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label htmlFor="t-title">Topic:</label>
      <input id="t-title" type="text" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="t-body">Message:</label>
      <textarea id="t-body" rows={5} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
      <p>
        <button type="submit" disabled={busy || title.trim() === "" || body.trim() === ""}>
          Post topic
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

function Board({ slug }: { slug: string }) {
  return (
    <Cursored
      empty="No topics yet."
      useQ={(cursor) =>
        // eslint-disable-next-line react-hooks/rules-of-hooks -- one stable hook call per page component
        useQuery(api.groups.topics, { slug, cursor })
      }
    >
      {(items) =>
        items.length === 0 ? null : (
          <table className={styles.board}>
            <thead>
              <tr>
                <th>Topic</th>
                <th className={styles.num}>Replies</th>
                <th className={styles.last}>Last post</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} data-topic-row="">
                  <td>
                    <Link href={`/groups/${slug}/t/${t.id}`}>{t.title}</Link>
                    <br />
                    <span className={styles.muted}>by {t.author.displayName}</span>
                  </td>
                  <td className={styles.num}>{t.replyCount - 1}</td>
                  <td className={styles.last}>{formatWhen(t.lastReplyAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </Cursored>
  );
}

function Members({ slug }: { slug: string }) {
  return (
    <Cursored
      empty="No members"
      useQ={(cursor) =>
        // eslint-disable-next-line react-hooks/rules-of-hooks -- one stable hook call per page component
        useQuery(api.groups.members, { slug, cursor })
      }
    >
      {(items) => <PhotoGrid cards={items.map((m) => m.member)} empty="No members" />}
    </Cursored>
  );
}

/** /groups/[slug]: the group header, Join Group, the topic board and the members. Admins also get Restore and Set owner. */
export function GroupPage({ slug }: { slug: string }) {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const group = useQuery(api.groups.get, { slug });
  const admin = useQuery(api.moderation.canModerate, {}) ?? false;
  const join = useMutation(api.groups.join);
  const leave = useMutation(api.groups.leave);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);

  if (group === undefined) {
    return (
      <Box title="Group">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (group === null) {
    return (
      <Box title="Group">
        <p>This group is not available</p>
        <p>
          <Link href="/groups">Back to groups</Link>
        </p>
      </Box>
    );
  }
  const g = group;

  async function run(p: Promise<unknown>) {
    setError("");
    try {
      await p;
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <Box title={g.name}>
        <div className={styles.head}>
          <GroupThumb name={g.name} photoUrl={g.photoUrl} big />
          <div>
            {(g.deleted || g.hidden) && (
              <p className={styles.error}>{g.deleted ? "This group is deleted" : "This group is hidden"}</p>
            )}
            <p>
              {CATEGORY_LABEL[g.category]} group, <span data-member-count="">{g.memberCount}</span>{" "}
              {g.memberCount === 1 ? "member" : "members"}
              <br />
              {g.owner ? (
                <>
                  Owner: <Link href={`/${g.owner.username}`}>{g.owner.displayName}</Link>
                </>
              ) : (
                <span data-owner-unavailable="">Owner unavailable</span>
              )}
            </p>
            <p>
              {!isAuthenticated ? (
                <Link href="/login">Log in to join this group</Link>
              ) : g.isBanned ? (
                <span>You&apos;re banned from this group</span>
              ) : g.isMember ? (
                !g.isOwner && (
                  <button type="button" onClick={() => void run(leave({ groupId: g.id }))}>
                    Leave Group
                  </button>
                )
              ) : (
                <button type="button" onClick={() => void run(join({ groupId: g.id }))}>
                  Join Group
                </button>
              )}
              {g.isOwner && <Link href={`/groups/${g.slug}/settings`}>Group settings</Link>} <ReportLink targetType="group" targetId={g.id} />
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {admin && <GroupAdminActions groupId={g.id} deleted={g.deleted} hidden={g.hidden} />}
          </div>
        </div>
        {g.description && (
          <div className={styles.description}>
            <PostBody body={g.description} />
          </div>
        )}
      </Box>
      <Box title="Discussion board" color="blue">
        {g.isMember && !g.isBanned && !composing && (
          <p>
            <button type="button" onClick={() => setComposing(true)}>
              New topic
            </button>
          </p>
        )}
        {composing && <NewTopic groupId={g.id} onDone={(id) => router.push(`/groups/${g.slug}/t/${id}`)} />}
        <Board slug={g.slug} />
      </Box>
      <Box title="Members">
        <Members slug={g.slug} />
      </Box>
    </>
  );
}
