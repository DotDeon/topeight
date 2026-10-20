# OpenSpace follow-ups implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four launch-scope gaps: per-song reports, Remove Friend and Unblock UI, homepage boxes that never run dry, and a view counter that scales.

**Architecture:** Same app. Song reports reuse the trusted bridge and ConfirmDialog. Friend and block management reuse existing `social` mutations. Homepage boxes switch from capped scans to denormalised `hasPhoto` / `hasTracks` flags with indexes. The anonymous view bucket becomes sharded.

**Tech stack:** Next.js 16 (`proxy.ts`), Convex, `@convex-dev/rate-limiter`, Vitest, convex-test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-openspace-design.md`, plus the scope the owner approved in chat on 2026-10-20 (quoted in "Approved scope" below).

## Approved scope

1. Each track in the profile player gets a Report link. It opens OpenSpace's own report dialog showing the song title from the server, not from artist code. The server checks the song belongs to that profile. The admin queue shows the song with Play and Delete.
2. On a friend's profile the trusted strip shows "Remove from Friends" instead of "Add to Friends", with a confirm. Edit Profile gets a "Friends and blocking" section listing friends with Remove and blocked people with Unblock.
3. Profiles get `hasPhoto` and `hasTracks` flags with indexes. Cool New People and Cool New Music read only matching accounts, so the 200-row cap goes. Existing rows are backfilled once.
4. The anonymous view bucket is split across 10 shards. Limits stay at 60/min per signed-in viewer and 600/min anonymous.

## Global constraints

- All rules in `docs/superpowers/plans/2026-10-19-openspace.md` "Global constraints" still apply (sandbox flags, CSP, limits, copy rules).
- Everything from the iframe is untrusted. The parent validates every field; the server re-validates.
- Bridge messages: existing union in `lib/bridge-protocol.ts`, extended only as Task 1 states.
- Error strings: reuse existing ones ("Not allowed", "Profile not found", "Slow down") unless a task names a new one.
- Writing: sentence case, no em dashes in UI copy.
- Local dev: PORT=3100, local Convex backend; fixtures stay local-only behind `OPENSPACE_TEST_FIXTURES`.

## Review focus

1. Artist JS sending `openspace:reportTrack` with a track id from another profile must be refused by the parent and by the server. Test in Task 1.
2. The strip must not show "Remove from Friends" to signed-out visitors or on your own profile. Test in Task 2.
3. A photo or track deleted, a profile banned, or a fan switching to artist must keep `hasPhoto` / `hasTracks` correct. Test in Task 3.
4. The backfill must be idempotent and bounded per run. Test in Task 3.
5. Sharding must not change the per-viewer limit or make the anonymous limit leak above 600/min in aggregate. Test in Task 4.

---

### Task 1: Report a song

**Files:**
- Modify: `lib/bridge-protocol.ts`, `lib/bridge.ts`, `lib/profile/render.ts`, `convex/profiles.ts` (tracks in `getPublicProfile` gain `id`), `components/ProfileView.tsx`, `components/profileActions.ts`, `convex/moderation.ts`, `components/AdminQueue.tsx`
- Test: `tests/bridge.test.ts`, `tests/render.test.ts`, `tests/convex/moderation.test.ts`, `e2e/sandbox.spec.ts`

**Interfaces:**
- Produces: bridge message `{ type: "openspace:reportTrack"; trackId: string }`; `PublicProfile.tracks[i].id: string`; `parseBridgeMessage` accepts it when `trackId` is a non-empty string of at most 64 chars; `window.openspace.reportTrack(trackId)` in the frame; `api.moderation.report` already accepts `targetType: "track"` and must reject a track whose `profileId` differs from a new required arg `profileUsername` when `targetType === "track"` with "Not found".

- [ ] **Step 1: Write failing tests**
  - `parseBridgeMessage` accepts a valid reportTrack and rejects missing, non-string and 65-char ids.
  - `renderProfileDocument` renders a Report link per track with `data-openspace-report-track="<id>"`, and the bridge script posts `openspace:reportTrack` for it.
  - `moderation.report({ targetType: "track", targetId, profileUsername, reason })` succeeds for a track on that profile and throws "Not found" for a track on another profile.
  - `listOpen` returns track previews with `title` and `url`.
  - e2e: fixture artist JS posts `openspace:reportTrack` with another profile's track id; no dialog opens. Clicking a real track's Report opens the parent dialog showing the server's title.
- [ ] **Step 2: Run** `npm test` and the sandbox e2e, expect FAIL.
- [ ] **Step 3: Implement.** The parent looks the id up in its own server-loaded track list for this profile; unknown ids are dropped silently. The dialog asks for a reason (existing `input` support) and shows "Report the song "<title>"?". Admin queue track items show an `<audio controls preload="none">` and the existing Delete track button.
- [ ] **Step 4: Run** all tests, expect PASS.
- [ ] **Step 5: Commit** `feat: report individual songs`

### Task 2: Remove Friend and Unblock

**Files:**
- Modify: `components/TrustedStrip.tsx`, `components/profileActions.ts`, `components/ProfileView.tsx`, `convex/social.ts`, `app/edit/page.tsx` or `components/edit/EditProfile.tsx`
- Create: `components/edit/FriendsAndBlocking.tsx`
- Test: `tests/convex/social.test.ts`, `e2e/edit.spec.ts` or a new `e2e/friends.spec.ts`

**Interfaces:**
- Consumes: `api.social.removeFriend({ other })`, `api.social.unblock({ other })`, `api.social.myFriendsForTop8`.
- Produces: `api.social.relationship({ username }) -> { signedIn: boolean; self: boolean; friends: boolean; pendingOut: boolean; blocked: boolean } | null`; `api.social.myBlocked() -> Array<{ id: Id<"profiles">; card: PublicCard }>` (bounded, at most 1000); profile action `removeFriend` (strip only, not a bridge action).

- [ ] **Step 1: Write failing tests**
  - `relationship` returns `friends: true` for friends, `self: true` on your own profile, `signedIn: false` when signed out, and `null` for a missing or banned profile.
  - `myBlocked` lists only the caller's blocks and omits nothing else.
  - e2e: a signed-in fixture user who is friends with `sandboxtest` sees "Remove from Friends", confirms, and then sees "Add to Friends". On `/edit`, Unblock removes a blocked user from the list.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** The strip hides friend actions on your own profile, shows "Add to Friends" or "Remove from Friends" from `relationship`, and shows "Request sent" disabled when `pendingOut`. "Remove from Friends" is not exposed to the bridge. The Edit Profile section has two lists with buttons and inline errors.
- [ ] **Step 4: Run** all tests, expect PASS.
- [ ] **Step 5: Commit** `feat: remove friends and unblock`

### Task 3: Homepage boxes without a scan cap

**Files:**
- Modify: `convex/schema.ts`, `convex/media.ts`, `convex/profiles.ts`, `convex/moderation.ts`, `convex/home.ts`, `convex/seed.ts`
- Create: `convex/migrations.ts`
- Test: `tests/convex/home.test.ts`, `tests/convex/media.test.ts`, `tests/convex/migrations.test.ts`

**Interfaces:**
- Produces: `profiles.hasPhoto?: boolean`, `profiles.hasTracks?: boolean`; indexes `by_kind_photo` (`kind`, `hasPhoto`) and `by_kind_tracks` (`kind`, `hasTracks`), both ordered by creation; helper `syncMediaFlags(ctx, profileId)` in `convex/lib/media.ts`; `internal.migrations.backfillMediaFlags({ cursor? })` processing 100 profiles per run and scheduling itself until done.

- [ ] **Step 1: Write failing tests**
  - Accepting a photo sets `hasPhoto`; replacing keeps it; there is no photo delete path today, so none is needed.
  - Accepting the first track sets `hasTracks`; deleting the last track (owner or admin) clears it.
  - `coolNewPeople` returns a fan with a photo created before 500 photoless fans.
  - `coolNewMusic` returns an artist with tracks created before 500 trackless artists.
  - Banned profiles stay excluded.
  - `backfillMediaFlags` sets correct flags on legacy rows, is idempotent, and touches at most 100 rows per invocation.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** Call `syncMediaFlags` wherever photos or tracks change. Home queries read the new indexes with `.eq("hasPhoto", true)` / `.eq("hasTracks", true)`, newest first, skipping banned and house rows with a scan bound of 50 past the first 5 matches. The seed sets flags. Document running the backfill once in `docs/deploy.md`.
- [ ] **Step 4: Run** all tests, then run the backfill on the local deployment, expect PASS.
- [ ] **Step 5: Commit** `feat: index homepage boxes by photo and tracks`

### Task 4: Sharded anonymous view counter

**Files:**
- Modify: `convex/lib/limits.ts`, `convex/profiles.ts`
- Test: `tests/convex/views.test.ts` (or the existing recordView tests)

**Interfaces:**
- Produces: `anonView` limit configured with `shards: 10` and the same 600/min total; `view` unchanged.

- [ ] **Step 1: Write failing test**: the rate limiter config for `anonView` has `shards: 10` and `rate: 600`; recordView still stops counting anonymous views after the limit within a minute (allowing the component's shard tolerance), and per-viewer still stops at 60.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** per the installed `@convex-dev/rate-limiter` README's sharding option. If the installed version has no `shards`, report BLOCKED with the version.
- [ ] **Step 4: Run** all tests, expect PASS.
- [ ] **Step 5: Commit** `feat: shard the anonymous view limit`

### Task 5: Protect uploaded MP3s

Approved by the owner in chat on 2026-10-20: short-lived playback links, a 128 kbps streaming copy instead of the original, and no download button or right-click save. DRM and previews are out of scope.

**Decisions (controller calls):**
- Tracks move to a second, private bucket `R2_AUDIO_BUCKET`, using the same R2 credentials. Photos stay in the public `R2_BUCKET`. Nothing in the audio bucket is ever publicly reachable.
- The artist's browser re-encodes every track to 128 kbps MP3 (44.1 kHz) before upload. It decodes with `AudioContext.decodeAudioData` and encodes with `wasm-media-encoders`. Only that copy is stored, so no original ever reaches the server. A tampered client can only upload its own music at a different quality, and the size and type limits still apply.
- Audio uploads are confirmed by an action `media.confirmTrackUpload({ uploadId })`. It runs `HeadObject` against the audio bucket, checks that ContentLength and ContentType match the pending row, then calls the existing accept or reject logic. Photo uploads keep the current component sync path.
- Playback URLs are presigned GETs with a 15-minute expiry (`PLAYBACK_URL_TTL_S = 900`). They come from a public action `media.playbackUrls({ username }) -> Array<{ id, url }>`. The action signs only tracks of an unbanned profile, signs at most 10, and does no DB writes.
- `getPublicProfile` stops returning track URLs (`url: null`). The usercontent route calls `playbackUrls` at render time and merges the URLs in.
- The player refreshes its URLs from `GET <usercontent>/<username>?format=tracks`. It does this on an audio `error` event and on a 12-minute timer. The response is JSON `{ tracks: [{ id, url }] }` with `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`, and the same 404 rules as the profile document. `routeForHost` allows that query on the single-segment path.
- The edit-page preview and the admin queue fetch playback URLs through the action. For the admin queue this is a new admin-only action `moderation.trackPlaybackUrl({ trackId })`, which works even for banned profiles.
- The player sets `controlsList="nodownload"` on the `<audio>` element and calls `preventDefault()` on `contextmenu` over the player.
- Seed media uploads tracks to the audio bucket. README, `docs/deploy.md` and `.env.example` document `R2_AUDIO_BUCKET`, and state that it must stay private, with no public domain and no r2.dev URL. CORS for that bucket follows the same rules.

**Files:**
- Modify: `convex/lib/r2.ts`, `convex/media.ts`, `convex/lib/media.ts`, `convex/profiles.ts`, `convex/moderation.ts`, `app/usercontent/[username]/route.ts`, `lib/hosts.ts`, `lib/profile/render.ts`, `components/useMediaUpload.ts`, `components/edit/CodeEditor.tsx`, `components/AdminQueue.tsx`, `scripts/seed-media.mjs`, `.env.example`, `README.md`, `docs/deploy.md`
- Create: `lib/transcode.ts` (browser-only `transcodeToMp3_128(file: File): Promise<File>`)
- Test: `tests/convex/media.test.ts`, `tests/convex/playback.test.ts`, `tests/usercontentRoute.test.ts`, `tests/hosts.test.ts`, `tests/render.test.ts`, `e2e/sandbox.spec.ts`

**Interfaces:**
- Produces: `presignGet(key: string, bucket: string, expiresIn: number): Promise<string>` in `convex/lib/r2.ts`; `headObject(key, bucket): Promise<{ size: number; contentType: string } | null>`; `api.media.playbackUrls`; `api.media.confirmTrackUpload`; `api.moderation.trackPlaybackUrl`; `routeForHost("usercontent", "/lowveld", "?format=tracks")` resolves to the tracks JSON route.

- [ ] **Step 1: Write failing tests**
  - Track presign PUT targets `R2_AUDIO_BUCKET`, and photo presign targets `R2_BUCKET`.
  - `confirmTrackUpload` accepts when HEAD matches, rejects and deletes when size or type differ, and refuses another user's upload.
  - `playbackUrls` returns signed URLs with `X-Amz-Expires=900` for an unbanned profile, returns `[]` for a banned or missing one, and returns at most 10.
  - `getPublicProfile` tracks have `url: null`.
  - The usercontent route merges signed URLs into the document. The `?format=tracks` JSON has the right headers and returns 404 on the main host.
  - The rendered player has `controlsList="nodownload"` and a contextmenu guard. The refresh script fetches `?format=tracks` on error.
  - `trackPlaybackUrl` is admin-only.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** per the decisions above.
- [ ] **Step 4: Run** all tests and e2e, expect PASS. Note in the report that real R2 has not been exercised.
- [ ] **Step 5: Commit** `feat: private audio bucket, signed playback and 128 kbps uploads`
