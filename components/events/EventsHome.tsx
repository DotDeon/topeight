"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatEventTime, formatShowDate } from "@/lib/eventTime";
import { Box } from "../Box";
import styles from "./Events.module.css";

type Item = NonNullable<ReturnType<typeof useQuery<typeof api.events.upcoming>>>["items"][number];

const DEBOUNCE_MS = 300;

function Row({ item }: { item: Item }) {
  if (item.kind === "show") {
    return (
      <div className={styles.item} data-show-item="">
        <span className={styles.tag}>Show</span>
        <Link href={`/${item.artist.username}`}>
          <b>{item.artist.displayName}</b>
        </Link>
        <br />
        {formatShowDate(item.date)}
        <br />
        {item.venue}, {item.city}
      </div>
    );
  }
  return (
    <div className={styles.item} data-event-item="">
      <Link href={`/events/${item.id}`}>
        <b>{item.title}</b>
      </Link>{" "}
      {item.cancelled && <span className={styles.cancelled}>Cancelled</span>}
      <br />
      {formatEventTime(item.startsAt, item.timeZone)}
      <br />
      {item.lineup.length > 0 && (
        <>
          With{" "}
          {item.lineup.map((band, i) => (
            <span key={band.username}>
              {i > 0 && ", "}
              <Link href={`/${band.username}`}>{band.displayName}</Link>
            </span>
          ))}
          <br />
        </>
      )}
      {item.venue}, {item.city}. Hosted by <Link href={`/${item.host.username}`}>{item.host.displayName}</Link>,{" "}
      {item.going} going
    </div>
  );
}

function Page({
  city,
  cursor,
  first,
  onMore,
}: {
  city: string;
  cursor: { startsAt: number; skip: number } | null;
  first: boolean;
  onMore: (c: { startsAt: number; skip: number }) => void;
}) {
  const res = useQuery(api.events.upcoming, { ...(city ? { city } : {}), ...(cursor ? { cursor } : {}) });
  if (res === undefined) return <p className={styles.muted}>Loading...</p>;
  return (
    <>
      {first && res.items.length === 0 && res.nextCursor === null && (
        <p className={styles.muted}>{city ? "No upcoming events in that city." : "No upcoming events."}</p>
      )}
      {res.items.map((item) => (
        <Row key={`${item.kind}-${item.id}`} item={item} />
      ))}
      {res.nextCursor !== null && (
        <p>
          <button type="button" onClick={() => onMore(res.nextCursor!)}>
            Load More
          </button>
        </p>
      )}
    </>
  );
}

function Mine() {
  const mine = useQuery(api.events.myEvents, {});
  if (!mine || mine.length === 0) return null;
  return (
    <>
      <h5>My events</h5>
      {mine.map((e) => (
        <p key={e.id} data-my-event="">
          <Link href={`/events/${e.id}`}>{e.title}</Link>, {formatEventTime(e.startsAt, e.timeZone)} ({e.role})
        </p>
      ))}
    </>
  );
}

/** /events: upcoming events and artist shows, a debounced city filter, and the viewer's own events. */
export function EventsHome() {
  const { isAuthenticated } = useConvexAuth();
  const [input, setInput] = useState("");
  const [city, setCity] = useState("");
  const [cursors, setCursors] = useState<({ startsAt: number; skip: number } | null)[]>([null]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = input.trim();
      setCity((prev) => {
        if (prev === next) return prev;
        setCursors([null]);
        return next;
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <Box title="Events">
      <p>
        {isAuthenticated ? <Link href="/events/new">Post an event</Link> : <Link href="/login">Log in</Link>}
        {!isAuthenticated && " to post an event"}
      </p>
      <p className={styles.filter}>
        <label>
          City: <input type="text" value={input} maxLength={100} onChange={(e) => setInput(e.target.value)} />
        </label>
      </p>
      {cursors.map((cursor, i) => (
        <Page
          key={`${city}|${cursor?.startsAt ?? "first"}|${cursor?.skip ?? 0}`}
          city={city}
          cursor={cursor}
          first={i === 0}
          onMore={(c) => setCursors((prev) => [...prev, c])}
        />
      ))}
      {isAuthenticated && <Mine />}
    </Box>
  );
}
