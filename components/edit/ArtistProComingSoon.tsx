import { Box } from "../Box";
import styles from "./Edit.module.css";

export function ArtistProComingSoon() {
  return (
    <Box title="Artist Pro" color="blue">
      <p className={styles.note}>Artist Pro is coming soon. $5 a month.</p>
      <ul className={styles.proList}>
        <li>50 songs instead of 5</li>
        <li>Songs up to 15 MB at 192 kbps</li>
        <li>Play counts for each song</li>
        <li>A Pro star next to your name</li>
        <li>First in line for Cool New Music</li>
      </ul>
      <div className={styles.actions}>
        <button type="button" disabled>Go Pro (coming soon)</button>
      </div>
    </Box>
  );
}
