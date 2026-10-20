"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_BLOG_BODY, MAX_BLOG_TITLE } from "@/convex/lib/posting";
import { errorText } from "@/lib/errorText";
import { MOOD_ICONS, type MoodIcon as MoodIconId } from "@/lib/moods";
import { Box } from "../Box";
import { MoodIcon, moodLabel } from "../MoodIcon";
import styles from "./Blog.module.css";

const MAX_MOOD = 40;
const MAX_LISTENING = 100;

export type PostFields = {
  title: string;
  body: string;
  mood?: { text: string; icon: MoodIconId };
  listening?: string;
};

/** The write and edit form. With `postId` it saves over that post. */
export function PostForm({ postId, username, initial }: { postId?: Id<"blogPosts">; username: string; initial?: PostFields }) {
  const router = useRouter();
  const create = useMutation(api.blog.create);
  const update = useMutation(api.blog.update);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [icon, setIcon] = useState<MoodIconId | "">(initial?.mood?.icon ?? "");
  const [moodText, setMoodText] = useState(initial?.mood?.text ?? "");
  const [listening, setListening] = useState(initial?.listening ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pickIcon(next: MoodIconId | "") {
    // Keep the text in step with the icon until the writer types their own.
    const untouched = moodText === "" || (icon !== "" && moodText === moodLabel(icon));
    setIcon(next);
    if (untouched) setMoodText(next === "" ? "" : moodLabel(next));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const fields = {
      title,
      body,
      ...(icon !== "" ? { mood: { text: moodText, icon } } : {}),
      ...(listening.trim() !== "" ? { listening } : {}),
    };
    try {
      const id = postId ?? (await create(fields));
      if (postId) await update({ id: postId, ...fields });
      router.push(`/${username}/blog/${id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Box title={postId ? "Edit blog post" : "Write a new post"}>
      <form className={styles.form} onSubmit={onSubmit}>
        <label htmlFor="blog-title">Title:</label>
        <input id="blog-title" type="text" value={title} maxLength={MAX_BLOG_TITLE} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="blog-body">Post:</label>
        <textarea id="blog-body" rows={14} value={body} maxLength={MAX_BLOG_BODY} onChange={(e) => setBody(e.target.value)} />
        <label htmlFor="blog-mood">Current mood:</label>
        <div className={styles.moodRow}>
          {icon !== "" && <MoodIcon icon={icon} />}
          <select id="blog-mood" value={icon} onChange={(e) => pickIcon(e.target.value as MoodIconId | "")}>
            <option value="">None</option>
            {MOOD_ICONS.map((m) => (
              <option key={m} value={m}>
                {moodLabel(m)}
              </option>
            ))}
          </select>
          {icon !== "" && (
            <input
              type="text"
              aria-label="Mood text"
              value={moodText}
              maxLength={MAX_MOOD}
              onChange={(e) => setMoodText(e.target.value)}
            />
          )}
        </div>
        <label htmlFor="blog-listening">Currently listening:</label>
        <input
          id="blog-listening"
          type="text"
          value={listening}
          maxLength={MAX_LISTENING}
          onChange={(e) => setListening(e.target.value)}
        />
        <p>
          <button type="submit" disabled={busy || title.trim() === "" || body.trim() === ""}>
            {postId ? "Save" : "Publish"}
          </button>
          {error && (
            <span className={styles.error} role="alert">
              {error}
            </span>
          )}
        </p>
      </form>
    </Box>
  );
}
