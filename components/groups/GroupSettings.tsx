"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "@/lib/errorText";
import { Box } from "../Box";
import { useMediaUpload } from "../useMediaUpload";
import { Cursored } from "./Cursored";
import { GroupThumb } from "./GroupThumb";
import { CATEGORY_LABEL } from "./GroupsHome";
import styles from "./Groups.module.css";

type Category = keyof typeof CATEGORY_LABEL;

/** One small form: a username box and a button that runs `act` with the name. */
function UsernameAction({
  id,
  label,
  button,
  done,
  act,
}: {
  id: string;
  label: string;
  button: string;
  done: (name: string) => string;
  act: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await act(n);
      setStatus({ ok: true, text: done(n) });
      setName("");
    } catch (err) {
      setStatus({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.inline} onSubmit={onSubmit}>
      <label htmlFor={id}>{label}</label>{" "}
      <input id={id} type="text" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />{" "}
      <button type="submit" disabled={busy || name.trim() === ""}>
        {button}
      </button>
      {status && (
        <span className={status.ok ? styles.muted : styles.error} role={status.ok ? "status" : "alert"}>
          {" "}
          {status.text}
        </span>
      )}
    </form>
  );
}

function Banned({ slug, groupId }: { slug: string; groupId: Id<"groups"> }) {
  const unban = useMutation(api.groups.unbanMember);
  const [error, setError] = useState("");
  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Cursored
        empty="Nobody is banned"
        useQ={(cursor) =>
          // eslint-disable-next-line react-hooks/rules-of-hooks -- one stable hook call per page component
          useQuery(api.groups.bannedMembers, { slug, cursor })
        }
      >
        {(items) =>
          items.map((b) => (
            <p key={b.profileId} data-banned-row="">
              <Link href={`/${b.member.username}`}>{b.member.displayName}</Link> ({b.member.username}){" "}
              <button
                type="button"
                onClick={() => {
                  setError("");
                  unban({ groupId, profileId: b.profileId }).catch((e) => setError(errorText(e)));
                }}
              >
                Unban
              </button>
            </p>
          ))
        }
      </Cursored>
    </>
  );
}

function Details({ group }: { group: NonNullable<ReturnType<typeof useQuery<typeof api.groups.get>>> }) {
  const update = useMutation(api.groups.update);
  const upload = useMediaUpload();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [category, setCategory] = useState<Category>(group.category);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [photoStatus, setPhotoStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await update({ groupId: group.id, name, description, category });
      setStatus({ ok: true, text: "Saved" });
    } catch (err) {
      setStatus({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }
  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoStatus(null);
    try {
      await upload(file, { purpose: "groupPhoto", groupId: group.id });
      setPhotoStatus({ ok: true, text: "Photo uploaded. It shows up in a moment." });
    } catch (err) {
      setPhotoStatus({ ok: false, text: err instanceof Error && !("data" in err) ? err.message : errorText(err) });
    }
  }
  return (
    <>
      <form className={styles.form} onSubmit={onSave}>
        <label htmlFor="gs-name">Name:</label>
        <input id="gs-name" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="gs-cat">Category:</label>
        <select id="gs-cat" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <label htmlFor="gs-desc">Description:</label>
        <textarea
          id="gs-desc"
          rows={6}
          value={description}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p>
          <button type="submit" disabled={busy || name.trim().length < 3}>
            Save
          </button>
          {status && (
            <span className={status.ok ? styles.muted : styles.error} role={status.ok ? "status" : "alert"}>
              {" "}
              {status.text}
            </span>
          )}
        </p>
      </form>
      <div className={styles.head}>
        <GroupThumb name={group.name} photoUrl={group.photoUrl} big />
        <div>
          <label htmlFor="gs-photo">Group photo (JPEG, PNG, GIF or WebP, up to 2 MB):</label>
          <br />
          <input
            id="gs-photo"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => void onPhoto(e.target.files?.[0])}
          />
          {photoStatus && (
            <p className={photoStatus.ok ? styles.muted : styles.error} role={photoStatus.ok ? "status" : "alert"}>
              {photoStatus.text}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** /groups/[slug]/settings: owner only. Details, photo, hand over, ban and unban, delete. */
export function GroupSettings({ slug }: { slug: string }) {
  const router = useRouter();
  const group = useQuery(api.groups.get, { slug });
  const remove = useMutation(api.groups.remove);
  const handOver = useMutation(api.groups.handOver);
  const removeMember = useMutation(api.groups.removeMember);
  const ban = useMutation(api.groups.banMember);
  const [error, setError] = useState("");

  if (group === undefined) {
    return (
      <Box title="Group settings">
        <p className={styles.muted}>Loading...</p>
      </Box>
    );
  }
  if (group === null || !group.isOwner) {
    return (
      <Box title="Group settings">
        <p>You can&apos;t change this group</p>
        <p>
          <Link href="/groups">Back to groups</Link>
        </p>
      </Box>
    );
  }
  const g = group;
  async function onDelete() {
    if (!window.confirm("Delete this group? It disappears for everyone. An admin can restore it.")) return;
    setError("");
    try {
      await remove({ groupId: g.id });
      router.push("/groups");
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <Box title={`Settings for ${g.name}`}>
        <Details group={g} />
        <p>
          <Link href={`/groups/${g.slug}`}>Back to the group</Link>
        </p>
      </Box>
      <Box title="Members" color="blue">
        <UsernameAction
          id="gs-handover"
          label="Hand the group to (username):"
          button="Hand over"
          done={(n) => `${n} is the new owner`}
          act={(n) => handOver({ groupId: g.id, to: n })}
        />
        <UsernameAction
          id="gs-remove"
          label="Remove member (username):"
          button="Remove"
          done={(n) => `Removed ${n}`}
          act={(n) => removeMember({ groupId: g.id, username: n })}
        />
        <UsernameAction
          id="gs-ban"
          label="Ban a user by username:"
          button="Ban"
          done={(n) => `Banned ${n}`}
          act={(n) => ban({ groupId: g.id, username: n })}
        />
      </Box>
      <Box title="Banned members">
        <Banned slug={g.slug} groupId={g.id} />
      </Box>
      <Box title="Delete group">
        <p>
          <button type="button" onClick={() => void onDelete()}>
            Delete group
          </button>
          {error && (
            <span className={styles.error} role="alert">
              {" "}
              {error}
            </span>
          )}
        </p>
      </Box>
    </>
  );
}
