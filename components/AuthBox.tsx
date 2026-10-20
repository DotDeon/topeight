import type { ReactNode } from "react";
import styles from "./AuthBox.module.css";

export { styles as authStyles };

/** A plain classic login box. The root layout supplies the site chrome. */
export function AuthBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.box}>
        <div className={styles.title}>{title}</div>
        <div className={styles.body}>{children}</div>
      </div>
    </main>
  );
}

/**
 * Convex Auth passes raw params to the email provider, which stores the
 * address on the user, so normalize before calling signIn.
 */
export function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim().toLowerCase();
}
