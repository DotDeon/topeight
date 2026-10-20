"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import { EventForm } from "./EventForm";
import styles from "./Events.module.css";

function Gate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <Box title="Events">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (!isAuthenticated || me === null || me === undefined || me.banned) {
    return (
      <Box title="Events">
        <p>
          <Link href="/login">Log in</Link> to post an event
        </p>
      </Box>
    );
  }
  return <>{children}</>;
}

export function NewEvent() {
  return (
    <Gate>
      <EventForm />
    </Gate>
  );
}

export function EditEvent({ id }: { id: string }) {
  const event = useQuery(api.events.get, { id });
  return (
    <Gate>
      {event === undefined ? (
        <p className={styles.muted}>Loading...</p>
      ) : event === null || !event.canEdit ? (
        <Box title="Edit event">
          <p>You can&apos;t edit this event</p>
        </Box>
      ) : (
        <EventForm
          eventId={event.id}
          initial={{
            title: event.title,
            localDate: event.localDate,
            localTime: event.localTime,
            timeZone: event.timeZone,
            venue: event.venue,
            city: event.city,
            description: event.description,
            imageUrl: event.imageUrl,
          }}
        />
      )}
    </Gate>
  );
}
