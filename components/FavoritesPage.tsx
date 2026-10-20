"use client";

import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Box } from "@/components/Box";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errorText";
import { Photo } from "./PhotoGrid";
import styles from "./Posts.module.css";

function Grid() {
  const cards = useQuery(api.favorites.list, {});
  const client = useConvex();
  const remove = useMutation(api.favorites.remove);
  const [error, setError] = useState("");
  if (cards === undefined) return <p className={styles.muted}>Loading...</p>;
  if (cards.length === 0) return <p className={styles.muted}>No Favorites yet</p>;
  async function take(username: string) {
    setError("");
    try {
      const id = await client.query(api.social.profileIdByUsername, { username });
      if (id !== null) await remove({ profileId: id });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {cards.map((c) => (
          <div key={c.username} data-favorite="" style={{ width: 100, textAlign: "center" }}>
            <Link href={`/${c.username}`}>
              <Photo card={c} />
              <br />
              {c.displayName}
            </Link>
            <br />
            <button type="button" onClick={() => void take(c.username)}>Remove</button>
          </div>
        ))}
      </div>
    </>
  );
}

export function FavoritesPage() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  return (
    <Box title="Favorites">
      {isLoading ? (
        <p className={styles.muted}>Loading...</p>
      ) : isAuthenticated ? (
        <Grid />
      ) : (
        <p className={styles.muted}>Log in to see your Favorites</p>
      )}
    </Box>
  );
}
