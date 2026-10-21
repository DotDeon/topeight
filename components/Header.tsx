import Image from "next/image";
import Link from "next/link";
import { HeaderAuthLinks } from "./HeaderAuthLinks";
import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
      <Link href="/" className={styles.logo}>
        <Image src="/brand/topeight-logo.svg" alt="TopEight" width={179} height={34} unoptimized priority className={styles.mark} />
      </Link>
      <span className={styles.small}>remember when the internet was fun?</span>
      </div>
      <div className={styles.right}>
        <HeaderAuthLinks />
        <form action="/search" method="get" className={styles.search}>
          <div>
            <label>
              <input type="radio" name="type" value="topeight" defaultChecked /> TopEight
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
