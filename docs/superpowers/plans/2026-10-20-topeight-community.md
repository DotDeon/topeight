# TopEight community features implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship pre-launch hardening, Mail, Favorites, Blog, Events and Groups as described in the approved design.

**Architecture:** Same Next.js 16 (`proxy.ts`) and Convex app. Each feature adds its own Convex module, schema tables and pages under the classic chrome, reusing access helpers, the rate limiter, `tokenizeComment` rendering and the moderation `reports` pipeline.

**Tech stack:** Next.js 16, Convex, `@convex-dev/rate-limiter`, Vitest, convex-test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-topeight-community-design.md` (binding), plus `docs/superpowers/specs/2026-10-19-openspace-design.md` for the base product.

## Global constraints

- All base-project constraints still hold: Verdana 10px classic look, `Box` sections, bounded reads (`take`/`paginate`, never unbounded `collect`), `requireProfile` for every write, "Slow down" for rate limits, plain-text content rendered only through the shared React renderer (no `dangerouslySetInnerHTML`), no em dashes in UI copy, sentence case.
- New-account link rule: profile `_creationTime` younger than 24 hours cannot post links in any new content type; error "New accounts can't post links yet".
- Blocks apply both ways using `isBlockedEitherWay`; banned users' content is hidden on every read.
- Every new content type extends `reports.targetType`, gets a preview in `moderation.listOpen`, and is handled by `moderation.hide`.
- Admins never get a read path into unreported mail.
- Tests: `npm test`, `npx tsc --noEmit`, `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build`, e2e `PORT=3100 E2E_NEXT_ONLY=1 npm run test:e2e` (stop any dev server on 3100 first, restart it after). Fixtures stay local-only behind `TOPEIGHT_TEST_FIXTURES`.
- Push functions: move `.env.local` aside, `npx convex deploy --env-file <tmp with CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 and CONVEX_SELF_HOSTED_ADMIN_KEY from .convex/local/default/config.json> --yes`, restore.

## Review focus

1. A stranger messaging someone whose setting is Friends only, or a blocked pair messaging, commenting on each other's blog, or seeing each other's group posts. Tests in Tasks 3, 6, 10.
2. Admin access to mail that was never reported. Test in Task 3.
3. A banned user's blog posts, events, RSVPs, group posts or mail still visible or counted. Tests in Tasks 3, 6, 8, 10.
4. Event times shown or sorted in the wrong timezone (an event at 20:00 Africa/Johannesburg must show 20:00 SAST and sort correctly against a 19:00 Europe/London event). Test in Task 8.
5. Group owner tools usable by non-owners, or a removed/banned member still posting. Test in Task 10.

---

### Task 1: Hardening, backend and UI fixes

**Files:** Modify `convex/profiles.ts`, `convex/media.ts`, `convex/lib/limits.ts`, `app/[username]/page.tsx`, `app/usercontent/[username]/route.ts`, `components/SuspendedGate.tsx`, `components/CommentsList.tsx`, `components/BulletinsPage.tsx`, `components/AdminQueue.tsx`; Create `lib/errorText.ts`. Test: `tests/convex/publicProfile.test.ts`, `tests/convex/playback.test.ts`, `tests/errorText.test.ts`.

**Interfaces:** Produces `api.profiles.profileHeader({ username }) -> { displayName: string; kind: "fan" | "artist"; banned: boolean } | null`; rate limit `playback` 120/min keyed by username on `playbackUrls`; `errorText(e: unknown, fallback?: string): string` in `lib/errorText.ts`.

- [ ] **Step 1: Write failing tests**: `profileHeader` returns the three fields and null for missing; `playbackUrls` returns `[]` silently after 120 calls in a minute for one username; `errorText` returns ConvexError string data and the fallback otherwise.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** The profile page and the `?format=tracks` path use `profileHeader` for existence and ban checks. SuspendedGate renders nothing while authenticated and `me` is undefined. Replace the three duplicated `errorText` helpers with the shared one.
- [ ] **Step 4: Run** all checks, expect PASS.
- [ ] **Step 5: Commit** `fix: pre-launch hardening`

### Task 2: Hardening, browser tests

**Files:** Create/modify `e2e/moderation.spec.ts`, `e2e/chrome.spec.ts`, `e2e/suspended.spec.ts`; fixtures in `convex/testing.ts` as needed.

- [ ] **Step 1: Write tests**: a signed-in fixture user reports a fixture song via the player Report link and the admin sees it on `/admin` with an `<audio>` whose `src` contains `X-Amz-Expires=900` (skip only the src assertion when no audio bucket is configured, with a clear skip message); a banned fixture user sees "Your account has been suspended" on `/` and `/edit`; the header search form submits to `/search?q=...&type=...`.
- [ ] **Step 2: Run** them; fix fixtures until they pass for the right reason (each test must fail if its feature is removed).
- [ ] **Step 3: Commit** `test: browser coverage for reports, suspension and search`

### Task 3: Mail backend

**Files:** Modify `convex/schema.ts`, `convex/moderation.ts`, `convex/lib/limits.ts`; Create `convex/mail.ts`. Test: `tests/convex/mail.test.ts`, `tests/convex/moderation.test.ts`.

**Interfaces:**
- Schema: `messages` { senderId, recipientId: Id<"profiles">, subject, body, readAt?: number, senderDeleted: boolean, recipientDeleted: boolean } with indexes `by_recipient` [recipientId, recipientDeleted], `by_sender` [senderId, senderDeleted], `by_recipient_unread` [recipientId, recipientDeleted, readAt]; `profiles.mailFrom?: "friends" | "anyone"` (default friends).
- `api.mail.send({ to: string /* username */, subject, body, replyTo?: Id<"messages"> }) -> Id<"messages">`; `inbox({ cursor })`, `sent({ cursor })` → `{ page: MessageSummary[], isDone, continueCursor }` 25 per page; `read({ id }) -> MessageView` (marks read when the viewer is recipient); `remove({ id })` (sets the viewer's side deleted; hard-deletes when both sides deleted); `unreadCount() -> number` (bounded, returns at most 100); `setMailFrom({ value })`; `canMessage({ username }) -> boolean`.
- Reports: `targetType "message"`; `report` for a message requires the reporter to be its recipient and copies `subject` and `body` into new optional fields `reports.snapshot?: { subject?: string; body: string }`. `listOpen` shows the snapshot for message reports. `hide` on a message report deletes the message for both sides.
- Limits: `mail` 30/hour and `mailDaily` 200/day per sender.

- [ ] **Step 1: Write failing tests**: Friends-only recipient rejects a non-friend ("This person only accepts messages from friends"); Anyone setting allows it; blocked either way rejects ("Not allowed"); you cannot message yourself or the house account; subject 1–100 and body 1–5000 trimmed; link rule; rate limits; inbox/sent pagination and per-side delete; `read` by a third party throws "Not found"; unread count caps at 100; banned senders' messages are hidden from the inbox and banned users can't send; report only by recipient, snapshot stored, admin preview shows snapshot, there is no admin query that lists messages without a report.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks, push, expect PASS.
- [ ] **Step 5: Commit** `feat: mail backend`

### Task 4: Mail UI

**Files:** Create `app/mail/page.tsx` (inbox), `app/mail/sent/page.tsx`, `app/mail/compose/page.tsx`, `app/mail/[id]/page.tsx`, `components/mail/*`; Modify `components/Header.tsx` or `HeaderAuthLinks.tsx` (New Messages! link), `components/NavBar.tsx` (Mail → /mail), `components/profileActions.ts` (message action navigates to compose), `components/edit/*` (mail setting), `lib/hosts.ts`/`lib/validation.ts` reserved names if `mail` is missing. Test: `e2e/mail.spec.ts`.

- [ ] **Step 1: Write e2e test**: a fixture user sends a message to a friend fixture from their profile's Send Message; the recipient sees "New Messages!" in the header, opens it, replies; the original sender sees the reply in Inbox; Sent shows both; delete removes it from one side only.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** Classic 2006 mail center: left links (Inbox, Sent, Compose), table of From / Subject / Date with unread rows bold. "New Messages!" is an orange link with a CSS blink every 1s, respecting `prefers-reduced-motion`. The trusted strip and Contacting box "Send Message" go to `/mail/compose?to=<username>` (the bridge `message` action navigates the parent there, no dialog). Edit Profile gets a "Who can send me messages" select. Report link on received messages.
- [ ] **Step 4: Run** all checks and e2e, expect PASS.
- [ ] **Step 5: Commit** `feat: mail`

### Task 5: Favorites

**Files:** Modify `convex/schema.ts`; Create `convex/favorites.ts`, `app/favorites/page.tsx`; Modify `components/profileActions.ts`, `components/NavBar.tsx`. Test: `tests/convex/favorites.test.ts`.

**Interfaces:** `favorites` { ownerId, profileId } index `by_owner`, `by_pair`; `api.favorites.add({ username })`, `remove({ profileId })`, `list() -> PublicCard[]` (max 500, banned omitted), `isFavorite({ username }) -> boolean`.

- [ ] **Step 1: Write failing tests**: add is idempotent, max 500 ("Favorites are full"), cannot favorite yourself, list omits banned, remove works.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.** "Add to Favorites" in the Contacting box and strip (via a confirm dialog like Add Friend; shows "Saved to Favorites"). `/favorites` grid with Remove. Nav Favorites → `/favorites`.
- [ ] **Step 4: Run** all checks, expect PASS.
- [ ] **Step 5: Commit** `feat: favorites`

### Task 6: Blog backend

**Files:** Modify `convex/schema.ts`, `convex/moderation.ts`, `convex/profiles.ts` (latest blog entry in public profile), `lib/profile/render.ts` (Latest Blog Entry box); Create `convex/blog.ts`. Test: `tests/convex/blog.test.ts`, `tests/render.test.ts`.

**Interfaces:**
- Schema: `blogPosts` { authorId, title, body, mood?: { text: string; icon: MoodIcon }, listening?: string, hidden: boolean } index `by_author`; `blogComments` { postId, authorId, body, hidden } index `by_post`. `MoodIcon` is a union of 20 string ids defined in `lib/moods.ts` (shared by UI).
- `api.blog.create({ title, body, mood?, listening? })`, `update({ id, ... })`, `remove({ id })`, `listByUser({ username, cursor })` (10 per page), `get({ id })`, `friendsFeed()` (300 most recent friendships, 30 newest posts), `addComment({ postId, body })`, `removeComment({ id })` (comment author or post author), `comments({ postId, cursor })` (50 per page).
- `PublicProfile.latestBlog?: { id: string; title: string; createdAt: number } | null`; the renderer shows "<Name>'s Latest Blog Entry" with the title linking via the bridge `navigate` with a new page value `"blog"` (extend `BRIDGE_PAGES` and the parent navigate handler to `/<username>/blog`).
- Reports: `blogPost`, `blogComment`; hide sets `hidden`.
- Limits: `blogPost` 10/day; blog comments share the existing `comment` limit.

- [ ] **Step 1: Write failing tests**: field limits (title 1–100, body 1–20000, listening ≤100, mood text ≤40 and icon in the set); link rule; blocked pair cannot comment; only authors edit/delete; hidden and banned content omitted from lists, feed and `latestBlog`; feed bounded; render test for the Latest Blog Entry box with escaping and the `blog` navigate page; bridge parser accepts `page: "blog"`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks, push, expect PASS.
- [ ] **Step 5: Commit** `feat: blog backend`

### Task 7: Blog UI

**Files:** Create `app/[username]/blog/page.tsx`, `app/[username]/blog/[postId]/page.tsx`, `app/blog/page.tsx` (friends' recent posts + write link), `app/blog/new/page.tsx`, `app/blog/[postId]/edit/page.tsx`, `components/blog/*`, `components/MoodIcon.tsx`; Modify `components/NavBar.tsx` (Blog → /blog). Test: `e2e/blog.spec.ts`.

- [ ] **Step 1: Write e2e test**: a fixture user writes a post with a mood and listening, sees it on their blog and in the profile's Latest Blog Entry; a friend sees it on `/blog`, comments; the author deletes the comment.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** in the 2006 blog style (date header bar, title, body, "Current mood:" with icon, "Currently listening:", comment count link). Mood icons are original inline SVG faces, no copied artwork.
- [ ] **Step 4: Run** all checks and e2e, expect PASS.
- [ ] **Step 5: Commit** `feat: blog`

### Task 8: Events backend

**Files:** Modify `convex/schema.ts`, `convex/moderation.ts`; Create `convex/events.ts`, `lib/eventTime.ts`. Test: `tests/convex/events.test.ts`, `tests/eventTime.test.ts`.

**Interfaces:**
- Schema: `events` { hostId, title, localDate: "YYYY-MM-DD", localTime: "HH:MM", timeZone: string /* IANA */, startsAt: number /* UTC ms */, venue, city, cityKey /* lowercased trimmed */, description, imageUrl?, cancelled: boolean, hidden: boolean } indexes `by_start` [startsAt], `by_city_start` [cityKey, startsAt], `by_host`; `rsvps` { eventId, profileId, status: "going" | "maybe" } indexes `by_event_status`, `by_pair`.
- `lib/eventTime.ts`: `toUtc(localDate, localTime, timeZone) -> number` (DST-correct via `Intl`), `formatEventTime(startsAt, timeZone) -> string` like "Fri 24 Oct 2026, 8:00 PM SAST".
- `api.events.create/update/cancel`, `get({ id })` (with going/maybe counts capped at 1000 and up to 24 going cards), `upcoming({ city?, cursor? })` merging events with artist shows (bounded 100 per source, sorted by start, shows as `{ kind: "show" }` entries), `rsvp({ eventId, status | null })`, `myEvents()`.
- Reports: `event`; hide sets `hidden`. Limits: `event` 5/day.

