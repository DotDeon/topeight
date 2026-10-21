"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { MOOD_ICONS, type MoodIcon as MoodIconId } from "@/lib/moods";
import { MoodIcon, moodLabel } from "../MoodIcon";
import { StatusLine, useSaver } from "./shared";

const MAX_MOOD = 40;

/** Pick a mood face and a few words. Saving with None clears the mood. Used on the edit page and the homepage. */
export function MoodForm({ mood, label = "Mood" }: { mood: Doc<"profiles">["mood"]; label?: string }) {
  const setMood = useMutation(api.profiles.setMood);
  const { status, busy, run } = useSaver();
  const [icon, setIcon] = useState<MoodIconId | "">(mood?.icon ?? "");
  const [text, setText] = useState(mood?.text ?? "");

  function pickIcon(next: MoodIconId | "") {
    const untouched = text === "" || (icon !== "" && text === moodLabel(icon));
    setIcon(next);
    if (untouched) setText(next === "" ? "" : moodLabel(next));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(() => (icon === "" ? setMood({ icon: null }) : setMood({ icon, text })), "Mood updated");
  }

  return (
    <form onSubmit={onSubmit} aria-label={label}>
      {icon !== "" && <MoodIcon icon={icon} />}{" "}
      <select aria-label="Mood icon" value={icon} onChange={(e) => pickIcon(e.target.value as MoodIconId | "")}>
        <option value="">None</option>
        {MOOD_ICONS.map((m) => (
          <option key={m} value={m}>
            {moodLabel(m)}
          </option>
        ))}
      </select>{" "}
      {icon !== "" && (
        <input
          type="text"
          aria-label="Mood text"
          value={text}
          maxLength={MAX_MOOD}
          onChange={(e) => setText(e.target.value)}
        />
      )}{" "}
      <button type="submit" disabled={busy}>
        Update
      </button>{" "}
      <StatusLine status={status} />
    </form>
  );
}
