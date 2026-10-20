import styles from "./Groups.module.css";

/** A group photo, or a plain tile with the first letter. */
export function GroupThumb({ name, photoUrl, big = false }: { name: string; photoUrl: string | null; big?: boolean }) {
  const size = big ? `${styles.thumb} ${styles.thumbBig}` : styles.thumb;
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- group photos come from an external bucket
    return <img className={size} src={photoUrl} alt={name} />;
  }
  return (
    <span className={`${size} ${styles.blank}`} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
