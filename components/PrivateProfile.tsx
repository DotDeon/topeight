"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MOOD_ICONS } from "@/lib/moods";
import type { RestrictedProfile } from "@/lib/profile/types";
import { moodLabel, MoodIcon } from "./MoodIcon";
import { OnlineNow } from "./OnlineNow";
import { useMinute } from "./useMinute";
import styles from "./PrivateProfile.module.css";

/** What a private profile's card shows: the left-column basics. */
export type PrivateCardData = Omit<RestrictedProfile, "restricted">;

/** The note on a private profile, and on its comments, friends and blog pages. */
export function privateNote(displayName: string): string {
  return `This profile is set to private. Add ${displayName} as a friend to see more.`;
}

export function PrivateNotice({ displayName }: { displayName: string }) {
  return <p data-topeight-private-notice="">{privateNote(displayName)}</p>;
}

/**
 * A private profile for a viewer who isn't a friend: photo, name, age, location,
 * mood and Online Now!, in the classic left-column look. It sits on the main site,
 * outside any frame, and never runs the owner's custom code.
 */
export function PrivateCard({ card }: { card: PrivateCardData }) {
  const icon = MOOD_ICONS.find((i) => i === card.mood?.icon);
  const facts = [
    card.mood && icon ? (
      <>
        Mood: <MoodIcon icon={icon} /> {card.mood.text || moodLabel(icon)}
      </>
    ) : null,
    card.age !== undefined ? `${card.age} years old` : null,
    card.location.trim() || null,
  ].filter((f) => f !== null);
  return (
    <div className={styles.card} data-topeight-private="">
      <h1 className={styles.name}>{card.displayName}</h1>
      <div className={styles.basic}>
        <div className={styles.photo}>
          {card.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user photos come from an external bucket
            <img src={card.photoUrl} alt={card.displayName} />
          ) : (
            <span className={styles.blank}>No photo</span>
          )}
          {card.online && (
            <div className={styles.online}>
              <OnlineNow />
            </div>
          )}
        </div>
        <div className={styles.info}>
          {facts.map((f, i) => (
            <p key={i}>{f}</p>
          ))}
        </div>
      </div>
      <div className={styles.note}>{privateNote(card.displayName)}</div>
    </div>
  );
}

/**
 * The card, read on the client. For a friend whose frame pass didn't come
 * through: whichever shape getPublicProfile returns, the card fields are in it.
 */
export function PrivateCardLoader({ username }: { username: string }) {
  const asOf = useMinute();
  const p = useQuery(api.profiles.getPublicProfile, { username, asOf });
  if (p === undefined) return <p>Loading…</p>;
  if (p === null || "unavailable" in p) return <p>This profile is unavailable</p>;
  return (
    <PrivateCard
      card={{
        displayName: p.displayName,
        photoUrl: p.photoUrl,
        ...(p.age !== undefined ? { age: p.age } : {}),
        location: p.location,
        mood: p.mood ?? null,
        online: p.online,
      }}
    />
  );
}
