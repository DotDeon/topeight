import Link from "next/link";
import type { PublicCard } from "@/convex/lib/cards";
import { OnlineNow } from "./OnlineNow";
import styles from "./PhotoGrid.module.css";

/** A profile photo, or a plain tile with the first letter when there is none. */
export function Photo({ card, size = 90 }: { card: PublicCard; size?: number }) {
  const box = { width: size, height: size };
  if (card.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- user photos come from an external bucket
    return <img className={styles.ph} style={box} src={card.photoUrl} alt={card.displayName} />;
  }
  return (
    <span className={`${styles.ph} ${styles.blank}`} style={box} aria-hidden="true">
      {card.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Row of photos with names, each linking to the profile. `cards` is undefined while loading. */
export function PhotoGrid({
  cards,
  empty,
}: {
  cards: PublicCard[] | undefined;
  empty: string;
}) {
  if (cards === undefined) return <div className={styles.empty}>Loading...</div>;
  if (cards.length === 0) return <div className={styles.empty}>{empty}</div>;
  return (
    <div className={styles.people}>
      {cards.map((c) => (
        <div className={styles.p} key={c.username}>
          <Link href={`/${c.username}`}>
            <Photo card={c} />
            {c.displayName}
          </Link>
          {c.online && <OnlineNow />}
        </div>
      ))}
    </div>
  );
}
