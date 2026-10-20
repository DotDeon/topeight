# TopEight 2007 features implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile mood, Online Now!, profile songs for everyone and private profiles.

**Architecture:** Same Next.js 16 + Convex app. Mood and presence add small fields/tables and render in the sandboxed profile document. Profile songs reuse the private audio bucket, signed playback and the bridge confirm pattern from song reports. Private profiles gate every friends-only read on the server and add a signed, time-limited frame pass so the usercontent route can tell an allowed render from a direct fetch.

**Tech stack:** Next.js 16, Convex, `@convex-dev/rate-limiter`, Vitest, convex-test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-topeight-2007-features-design.md` (binding).

## Global constraints

- Base constraints still hold: classic 2006 look, bounded reads, `requireProfile` on writes, "Slow down" rate limits after validation, text only through the shared safe renderer, no em dashes in UI copy, local-only guarded fixtures, bans and blocks respected (a blocked pair counts as not friends).
- Bridge messages from the frame are untrusted; the parent validates and the server re-validates. State changes need a parent confirm.
- Original artwork only (the Online Now! badge is new CSS/SVG).
- Checks: `npm test`, `npx tsc --noEmit`, `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build`, e2e `PORT=3100 E2E_NEXT_ONLY=1 npm run test:e2e` (stop the dev server on 3100 first, restart after). The Convex dev watcher pushes automatically (log `/tmp/convex-dev.log`).

## Review focus

1. A stranger reading any part of a private profile: frame address without a pass, an expired or forged pass, a pass for another profile, the comments/friends/blog pages, `?format=tracks`, latest bulletin, Top 8 cards, search results beyond name and photo. Tests in Tasks 5 and 6.
2. Frame JS making someone else's profile song change without a parent click, or picking a track whose artist turned sharing off. Tests in Tasks 3 and 4.
3. Presence leaking when "Show when I'm online" is off. Test in Task 2.
4. A profile song still playing after the track is deleted, the artist is banned or sharing is off. Test in Task 3.
5. Mood text rendered unsafely in the profile document. Test in Task 1.

---

### Task 1: Profile mood

**Files:** Modify `convex/schema.ts` (`profiles.mood?: { icon: MoodIcon; text: string }`), `convex/profiles.ts` (`setMood`, `getPublicProfile` adds `mood`), `lib/profile/render.ts` (mood line under the headline), `components/edit/*` (mood field), `components/HomeMember.tsx` (quick "Update your mood" box). Test: `tests/convex/mood.test.ts`, `tests/render.test.ts`, `e2e/mood.spec.ts`.

**Interfaces:** `api.profiles.setMood({ icon?: MoodIcon | null, text?: string })` — null icon clears the mood; text trimmed, ≤ 40 chars ("Mood is too long"); `mood` limit 30/hour. `PublicProfile.mood?: { icon: string; text: string } | null`. The renderer shows `Mood: <inline svg icon> <escaped text>`; the SVG markup comes from a shared `lib/moodSvg.ts` used by both React and the renderer.

- [ ] **Step 1: Write failing tests**: setMood validation, limit, clear; render escapes mood text and shows the icon; e2e sets a mood from the homepage box and sees it on the profile frame.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** Move the 20 face drawings into `lib/moodSvg.ts` (string SVG per id) and make `components/MoodIcon.tsx` render from it, so the two never drift.
- [ ] **Step 4: Run** all checks, expect PASS.
- [ ] **Step 5: Commit** `feat: profile mood`

### Task 2: Online Now!

**Files:** Modify `convex/schema.ts` (`presence` { profileId, lastSeenAt } index `by_profile`; `profiles.showOnline?: boolean`), `convex/profiles.ts`, `convex/lib/cards.ts` (`PublicCard.online?: boolean`), `lib/profile/render.ts`, `components/PhotoGrid.tsx` and friend grids, `app/layout.tsx` or a client `PresenceHeartbeat` component, `components/edit/*`. Create `convex/presence.ts`. Test: `tests/convex/presence.test.ts`, `tests/render.test.ts`.

**Interfaces:** `api.presence.heartbeat()` (signed-in, profile required; no-op and deletes the row when `showOnline === false`; limit `heartbeat` 2/min, silently ignored when limited); `api.presence.setShowOnline({ value })` (deleting the row when false); helper `isOnline(ctx, profile, now)` in `convex/lib/presence.ts` (true only when `showOnline !== false` and `lastSeenAt` within 5 minutes). `PublicProfile.online: boolean`; cards gain `online`. The heartbeat client sends on mount and every 2 minutes while `document.visibilityState === "visible"`.

- [ ] **Step 1: Write failing tests**: heartbeat writes only presence (profile doc unchanged); online within 5 min, offline after; setting off deletes and hides; limit; render shows the badge only when online; cards report online.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** Badge: orange rounded box with a small person icon and "Online Now!", original CSS/SVG.
- [ ] **Step 4: Run** all checks, expect PASS.
- [ ] **Step 5: Commit** `feat: online now`

### Task 3: Profile song backend

**Files:** Modify `convex/schema.ts` (`profiles.profileSong?: Id<"tracks">`, `profiles.shareSongs?: boolean`, index `by_profile_song` on `profileSong`), `convex/media.ts` (`playbackUrls` and the tracks refresh include the profile song), `convex/profiles.ts` (`getPublicProfile` adds `profileSong`), `convex/moderation.ts` (ban effects need nothing new; verify), `lib/profile/render.ts` (fan player shows the one song with "title by artist", artist player puts a picked song first). Create `convex/profileSongs.ts`. Test: `tests/convex/profileSongs.test.ts`, `tests/render.test.ts`, `tests/convex/playback.test.ts`.

**Interfaces:** `api.profileSongs.pick({ trackId })` ("Song not available" when the track is missing, the artist is banned or sharing is off; limit `songPick` 20/hour); `clear()`; `setShareSongs({ value })` (artists only); `usageCount() -> number` (artist's songs picked, bounded count up to 1000 via the index, "1000+" above). `PublicProfile.profileSong?: { id, title, artist: PublicCard } | null` resolved at read time with the same availability rule. Playback: the profile's signed URLs include the profile song's track (signed against the artist's key) only when available.

- [ ] **Step 1: Write failing tests**: pick/clear; unavailable cases at pick and at read (deleted, banned artist, sharing off, sharing back on restores); usage count; signed URL included only when available; render for fan and artist players with escaping.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks, expect PASS.
- [ ] **Step 5: Commit** `feat: profile song backend`

### Task 4: Profile song UI

**Files:** Modify `lib/bridge-protocol.ts` (`{ type: "topeight:pickSong"; trackId: string }`), `lib/bridge.ts`, `lib/profile/render.ts` ("Add to my profile" link per track with `data-topeight-pick-track`), `components/ProfileView.tsx`, `components/profileActions.ts`, `components/edit/*` (current profile song with Remove; artists: "Let people use my songs as profile songs" toggle and "Your songs are on N profiles"). Test: `tests/bridge.test.ts`, `e2e/profile-song.spec.ts`.

- [ ] **Step 1: Write failing tests**: parser accepts pickSong with a valid id and rejects bad ones; the parent ignores ids not in its own server-loaded track list (reuse `findReportableTrack`); e2e: a fan clicks "Add to my profile" on an artist's track, confirms in the parent dialog ("Make "<title>" by <artist> your profile song?"), and their profile frame shows "<title> by <artist>"; artist turns sharing off and the fan's player disappears.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** through BridgeGate and ConfirmDialog like reportTrack.
- [ ] **Step 4: Run** all checks and e2e, expect PASS.
- [ ] **Step 5: Commit** `feat: profile songs`

### Task 5: Private profile backend and frame pass

**Files:** Modify `convex/schema.ts` (`profiles.private?: boolean`), `convex/profiles.ts` (`setPrivate`, `becomeArtist` clears it, `getPublicProfile` and `profileHeader` gain `private` and a restricted shape), `convex/comments.ts`, `convex/social.ts` (`listFriends`), `convex/blog.ts` (`listByUser`, `get`, `comments`), `convex/media.ts` (tracks), `app/usercontent/[username]/route.ts`. Create `convex/lib/framePass.ts`, `convex/framePass.ts`. Test: `tests/convex/private.test.ts`, `tests/framePass.test.ts`, `tests/usercontentRoute.test.ts`.

**Interfaces:**
- `canSeeFull(ctx, viewerProfile | null, target) -> boolean`: true when the target isn't private, the viewer is the owner, a friend (and not blocked either way), or an admin.
- Frame pass: `signFramePass(profileId, expiresAt, secret) -> string` and `verifyFramePass(token, profileId, now, secret) -> boolean` using HMAC-SHA256 (Web Crypto) over `profileId.expiresAt`, base64url; secret from env `FRAME_PASS_SECRET` (documented in `.env.example` and `docs/deploy.md`; missing secret means private profiles never render in the frame). `api.framePass.issue({ username }) -> string | null` returns a pass valid 2 hours only when `canSeeFull` for a private profile, and null for public profiles (no pass needed).
- The usercontent route and `?format=tracks` accept `?pass=`; for private profiles they render or answer only with a valid pass, otherwise 404. Public profiles ignore the pass.
- Private profile, non-allowed viewer: `getPublicProfile` returns `{ restricted: true, displayName, photoUrl, age?, location, mood, online }`; comments, friends list, blog list/get/comments, latest bulletin, Top 8, profile song and track URLs return empty or not-found shapes. Search and browse still list name and photo.
- `setPrivate({ value })`: fans only ("Artists can't make their page private").

- [ ] **Step 1: Write failing tests** for every gated read (stranger, friend, owner, admin, blocked friend), pass sign/verify (valid, expired, wrong profile, tampered, missing secret), route behavior with and without a pass, `becomeArtist` clearing the flag.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks, expect PASS.
- [ ] **Step 5: Commit** `feat: private profiles backend`

### Task 6: Private profile UI

**Files:** Modify `app/[username]/page.tsx`, `components/ProfileView.tsx`, `components/ProfileFrame.tsx` (adds `?pass=` to the frame address; the in-frame tracks refresh passes it through), `lib/profile/render.ts` (refresh includes the pass from its own URL), `app/[username]/comments/page.tsx`, `app/[username]/friends/page.tsx`, `app/[username]/blog/*`, `components/edit/*` (Private profile toggle, hidden for artists). Test: `e2e/private.spec.ts`.

- [ ] **Step 1: Write e2e test**: a fixture fan turns private on; a signed-out visitor and a non-friend see the private card with Add to Friends, Send Message and Report, and the comments/friends/blog pages show the private notice; fetching the usercontent address directly returns 404; a friend sees the full frame; turning private off restores it.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** The private card uses the classic left-column look (photo, details, mood, Online Now!) with the note "This profile is set to private. Add <name> as a friend to see more."
- [ ] **Step 4: Run** all checks and e2e, expect PASS.
- [ ] **Step 5: Commit** `feat: private profiles`
