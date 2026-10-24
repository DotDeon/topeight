"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import { renderProfileDocument } from "@/lib/profile/render";
import { Box } from "../Box";
import { useMinute } from "../useMinute";
import styles from "./Edit.module.css";
import { StatusLine, useSaver } from "./shared";

const MAX_BYTES = 100 * 1024;
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

export function CodeEditor({ me }: { me: Doc<"profiles"> }) {
  // Artists, venues and labels get HTML and JS. Fans get CSS only.
  const artist = me.kind !== "fan";
  const save = useMutation(api.profiles.updateCustomCode);
  const asOf = useMinute();
  const profile = useQuery(api.profiles.getPublicProfile, { username: me.username, asOf });
  const playbackUrls = useAction(api.media.playbackUrls);
  const { status, busy, run } = useSaver();
  const [css, setCss] = useState(me.customCss);
  const [html, setHtml] = useState(me.customHtml);
  const [js, setJs] = useState(me.customJs);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [tracksFailed, setTracksFailed] = useState(false);

  const total = bytes(css) + (artist ? bytes(html) + bytes(js) : 0);
  const over = total > MAX_BYTES;

  async function preview() {
    if (!profile || "unavailable" in profile || "restricted" in profile) return;
    const mainOrigin = process.env.NEXT_PUBLIC_MAIN_ORIGIN ?? window.location.origin;
    const usercontentOrigin = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN ?? "";
    // The same policy the usercontent route sends, minus frame-ancestors, which a meta tag ignores.
    const cspMeta = buildUsercontentCsp(usercontentOrigin);
    // Track URLs are signed on demand, like the usercontent route does. No URLs, no player.
    let failed = false;
    const signed = artist
      ? await playbackUrls({ username: me.username }).catch(() => {
          failed = true;
          return [];
        })
      : [];
    setTracksFailed(failed);
    const urls = new Map<string, string>(signed.map((t) => [t.id, t.url]));
    const tracks = profile.tracks.map((t) => ({ ...t, url: urls.get(t.id) ?? null }));
    setSrcDoc(
      renderProfileDocument(
        { ...profile, tracks, custom: { css, html: artist ? html : "", js: artist ? js : "" } },
        { mainOrigin, cspMeta, usercontentOrigin: usercontentOrigin || undefined },
      ),
    );
  }

  const area = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className={styles.row}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.val}>
        <textarea id={id} className={styles.code} rows={10} value={value} spellCheck={false} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  );

  return (
    <Box title="Custom Code" color="orange">
      <form
        aria-label="Custom code"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => save({ css, html: artist ? html : "", js: artist ? js : "" }));
        }}
      >
        {!artist && <p className={styles.note}>Fan profiles can use CSS only.</p>}
        {artist && area("code-html", "HTML", html, setHtml)}
        {area("code-css", "CSS", css, setCss)}
        {artist && area("code-js", "JavaScript", js, setJs)}
        <p className={`${styles.counter} ${over ? styles.over : ""}`} data-code-bytes="">
          {total.toLocaleString("en-US")} / {MAX_BYTES.toLocaleString("en-US")} bytes
        </p>
        <div className={styles.actions}>
          <button type="submit" disabled={busy || over}>Save Code</button>
          <button type="button" onClick={() => void preview()} disabled={!profile || "unavailable" in profile}>Preview</button>
          <StatusLine status={status} />
        </div>
      </form>
      {srcDoc !== null && tracksFailed && <p className={styles.note}>Tracks unavailable in preview</p>}
      {srcDoc !== null && (
        <iframe
          className={styles.preview}
          title="Profile preview"
          sandbox="allow-scripts allow-popups"
          allow="autoplay"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
        />
      )}
    </Box>
  );
}
