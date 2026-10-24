"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { LinkCard } from "@/convex/links";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { PersonList, type Person } from "./FriendsAndBlocking";

const person = (c: LinkCard): Person => ({ id: c.id, card: c });

/**
 * Venues: the bands on their roster and requests waiting. Labels: the same for
 * their bands. Artists: the venues and labels they said yes to. Each can be removed.
 */
export function LinksForm({ kind }: { kind: Doc<"profiles">["kind"] }) {
  const links = useQuery(api.links.mine, {});
  const remove = useMutation(api.links.remove);
  if (kind === "fan") return null;
  const title = kind === "venue" ? "Our roster" : kind === "label" ? "Our bands" : "Venues and labels";
  const drop = (what: string) => async (p: Person) => {
    if (!confirm(what.replace("%s", p.card.displayName))) return;
    await remove({ other: p.id });
  };

  return (
    <Box title={title} color="blue">
      {links === undefined ? (
        <p className={styles.note}>Loading...</p>
      ) : kind === "artist" ? (
        <>
          <h3 className={styles.title}>Venues</h3>
          <PersonList
            label="Venues"
            people={links.venues.map(person)}
            empty="No venues yet. A venue can ask you onto its roster from your profile."
            action="Leave roster"
            onAction={drop("Leave %s's roster? You'll come off their gigs that haven't started.")}
          />
          <h3 className={styles.title}>Labels</h3>
          <PersonList
            label="Labels"
            people={links.labels.map(person)}
            empty="No labels yet"
            action="Remove"
            onAction={drop("Remove %s as your label?")}
          />
        </>
      ) : (
        <>
          <p className={styles.note}>
            To add a band, open its profile and click{" "}
            {kind === "venue" ? "Add to our roster" : "Add to our label"}. The band has to say yes.
          </p>
          <PersonList
            label={title}
            people={links.roster.map(person)}
            empty="No bands yet"
            action="Remove"
            onAction={drop(
              kind === "venue"
                ? "Take %s off your roster? They'll come off your gigs that haven't started."
                : "Remove %s from your label?",
            )}
          />
          <h3 className={styles.title}>Waiting for an answer</h3>
          <PersonList
            label="Waiting for an answer"
            people={links.outgoing.map(person)}
            empty="No requests waiting"
            action="Withdraw"
            onAction={drop("Withdraw your request to %s?")}
          />
        </>
      )}
    </Box>
  );
}
