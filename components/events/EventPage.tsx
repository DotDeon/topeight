"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errorText";
import { formatEventTime } from "@/lib/eventTime";
import { Box } from "../Box";
import { PhotoGrid } from "../PhotoGrid";
import { PostBody } from "../PostBody";
import { ReportLink } from "../ReportLink";
import styles from "./Events.module.css";

/** The current time, refreshed every 30 seconds. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * One event: details, the going grid, RSVP buttons, and the host's edit and cancel.
 * Once the event starts the RSVP buttons and Edit go away. Clearing an answer and
 * Cancel event stay, because the server still allows both.
 */
export function EventPage({ id }: { id: string }) {
  const { isAuthenticated } = useConvexAuth();
  const event = useQuery(api.events.get, { id });
  const now = useNow();
  const rsvp = useMutation(api.events.rsvp);
  const cancel = useMutation(api.events.cancel);
  const leave = useMutation(api.events.leaveLineup);
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const [error, setError] = useState("");

  if (event === undefined) {
    return (
      <Box title="Event">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (event === null) {
    return (
      <Box title="Event">
        <p>This event is not available</p>
        <p>
          <Link href="/events">Back to events</Link>
        </p>
      </Box>
    );
  }

  const started = event.startsAt <= now;

  async function answer(status: "going" | "maybe" | null) {
    setError("");
    try {
      await rsvp({ eventId: event!.id, status });
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function onCancel() {
    if (!window.confirm("Cancel this event? People who answered will see it as cancelled.")) return;
    setError("");
    try {
      await cancel({ id: event!.id });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const onLineup = me != null && event.lineup.some((b) => b.username === me.username);
  async function onLeave() {
    if (!window.confirm("Take your band off this lineup? The venue can't add you back to this gig.")) return;
    setError("");
    try {
      await leave({ eventId: event!.id });
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Box title={event.title}>
      {event.cancelled && (
        <p className={styles.cancelled} data-event-cancelled="">
          Cancelled
        </p>
      )}
      <p>
        <b>{formatEventTime(event.startsAt, event.timeZone)}</b>
        <br />
        {event.venue}, {event.city}
        <br />
        Hosted by <Link href={`/${event.host.username}`}>{event.host.displayName}</Link>
      </p>
      {event.lineup.length > 0 && (
        <p data-event-lineup="">
          <b>Lineup:</b>{" "}
          {event.lineup.map((band, i) => (
            <span key={band.username}>
              {i > 0 && ", "}
              <Link href={`/${band.username}`}>{band.displayName}</Link>
            </span>
          ))}
          {onLineup && !started && (
            <>
              {" "}
              <button type="button" onClick={() => void onLeave()}>
                Take us off this lineup
              </button>
            </>
          )}
        </p>
      )}
      {event.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external image URLs
        <img className={styles.flyer} src={event.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
      )}
      {event.description && (
        <div className={styles.description}>
          <PostBody body={event.description} />
        </div>
      )}

      <div className={styles.rsvp} data-rsvp="">
        {!isAuthenticated ? (
          <p>
            <Link href="/login">Log in to RSVP</Link>
          </p>
        ) : event.cancelled || started ? (
          event.myStatus !== null && (
            <p>
              You answered {event.myStatus === "going" ? "going" : "maybe"}.{" "}
              <button type="button" onClick={() => void answer(null)}>
                Clear my RSVP
              </button>
            </p>
          )
        ) : (
          <p>
            <button
              type="button"
              aria-pressed={event.myStatus === "going"}
              onClick={() => void answer(event.myStatus === "going" ? null : "going")}
            >
              I&apos;m going
            </button>{" "}
            <button
              type="button"
              aria-pressed={event.myStatus === "maybe"}
              onClick={() => void answer(event.myStatus === "maybe" ? null : "maybe")}
            >
              Maybe
            </button>
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <p data-event-counts="">
        {event.going} going, {event.maybe} maybe
      </p>
      <PhotoGrid cards={event.attendees} empty="Nobody is going yet" />

      <p>
        {event.canEdit && !started && (
          <>
            <Link href={`/events/${event.id}/edit`}>Edit</Link>{" "}
          </>
        )}
        {event.canEdit && !event.cancelled && (
          <>
            <button type="button" onClick={() => void onCancel()}>
              Cancel event
            </button>{" "}
          </>
        )}
        <ReportLink targetType="event" targetId={event.id} />
      </p>
      <p>
        <Link href="/events">Back to events</Link>
      </p>
    </Box>
  );
}
