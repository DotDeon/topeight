import Link from "next/link";
import styles from "./NavBar.module.css";

export const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "Browse", href: "/browse" },
  { label: "Search", href: "/search" },
  { label: "Invite", href: "/invite" },
  { label: "Mail", href: "/mail" },
  { label: "Blog", href: "/blog" },
  { label: "Favorites", href: "/favorites" },
  { label: "Groups", href: "/groups" },
  { label: "Events", href: "/events" },
  { label: "Music", href: "/browse?kind=artist" },
];

export function NavBar() {
  return (
    <nav className={styles.nav} aria-label="Main">
      {NAV_LINKS.map((l, i) => (
        <span key={l.label}>
          {i > 0 && " | "}
          <Link href={l.href}>{l.label}</Link>
        </span>
      ))}
    </nav>
  );
}
