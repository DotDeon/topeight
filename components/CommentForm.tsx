"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import styles from "./Posts.module.css";

function PostForm({
  label,
  button,
  maxLength,
  submit,
}: {
  label: string;
  button: string;
  maxLength: number;
  submit: (body: string) => Promise<unknown>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (body.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      await submit(body);
      setBody("");
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label>
        {label}
        <br />
        <textarea value={body} maxLength={maxLength} rows={4} onChange={(e) => setBody(e.target.value)} />
      </label>
      <br />
      <button type="submit" disabled={busy || body.trim() === ""}>
        {button}
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

export function CommentForm({ profileId }: { profileId: Id<"profiles"> }) {
  const add = useMutation(api.comments.add);
  return (
    <PostForm label="Add a comment" button="Add Comment" maxLength={2000} submit={(body) => add({ profileId, body })} />
  );
}

export function BulletinForm() {
  const post = useMutation(api.bulletins.post);
  return <PostForm label="Post a Bulletin" button="Post" maxLength={5000} submit={(body) => post({ body })} />;
}
