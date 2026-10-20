import Link from "next/link";
import styles from "./NavBar.module.css";

const soon = (name: string) => `/coming-soon?f=${name.toLowerCase()}`;

export const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "Browse", href: "/browse" },
  { label: "Search", href: "/search" },
  { label: "Invite", href: soon("Invite") },
  { label: "Mail", href: "/mail" },
  { label: "Blog", href: "/blog" },
  { label: "Favorites", href: "/favorites" },
  { label: "Forum", href: soon("Forum") },
  { label: "Groups", href: "/groups" },
  { label: "Events", href: "/events" },
  { label: "Music", href: "/browse?kind=artist" },
  { label: "Bulletins", href: "/bulletins" },
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
