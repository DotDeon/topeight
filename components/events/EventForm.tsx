"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import styles from "./Events.module.css";

export type EventFields = {
  title: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  venue: string;
  city: string;
  description: string;
  imageUrl?: string;
};

/** Every IANA zone the browser knows, with `extra` added when the list lacks it (UTC, say). */
function zoneList(extra: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(extra) ? zones : [extra, ...zones];
}

/** The create and edit form. With `eventId` it saves over that event. */
export function EventForm({ eventId, initial }: { eventId?: Id<"events">; initial?: EventFields }) {
  const router = useRouter();
  const create = useMutation(api.events.create);
  const update = useMutation(api.events.update);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [localDate, setLocalDate] = useState(initial?.localDate ?? "");
  const [localTime, setLocalTime] = useState(initial?.localTime ?? "");
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [zones] = useState(() => zoneList(initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const fields = {
      title,
      localDate,
      localTime,
      timeZone,
      venue,
      city,
      description,
      ...(imageUrl.trim() !== "" ? { imageUrl } : {}),
    };
    try {
      const id = eventId ?? (await create(fields));
      if (eventId) await update({ id: eventId, ...fields });
      router.push(`/events/${id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const ready =
    title.trim() !== "" && localDate !== "" && localTime !== "" && venue.trim() !== "" && city.trim() !== "";
  return (
    <Box title={eventId ? "Edit event" : "Post an event"}>
      <form className={styles.form} onSubmit={onSubmit}>
        <label htmlFor="ev-title">Title:</label>
        <input id="ev-title" type="text" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="ev-date">Date:</label>
        <div className={styles.when}>
          <input id="ev-date" type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} />
          <input
            id="ev-time"
            type="time"
            aria-label="Time"
            value={localTime}
            onChange={(e) => setLocalTime(e.target.value)}
          />
        </div>
        <label htmlFor="ev-zone">Timezone:</label>
        <select id="ev-zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <label htmlFor="ev-venue">Venue:</label>
        <input id="ev-venue" type="text" value={venue} maxLength={100} onChange={(e) => setVenue(e.target.value)} />
        <label htmlFor="ev-city">City:</label>
        <input id="ev-city" type="text" value={city} maxLength={100} onChange={(e) => setCity(e.target.value)} />
        <label htmlFor="ev-desc">Description:</label>
        <textarea
          id="ev-desc"
          rows={8}
          value={description}
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label htmlFor="ev-image">Image link (optional):</label>
        <input
          id="ev-image"
          type="text"
          value={imageUrl}
          maxLength={500}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <p>
          <button type="submit" disabled={busy || !ready}>
            {eventId ? "Save" : "Post event"}
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
