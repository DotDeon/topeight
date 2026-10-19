"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ReportPreview } from "@/convex/moderation";
import { Box } from "./Box";
import styles from "./Posts.module.css";

function errorText(e: unknown): string {
  return e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong.";
}

function Preview({ p }: { p: ReportPreview }) {
  switch (p.kind) {
    case "gone":
      return <p className={styles.muted}>This content no longer exists.</p>;
    case "comment":
    case "bulletin":
      return (
        <>
          <p>
            {p.kind === "comment" ? "Comment" : "Bulletin"} by{" "}
            {p.author ? <Link href={`/${p.author.username}`}>{p.author.displayName}</Link> : "unknown"}
          </p>
          <blockquote style={{ whiteSpace: "pre-wrap", margin: "4px 0 4px 12px" }}>{p.body}</blockquote>
        </>
      );
    case "track":
      return (
        <p>
          Track &quot;{p.title}&quot; by{" "}
          {p.owner ? <Link href={`/${p.owner.username}`}>{p.owner.displayName}</Link> : "unknown"}
          {p.url && (
            <>
              {" "}
              <a href={p.url} target="_blank" rel="noreferrer">
                listen
              </a>
            </>
          )}
        </p>
      );
    case "profile":
      return (
        <>
          <p>
            Profile <Link href={`/${p.username}`}>{p.displayName}</Link> ({p.username}){p.banned && " [banned]"}
          </p>
          {p.headline && <p>Headline: {p.headline}</p>}
          {p.aboutMe && <p style={{ whiteSpace: "pre-wrap" }}>About me: {p.aboutMe}</p>}
        </>
      );
  }
}

type Row = FunctionReturnType<typeof api.moderation.listOpen>[number];

function ReportRow({ r }: { r: Row }) {
  const hide = useMutation(api.moderation.hide);
  const dismiss = useMutation(api.moderation.dismiss);
  const ban = useMutation(api.moderation.ban);
  const deleteTrack = useMutation(api.moderation.deleteTrack);
  const [error, setError] = useState("");
  const run = (p: Promise<null>) => {
    setError("");
    p.catch((e) => setError(errorText(e)));
  };
  const p = r.preview;
  // Who "Ban user" bans: the profile itself, or whoever wrote or uploaded the content.
  const bannedId: Id<"profiles"> | null =
    p.kind === "profile"
      ? p.banned ? null : p.profileId
      : p.kind === "comment" || p.kind === "bulletin"
        ? p.authorId
        : p.kind === "track"
          ? p.ownerId
          : null;

  return (
    <div data-report="" style={{ borderBottom: "1px solid #6698cb", padding: "6px 0" }}>
      <p className={styles.date}>
        {r.targetType} reported {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC by{" "}
        {r.reporter ? <Link href={`/${r.reporter.username}`}>{r.reporter.displayName}</Link> : "unknown"}
      </p>
      <p>Reason: {r.reason}</p>
      <Preview p={p} />
      {p.kind === "profile" && p.tracks.length > 0 && (
        <ul>
          {p.tracks.map((t) => (
            <li key={t.id}>
              {t.title}{" "}
              {t.url && (
                <a href={t.url} target="_blank" rel="noreferrer">
                  listen
                </a>
              )}{" "}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete the track "${t.title}"?`)) run(deleteTrack({ trackId: t.id }));
                }}
              >
                Delete track
              </button>
            </li>
          ))}
        </ul>
      )}
      <p>
        <button type="button" onClick={() => run(hide({ reportId: r.id }))}>
          Hide
        </button>{" "}
        <button type="button" onClick={() => run(dismiss({ reportId: r.id }))}>
          Dismiss
        </button>
        {bannedId !== null && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Ban this user? They are signed out and their profile disappears.")) {
                  run(ban({ profileId: bannedId }));
                }
              }}
            >
              Ban user
            </button>
          </>
        )}
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </p>
    </div>
  );
}

function Queue() {
  const rows = useQuery(api.moderation.listOpen, {});
  if (rows === undefined) return <p className={styles.muted}>Loading...</p>;
  if (rows.length === 0) return <p className={styles.muted}>No open reports.</p>;
  return (
    <>
      {rows.map((r) => (
        <ReportRow key={r.id} r={r} />
      ))}
    </>
  );
}

/** The admin page body. Everyone else sees a plain "Not allowed". */
export function AdminQueue() {
  const allowed = useQuery(api.moderation.canModerate, {});
  if (allowed === undefined) return <p className={styles.muted}>Loading...</p>;
  if (!allowed) return <p>Not allowed</p>;
  return (
    <Box title="Open Reports">
      <Queue />
    </Box>
  );
}
