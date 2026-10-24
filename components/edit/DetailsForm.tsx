"use client";

import { useMutation } from "convex/react";
import type { FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Box } from "../Box";
import styles from "./Edit.module.css";
import { StatusLine, useSaver } from "./shared";

const INTERESTS = [
  ["general", "General"],
  ["music", "Music"],
  ["movies", "Movies"],
  ["television", "Television"],
  ["books", "Books"],
  ["heroes", "Heroes"],
] as const;

export type DetailsArgs = {
  displayName: string;
  headline: string;
  location: string;
  aboutMe: string;
  whoIdLikeToMeet: string;
  gender?: string;
  genre?: string;
  interests?: NonNullable<Doc<"profiles">["interests"]>;
  band?: Doc<"profiles">["band"];
  address?: string;
  website?: string;
};

/** What the profile holds now, so one section can save without clearing another. */
export function currentDetails(me: Doc<"profiles">): DetailsArgs {
  return {
    displayName: me.displayName,
    headline: me.headline,
    location: me.location,
    aboutMe: me.aboutMe,
    whoIdLikeToMeet: me.whoIdLikeToMeet,
    gender: me.gender,
    genre: me.genre,
    interests: me.interests,
    band: me.band,
    address: me.address,
    website: me.website,
  };
}

export function DetailsForm({ me }: { me: Doc<"profiles"> }) {
  const update = useMutation(api.profiles.updateDetails);
  const { status, busy, run } = useSaver();
  const kind = me.kind;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (name: string) => String(f.get(name) ?? "");
    const args: DetailsArgs = {
      ...currentDetails(me),
      displayName: get("displayName"),
      headline: get("headline"),
      location: get("location"),
      aboutMe: get("aboutMe"),
      whoIdLikeToMeet: get("whoIdLikeToMeet"),
    };
    if (kind === "artist") args.genre = get("genre");
    else if (kind === "venue") args.address = get("address");
    else if (kind === "label") {
      args.genre = get("genre");
      args.website = get("website");
    } else {
      args.gender = get("gender");
      args.interests = {
        general: get("general"),
        music: get("music"),
        movies: get("movies"),
        television: get("television"),
        books: get("books"),
        heroes: get("heroes"),
      };
    }
    void run(() => update(args));
  }

  const text = (name: string, label: string, value: string, max: number) => (
    <div className={styles.row}>
      <label htmlFor={`d-${name}`}>{label}</label>
      <div className={styles.val}>
        <input id={`d-${name}`} name={name} type="text" defaultValue={value} maxLength={max} />
      </div>
    </div>
  );
  const area = (name: string, label: string, value: string, max: number, rows = 5) => (
    <div className={styles.row}>
      <label htmlFor={`d-${name}`}>{label}</label>
      <div className={styles.val}>
        <textarea id={`d-${name}`} name={name} rows={rows} defaultValue={value} maxLength={max} />
      </div>
    </div>
  );

  return (
    <Box title="Profile Details" color="orange">
      <form onSubmit={onSubmit} aria-label="Profile details">
        <div className={styles.row}>
          <label htmlFor="d-displayName">Display Name</label>
          <div className={styles.val}>
            <input id="d-displayName" name="displayName" type="text" defaultValue={me.displayName} maxLength={50} required />
          </div>
        </div>
        {text("headline", "Headline", me.headline, 100)}
        {text("location", kind === "venue" ? "City" : "Location", me.location, 100)}
        {kind === "fan" && text("gender", "Gender", me.gender ?? "", 50)}
        {(kind === "artist" || kind === "label") && text("genre", kind === "label" ? "Genres" : "Genre", me.genre ?? "", 50)}
        {kind === "venue" && area("address", "Address", me.address ?? "", 500, 2)}
        {kind === "label" && text("website", "Website", me.website ?? "", 200)}
        {area("aboutMe", "About Me", me.aboutMe, 5000)}
        {area("whoIdLikeToMeet", "Who I'd like to meet", me.whoIdLikeToMeet, 5000)}
        {kind === "fan" &&
          INTERESTS.map(([key, label]) => area(key, label, me.interests?.[key] ?? "", 500, 2))}
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>Save Details</button>
          <StatusLine status={status} />
        </div>
      </form>
    </Box>
  );
}

const BAND = [
  ["members", "Band Members"],
  ["influences", "Influences"],
  ["soundsLike", "Sounds Like"],
  ["recordLabel", "Record Label"],
  ["labelType", "Type of Label"],
] as const;

export function BandForm({ me }: { me: Doc<"profiles"> }) {
  const update = useMutation(api.profiles.updateDetails);
  const { status, busy, run } = useSaver();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (name: string) => String(f.get(name) ?? "");
    const band = {
      members: get("members"),
      influences: get("influences"),
      soundsLike: get("soundsLike"),
      recordLabel: get("recordLabel"),
      labelType: get("labelType"),
    };
    void run(() => update({ ...currentDetails(me), band }));
  }

  return (
    <Box title="Band Details" color="blue">
      <form onSubmit={onSubmit} aria-label="Band details">
        {BAND.map(([key, label]) => (
          <div className={styles.row} key={key}>
            <label htmlFor={`b-${key}`}>{label}</label>
            <div className={styles.val}>
              <textarea id={`b-${key}`} name={key} rows={2} defaultValue={me.band?.[key] ?? ""} maxLength={500} />
            </div>
          </div>
        ))}
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>Save Band Details</button>
          <StatusLine status={status} />
        </div>
      </form>
    </Box>
  );
}
