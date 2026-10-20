"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import { CATEGORY_LABEL } from "./GroupsHome";
import styles from "./Groups.module.css";

type Category = keyof typeof CATEGORY_LABEL;

function Form() {
  const router = useRouter();
  const create = useMutation(api.groups.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("music");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { slug } = await create({ name, description, category });
      router.push(`/groups/${slug}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Box title="Start a group">
      <form className={styles.form} onSubmit={onSubmit}>
        <label htmlFor="g-name">Name:</label>
        <input id="g-name" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="g-cat">Category:</label>
        <select id="g-cat" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <label htmlFor="g-desc">Description:</label>
        <textarea
          id="g-desc"
          rows={6}
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p>
          <button type="submit" disabled={busy || name.trim().length < 3}>
            Create group
          </button>
          {error && (
            <span className={styles.error} role="alert">
              {error}
            </span>
          )}
        </p>
      </form>
    </Box>
  );
}

/** /groups/new: needs a signed-in member. The server says if the account is too new. */
export function NewGroup() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <Box title="Groups">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (!isAuthenticated || !me || me.banned) {
    return (
      <Box title="Groups">
        <p>
          <Link href="/login">Log in</Link> to start a group
        </p>
      </Box>
    );
  }
  return <Form />;
}
