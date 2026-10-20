import Link from "next/link";
import { supportUrl } from "@/lib/supportUrl";
import styles from "./Footer.module.css";

const LINKS = [
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Safety Tips", href: "/safety" },
  { label: "Contact TopEight", href: "/about#contact" },
  { label: "Report Abuse", href: "/safety#report" },
];

export function Footer() {
  const support = supportUrl(process.env.NEXT_PUBLIC_SUPPORT_URL);
  return (
    <footer className={styles.footer}>
      {LINKS.map((l, i) => (
        <span key={l.label}>
          {i > 0 && " | "}
          <Link href={l.href}>{l.label}</Link>
        </span>
      ))}
      {support && (
        <>
          {" | "}
          <a href={support} target="_blank" rel="noopener noreferrer">Support TopEight</a>
        </>
      )}
    </footer>
  );
}
