"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { unreadBadge } from "@/lib/mailText";
import { Box } from "../Box";
import styles from "./Mail.module.css";

const LINKS = [
  { href: "/mail", label: "Inbox" },
  { href: "/mail/sent", label: "Sent" },
  { href: "/mail/compose", label: "Compose" },
] as const;

/** The mail center frame: left links and the page. Sends signed-out visitors to the login page. */
export function MailShell({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const path = usePathname();
  const unread = useQuery(api.mail.unreadCount, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <Box title="Mail Center">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  const badge = unread === undefined ? "" : unreadBadge(unread);
  return (
    <div className={styles.layout}>
      <nav className={styles.side} aria-label="Mail">
        <h4>Mail Center</h4>
        <ul>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={path === l.href ? styles.current : undefined}>
                {l.label}
              </Link>
              {l.href === "/mail" && badge !== "" && <span data-unread-badge=""> ({badge})</span>}
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.main}>{children}</div>
    </div>
  );
}
