"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Box } from "@/components/Box";
import { api } from "@/convex/_generated/api";
import styles from "./Home.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-24" as "24 Oct", without going through a timezone. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function UpcomingShows() {
  const shows = useQuery(api.shows.upcoming, { limit: 5 });
  return (
    <Box title="Upcoming Shows" color="blue">
      {shows === undefined ? (
        <span className={styles.muted}>Loading...</span>
      ) : shows.length === 0 ? (
        <span className={styles.muted}>No upcoming shows</span>
      ) : (
        <ul className={styles.list}>
          {shows.map((s, i) => (
            <li key={i}>
              <Link href={`/${s.artist.username}`}><b>{s.artist.displayName}</b></Link>{" "}
              {shortDate(s.date)}, {s.city}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
