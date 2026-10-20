"use client";

import { useState, type ReactNode } from "react";
import styles from "./Groups.module.css";

type PageResult<T> = { page: T[]; isDone: boolean; continueCursor: string };

function One<T>({
  useQ,
  cursor,
  first,
  children,
  empty,
  onMore,
}: {
  useQ: (cursor: string | null) => PageResult<T> | undefined;
  cursor: string | null;
  first: boolean;
  children: (items: T[]) => ReactNode;
  empty?: string;
  onMore: (c: string) => void;
}) {
  const res = useQ(cursor);
  if (res === undefined) return <p className={styles.muted}>Loading...</p>;
  return (
    <>
      {first && res.page.length === 0 && res.isDone && empty && <p className={styles.muted}>{empty}</p>}
      {children(res.page)}
      {!res.isDone && (
        <p>
          <button type="button" onClick={() => onMore(res.continueCursor)}>
            Load More
          </button>
        </p>
      )}
    </>
  );
}

/**
 * Stacked cursor pages for the groups reads: each page is its own live query and
 * Load More adds the next. `useQ` must be a stable hook wrapper (one useQuery call).
 * `children` renders one page's items. Keyed by `resetKey` so a new search starts over.
 */
export function Cursored<T>({
  useQ,
  children,
  empty,
  resetKey,
}: {
  useQ: (cursor: string | null) => PageResult<T> | undefined;
  children: (items: T[]) => ReactNode;
  empty?: string;
  resetKey?: string;
}) {
  const [state, setState] = useState<{ key: string | undefined; cursors: (string | null)[] }>({
    key: resetKey,
    cursors: [null],
  });
  const cursors = state.key === resetKey ? state.cursors : [null];
  return (
    <>
      {cursors.map((c, i) => (
        <One
          key={c ?? "first"}
          useQ={useQ}
          cursor={c}
          first={i === 0}
          empty={empty}
          onMore={(next) => setState({ key: resetKey, cursors: [...cursors, next] })}
        >
          {children}
        </One>
      ))}
    </>
  );
}

export function formatWhen(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
