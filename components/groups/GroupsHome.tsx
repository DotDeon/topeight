"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import { Cursored } from "./Cursored";
import { GroupThumb } from "./GroupThumb";
import styles from "./Groups.module.css";

export const CATEGORY_LABEL = {
  music: "Music",
  local: "Local",
  hobbies: "Hobbies",
  fanclubs: "Fan clubs",
  other: "Other",
} as const;
type Category = keyof typeof CATEGORY_LABEL;

const DEBOUNCE_MS = 300;

function List({ category, q }: { category: Category | undefined; q: string }) {
  return (
    <Cursored
      resetKey={`${category ?? ""}|${q}`}
      empty={q ? "No groups match that search." : "No groups yet."}
      useQ={(cursor) =>
        // eslint-disable-next-line react-hooks/rules-of-hooks -- one stable hook call per page component
        useQuery(api.groups.list, { ...(category ? { category } : {}), ...(q ? { q } : {}), cursor })
      }
    >
      {(items) =>
        items.map((g) => (
          <div className={styles.row} key={g.id} data-group-item="">
            <GroupThumb name={g.name} photoUrl={g.photoUrl} />
            <div>
              <Link href={`/groups/${g.slug}`}>
                <b>{g.name}</b>
              </Link>{" "}
              ({CATEGORY_LABEL[g.category]}, {g.memberCount} {g.memberCount === 1 ? "member" : "members"})
              {(g.deleted || g.hidden) && <span className={styles.error}>{g.deleted ? "Deleted" : "Hidden"}</span>}
              <br />
              {g.description.slice(0, 160)}
            </div>
          </div>
        ))
      }
    </Cursored>
  );
}

/** /groups: the group directory with category tabs and a debounced name search. */
export function GroupsHome() {
  const { isAuthenticated } = useConvexAuth();
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <Box title="Groups">
      <p>
        {isAuthenticated ? <Link href="/groups/new">Start a group</Link> : <Link href="/login">Log in</Link>}
        {!isAuthenticated && " to start a group"}
      </p>
      <p className={styles.tabs}>
        <button type="button" className={category === undefined ? styles.tabOn : undefined} onClick={() => setCategory(undefined)}>
          All
        </button>{" "}
        {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
          <span key={c}>
            <button
              type="button"
              aria-pressed={category === c}
              className={category === c ? styles.tabOn : undefined}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>{" "}
          </span>
        ))}
      </p>
      <p className={styles.inline}>
        <label>
          Search groups: <input type="text" value={input} maxLength={100} onChange={(e) => setInput(e.target.value)} />
        </label>
      </p>
      <List category={category} q={q} />
    </Box>
  );
}
