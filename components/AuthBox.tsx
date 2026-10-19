import type { ReactNode } from "react";
import { ConvexError } from "convex/values";
import styles from "./AuthBox.module.css";

export { styles as authStyles };

/** A plain classic login box. Task 4 adds the full site chrome around it. */
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

/** User-facing text for an error thrown by a Convex function. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return fallback;
}

/**
 * Convex Auth passes raw params to the email provider, which stores the
 * address on the user, so normalize before calling signIn.
 */
export function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim().toLowerCase();
}
