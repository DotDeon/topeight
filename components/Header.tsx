import Link from "next/link";
import { HeaderAuthLinks } from "./HeaderAuthLinks";
import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.logo}>
        <span className={styles.big}>OpenSpace</span>
        <span className={styles.small}>a place for friends</span>
      </Link>
      <div className={styles.right}>
        <HeaderAuthLinks />
        <form action="/search" method="get" className={styles.search}>
          <div>
            <label>
              <input type="radio" name="type" value="openspace" defaultChecked /> OpenSpace
            </label>{" "}
            <label>
              <input type="radio" name="type" value="people" /> People
            </label>{" "}
            <label>
              <input type="radio" name="type" value="music" /> Music
            </label>
          </div>
          <input type="text" name="q" aria-label="Search terms" />{" "}
          <button type="submit">Search</button>
        </form>
      </div>
    </header>
  );
}
