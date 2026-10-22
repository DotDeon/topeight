"use client";

import { useMutation, useQuery } from "convex/react";
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
  /** Usernames of the bands playing, in order. Venues only. */
  lineup?: string[];
};

/**
 * Whether the form can be sent. `venueCity` is the venue's profile city, null for
 * anyone else. A venue also waits for its roster, or an edit saved early would
 * send an empty lineup and take every band off the gig.
 */
export function eventFormReady(f: {
  title: string;
  localDate: string;
  localTime: string;
  venue: string;
  city: string;
  venueCity: string | null;
  rosterLoaded: boolean;
}): boolean {
  const placed = f.venueCity !== null ? f.venueCity.trim() !== "" && f.rosterLoaded : f.venue.trim() !== "" && f.city.trim() !== "";
  return f.title.trim() !== "" && f.localDate !== "" && f.localTime !== "" && placed;
}

type RosterBand = { id: Id<"profiles">; username: string; displayName: string };

/** Picks bands from the venue's roster and sets their playing order. */
function LineupPicker({
  roster,
  chosen,
  onChange,
}: {
  roster: RosterBand[];
  chosen: Id<"profiles">[];
  onChange: (next: Id<"profiles">[]) => void;
}) {
  const name = (id: Id<"profiles">) => roster.find((b) => b.id === id)?.displayName ?? "";
  const move = (i: number, by: -1 | 1) => {
    const next = [...chosen];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  if (roster.length === 0) {
    return <p className={styles.muted}>No bands on your roster yet. Ask a band from its profile first.</p>;
  }
  return (
    <div data-lineup-picker="">
      {roster.map((b) => (
        <label key={b.id} className={styles.lineupPick}>
          <input
            type="checkbox"
            checked={chosen.includes(b.id)}
            onChange={(e) => onChange(e.target.checked ? [...chosen, b.id] : chosen.filter((id) => id !== b.id))}
          />{" "}
          {b.displayName}
        </label>
      ))}
      {chosen.length > 1 && (
        <ol className={styles.lineupOrder}>
          {chosen.map((id, i) => (
            <li key={id}>
              {name(id)}{" "}
              <button type="button" aria-label={`Move ${name(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                Up
              </button>{" "}
              <button
                type="button"
                aria-label={`Move ${name(id)} down`}
                disabled={i === chosen.length - 1}
                onClick={() => move(i, 1)}
              >
                Down
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

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
  const me = useQuery(api.profiles.me);
  const isVenue = me?.kind === "venue";
  const links = useQuery(api.links.mine, isVenue ? {} : "skip");
  const roster: RosterBand[] = links?.roster ?? [];
  // Edit starts from the saved lineup. Bands no longer on the roster drop out.
  const [picked, setPicked] = useState<Id<"profiles">[] | null>(null);
  const lineup =
    picked ??
    (initial?.lineup ?? []).flatMap((u) => roster.filter((b) => b.username === u).map((b) => b.id));
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
      // The server puts a venue's own name and city on its events.
      venue: isVenue ? me.displayName : venue,
      city: isVenue ? me.location : city,
      description,
      ...(imageUrl.trim() !== "" ? { imageUrl } : {}),
      ...(isVenue ? { lineup } : {}),
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

  // Wait for the profile too, so nobody posts before we know whether they're a venue.
  const ready =
    me !== undefined &&
    eventFormReady({
      title,
      localDate,
      localTime,
      venue,
      city,
      venueCity: isVenue ? me.location : null,
      rosterLoaded: links !== undefined,
    });
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
        {isVenue ? (
          <>
            <span>Venue:</span>
            <span>
              {me.displayName}, {me.location.trim() || <i>add your city on Edit Profile first</i>}
            </span>
            <span>Lineup:</span>
            {links === undefined ? <p className={styles.muted}>Loading...</p> : (
              <LineupPicker roster={roster} chosen={lineup} onChange={setPicked} />
            )}
          </>
        ) : (
          <>
            <label htmlFor="ev-venue">Venue:</label>
            <input id="ev-venue" type="text" value={venue} maxLength={100} onChange={(e) => setVenue(e.target.value)} />
            <label htmlFor="ev-city">City:</label>
            <input id="ev-city" type="text" value={city} maxLength={100} onChange={(e) => setCity(e.target.value)} />
          </>
        )}
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
