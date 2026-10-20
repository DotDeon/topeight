"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { errorOrMessage, StatusLine, useSaver } from "./shared";

export function ShowsForm() {
  const shows = useQuery(api.shows.mine, {});
  const add = useMutation(api.shows.add);
  const remove = useMutation(api.shows.remove);
  const { status, busy, run } = useSaver();
  const [removeError, setRemoveError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(async () => {
      await add({ date: String(f.get("date")), venue: String(f.get("venue")), city: String(f.get("city")) });
      form.reset();
    }, "Show added");
  }

  return (
    <Box title="Shows" color="blue">
      {shows === undefined ? (
        <p className={styles.note}>Loading...</p>
      ) : shows.length === 0 ? (
        <p className={styles.note}>No upcoming shows.</p>
      ) : (
        <ul className={styles.list}>
          {shows.map((s) => (
            <li key={s.id} data-show="">
              <span>
                <b>{s.date}</b> {s.venue}, {s.city}
              </span>
              <button
                type="button"
                onClick={() => remove({ showId: s.id }).then(() => setRemoveError(""), (e) => setRemoveError(errorOrMessage(e)))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removeError && <p className={styles.error} role="alert">{removeError}</p>}
      <form onSubmit={onSubmit} aria-label="Add show">
        <div className={styles.row}>
          <label htmlFor="show-date">Date</label>
          <div className={styles.val}><input id="show-date" name="date" type="date" required /></div>
        </div>
        <div className={styles.row}>
          <label htmlFor="show-venue">Venue</label>
          <div className={styles.val}><input id="show-venue" name="venue" type="text" maxLength={100} required /></div>
        </div>
        <div className={styles.row}>
          <label htmlFor="show-city">City</label>
          <div className={styles.val}><input id="show-city" name="city" type="text" maxLength={100} required /></div>
        </div>
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>Add Show</button>
          <StatusLine status={status} />
        </div>
      </form>
    </Box>
  );
}