- [ ] **Step 1: Write failing tests**: `toUtc` for Africa/Johannesburg, Europe/London across a DST change, America/New_York; invalid timezone rejected ("Invalid timezone"); past start rejected; field limits; only host edits/cancels; cancelled stays listed with `cancelled: true`; RSVP toggle and counts; banned host's events and banned users' RSVPs excluded; merge ordering across sources and city filter; link rule on description; imageUrl must be http(s).
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks, push, expect PASS.
- [ ] **Step 5: Commit** `feat: events backend`

### Task 9: Events UI

**Files:** Create `app/events/page.tsx`, `app/events/new/page.tsx`, `app/events/[id]/page.tsx`, `app/events/[id]/edit/page.tsx`, `components/events/*`; Modify `components/NavBar.tsx` (Events → /events), reserved names if needed. Test: `e2e/events.spec.ts`.

- [ ] **Step 1: Write e2e test**: create an event (timezone defaults to the browser's), it appears on `/events` and its page; another fixture user RSVPs Going and appears in the attendee grid; city filter narrows the list; host cancels and it shows "Cancelled".
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** with a timezone select (full IANA list from `Intl.supportedValuesOf("timeZone")`).
- [ ] **Step 4: Run** all checks and e2e, expect PASS.
- [ ] **Step 5: Commit** `feat: events`

### Task 10: Groups backend

**Files:** Modify `convex/schema.ts`, `convex/moderation.ts`, `convex/media.ts` (group photo upload purpose); Create `convex/groups.ts`. Test: `tests/convex/groups.test.ts`.

**Interfaces:**
- Schema: `groups` { slug, name, description, category: "music" | "local" | "hobbies" | "fanclubs" | "other", photoKey?, ownerId, deleted: boolean, hidden: boolean, memberCount: number } indexes `by_slug`, `by_category`, search index on `name`; `groupMembers` { groupId, profileId, banned: boolean } indexes `by_group`, `by_pair`, `by_profile`; `groupTopics` { groupId, authorId, title, lastReplyAt, replyCount, hidden } index `by_group_last`; `groupReplies` { topicId, authorId, body, hidden } index `by_topic`.
- `slugify(name) -> string` (lowercase, a–z0–9 and hyphens, collapsing, max 60; collisions get `-2`, `-3`…).
- `api.groups.create` (account ≥ 7 days: "Your account must be a week old to create a group"), `update` (name/description/category/photo; slug fixed), `remove` (owner; sets deleted), `join`, `leave` (owner cannot leave without handing over: "Hand over the group first"), `get({ slug })`, `list({ category?, q?, cursor })`, `members({ slug, cursor })`, `startTopic`, `reply`, `topics({ slug, cursor })` (20), `replies({ topicId, cursor })` (50), owner tools `removePost`, `removeMember`, `banMember`, `handOver({ to })`; admin `moderation.restoreGroup`, `moderation.setGroupOwner`.
- Only non-banned members post. Viewer's blocks filter topics/replies on read.
- Reports: `group`, `groupTopic`, `groupReply`; hide sets `hidden` (group hide hides the whole group).
- Limits: `groupCreate` 3/day, `groupTopic` 10/hour, `groupReply` 60/hour. Group photos use the existing photo rules via a new upload purpose `groupPhoto` scoped to the owner.

- [ ] **Step 1: Write failing tests**: covering every rule above, including non-owner owner-tool calls ("Not allowed"), banned members can't post or rejoin, a banned site user's posts hidden, deleted groups excluded from lists and restorable by admin, slug collisions, search, blocked-pair filtering, memberCount kept in sync.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks, push, expect PASS.
- [ ] **Step 5: Commit** `feat: groups backend`

### Task 11: Groups UI

**Files:** Create `app/groups/page.tsx`, `app/groups/new/page.tsx`, `app/groups/[slug]/page.tsx`, `app/groups/[slug]/t/[topicId]/page.tsx`, `app/groups/[slug]/settings/page.tsx`, `components/groups/*`; Modify `components/NavBar.tsx` (Groups → /groups), `components/AdminQueue.tsx` (group previews, restore, set owner), reserved names. Test: `e2e/groups.spec.ts`.

- [ ] **Step 1: Write e2e test**: an aged fixture user creates a group, a second user joins, starts a topic, the first replies, the owner removes a reply and bans the member, who then can't post.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** in 2006 group style (group photo, member count, "Join Group" button, board table: Topic / Replies / Last post).
- [ ] **Step 4: Run** all checks and e2e, expect PASS.
- [ ] **Step 5: Commit** `feat: groups`
