import type { ReactNode } from "react";
import styles from "./Box.module.css";

export function Box({
  title,
  color = "orange",
  children,
}: {
  title: string;
  color?: "orange" | "blue";
  children: ReactNode;
}) {
  return (
    <section className={styles.box}>
      <h4 className={color === "blue" ? styles.blue : styles.orange}>{title}</h4>
      <div className={styles.inner}>{children}</div>
    </section>
  );
}
