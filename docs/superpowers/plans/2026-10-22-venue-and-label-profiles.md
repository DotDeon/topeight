# Venue and label profiles implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add venue and label profile kinds, band-approved roster and label links, and venue gigs with lineups that show on venue, band and events pages.

**Architecture:** `profiles.kind` gains two values behind one shared validator. A new `links` table holds venue and label requests to bands, modelled on `friendRequests`. Venue events keep using the `events` table and gain a `gigArtists` join table for the lineup, so a band's gigs are one index read. The profile frame gets the new data through `PublicProfile` and renders new sections. The only new bridge message is `topeight:openEvent`.

**Tech stack:** Next.js (repo version, read `node_modules/next/dist/docs/` before Next code), Convex, convex-test plus vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-venue-and-label-profiles-design.md`

## Global constraints

- Kinds are exactly `"fan" | "artist" | "venue" | "label"`. Venue and label are picked at sign-up with no approval.
- Venues and labels get artist code rules: HTML, CSS and JS, 100 KB total. Fans stay CSS only.
- Nothing from a venue or label shows on a band's profile until the band accepts.
- A declined sender waits 7 days (`DECLINE_COOLDOWN_MS`) before asking that band again.
- Roster acceptance covers all of that venue's future gigs. Leaving a roster drops the band from that venue's events that haven't started. Past events keep it.
- A band can leave a single gig's lineup. The venue can't add it back to that gig.
- Venues and labels can't switch kind. `becomeArtist` only works for fans.
- Every list read is bounded (`MAX_SCAN` = 200 or smaller).
- Copy follows the classic profile style and the unslop rules: sentence case, no em dashes.
- No Claude attribution in commits or PRs.

## Review focus

1. A venue or label calling `links.request` on a fan, venue, label, banned or blocked profile, or itself. It must throw, and nothing may appear anywhere. Tested in Task 2.
2. A venue putting a band that isn't on its accepted roster, or a band that opted out of that gig, into a lineup through `events.create` or `events.update`. It must throw. Tested in Task 4.
3. A banned venue, label or band. It drops out of rosters, labels, lineups and band Shows on display. Tested in Task 6.
4. A venue edits a gig's date. The band's Shows ordering and the past/future split follow the new date (`gigArtists.startsAt` is kept in step). Tested in Task 4.
5. Custom code on a band page reading `window.TOPEIGHT.labels`, or on a venue page reading `gigs`, gets escaped-safe data with no ids beyond event ids and usernames. Tested in Task 6.

---

### Task 1: Profile kinds

**Files:**
- Create: `convex/lib/kinds.ts`
- Modify: `convex/schema.ts`, `convex/profiles.ts`, `convex/events.ts`, `convex/blog.ts`, `convex/favorites.ts`, `convex/groups.ts`, `convex/mail.ts`, `convex/search.ts`, `convex/lib/cards.ts`, `lib/profile/types.ts`, `lib/profile/render.ts`, `app/signup/page.tsx`, `app/browse/page.tsx`, `app/search/page.tsx`, `components/Header.tsx`, `components/BrowseResults.tsx`, `components/SearchResults.tsx`, `components/edit/EditProfile.tsx`, `components/edit/DetailsForm.tsx`, `components/edit/CodeEditor.tsx`
- Test: `tests/convex/signup.test.ts`, `tests/convex/edit.test.ts`, `tests/render.test.ts`

**Interfaces:**
- Produces: `profileKind` (Convex validator) and `canUseCode(kind)` in `convex/lib/kinds.ts`. `ProfileKind = "fan" | "artist" | "venue" | "label"` in `lib/profile/types.ts`, used by `PublicCard.kind` and `PublicProfile.kind`. Profile fields `address?: string` (venues) and `website?: string` (labels). `updateDetails` takes optional `address` and `website`.

- [ ] **Step 1: Write failing tests**
  - signup: `createMyProfile` with `kind: "venue"` and `kind: "label"` stores that kind.
  - edit: a venue saves HTML and JS with `updateCustomCode`. A fan still gets "Fans can use CSS only".
  - edit: `updateDetails` on a venue stores `address` (500 max) and ignores `band` and `interests`. A label stores `website` (must start with http:// or https://, 200 max, empty allowed) and `genre`.
  - edit: `becomeArtist` on a venue throws "Only fans can switch to artist". `setPrivate` on a venue throws.
  - render: a venue document includes custom HTML and JS and shows "Address" in its details. A label shows "Website" as a link with `target="_blank" rel="noopener noreferrer"`. Neither shows an age.
- [ ] **Step 2: Run** `npx vitest run tests/convex/signup.test.ts tests/convex/edit.test.ts tests/render.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement**
  - Swap every inline `v.union(v.literal("fan"), v.literal("artist"))` for `profileKind`.
  - Gate on `kind === "fan"` for CSS-only, private and age. Gate band, tracks, shows, song sharing and `becomeArtist`'s target on `kind === "artist"`. Use `canUseCode` in the backend and the renderer.
  - Sign-up gets 4 radios: Fan, Artist, Venue, Label.
  - Browse adds Venues and Labels options. Header and `/search` add `type=venues` and `type=labels`.
  - The edit page shows Address for venues, and Genre plus Website for labels. It hides interests, band, tracks, shows and BecomeArtist for both.
- [ ] **Step 4: Run** the same tests, then `npx vitest run` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5: Commit** "Add venue and label profile kinds".

### Task 2: Links backend

**Files:**
- Modify: `convex/schema.ts`, `convex/lib/limits.ts`, `convex/home.ts`, `convex/social.ts` (block clears links)
- Create: `convex/links.ts`, `convex/lib/links.ts`
- Test: `tests/convex/links.test.ts`

**Interfaces:**
- Schema `links`: `{ fromId: Id<"profiles">, artistId: Id<"profiles">, type: "venue" | "label", status: "pending" | "accepted" | "declined", respondedAt?: number }`. Indexes `by_pair [fromId, artistId]`, `by_artist_status [artistId, status]`, `by_from_status [fromId, status]`.
- Rate limit `linkRequest`: 50 an hour.
- `links.request({ artist }) -> "sent"`
- `links.respond({ linkId, accept }) -> null`
- `links.remove({ other }) -> null`. Either side may call it.
- `links.status({ username }) -> null | { type: "venue" | "label", state: "none" | "pending" | "accepted" | "cooldown" }`. Non-null only when the viewer is a venue or label and the target is an unbanned artist.
- `links.mine() -> { roster: Array<PublicCard & { id }>, outgoing: Array<PublicCard & { id }>, venues: Array<PublicCard & { id }>, labels: Array<PublicCard & { id }> }`. Banned profiles are left out.
- `home.dashboard` gains `linkRequests: Array<PublicCard & { linkId, type }>`.
- `convex/lib/links.ts`: `acceptedLinks(ctx, profile, side: "from" | "artist", max) -> Doc<"profiles">[]` (unbanned) for Task 6. `dropFromFutureGigs(ctx, venueId, artistId)` is added in Task 4.

- [ ] **Step 1: Write failing tests** in `tests/convex/links.test.ts`:
  - A venue request to an artist creates a pending row. The artist's dashboard lists it with `type: "venue"`.
  - A request from a fan or an artist throws "Not allowed". So does one to a fan, venue or label, to self, to a banned profile, or to one blocked either way.
  - A second request while pending throws "Request already sent". When accepted, it throws "Already linked".
  - A decline sets `declined`. A re-request inside 7 days throws "Request already sent". After 7 days it succeeds.
  - Accept sets `accepted`. Only the artist can respond, and anyone else gets "Not allowed".
  - `remove` by either side deletes the row.
  - `block` either way deletes links between the pair.
  - `status` returns `none`, `pending`, `accepted` and `cooldown` in the matching states.
- [ ] **Step 2: Run** `npx vitest run tests/convex/links.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** in `convex/links.ts`, following the `sendFriendRequest` and `respondFriendRequest` checks and errors.
- [ ] **Step 4: Run** the tests. Expect PASS.
- [ ] **Step 5: Commit** "Let venues and labels ask bands to link".

### Task 3: Links UI

**Files:**
- Create: `components/LinkRequestButton.tsx`, `components/edit/LinksForm.tsx`
- Modify: `components/ProfileView.tsx`, `components/HomeMember.tsx`, `components/edit/EditProfile.tsx`

**Interfaces:**
- Consumes: `links.status`, `links.request`, `links.respond`, `links.remove`, `links.mine`, `dashboard.linkRequests`.

- [ ] **Step 1: Implement** the request button.
  - Under the trusted strip, outside the frame, a venue sees "Add to our roster" and a label sees "Add to our label".
  - Pending shows "Request sent", disabled. Accepted shows "On our roster" or "On our label". Cooldown shows "Request sent", disabled.
- [ ] **Step 2: Implement** the home panel. It shows "Roster requests waiting: N" with "<name> wants you on their roster" or "<name> wants to be your label", plus Accept and Decline buttons.
- [ ] **Step 3: Implement** the edit page boxes.
  - Venues get "Our roster", labels get "Our bands" and artists get "Venues and labels". Each lists cards with a Remove button.
  - Venues and labels also see pending outgoing requests.
- [ ] **Step 4: Run** `npx tsc --noEmit` and `npm run lint`. Expect clean.
- [ ] **Step 5: Commit** "Add roster and label requests to profiles, home and edit".

### Task 4: Gigs backend

**Files:**
- Modify: `convex/schema.ts`, `convex/events.ts`, `convex/links.ts`, `convex/lib/links.ts`
- Test: `tests/convex/events.test.ts`, `tests/convex/links.test.ts`

**Interfaces:**
- Schema `gigArtists`: `{ eventId, hostId, artistId, position: number, startsAt: number }`. Indexes `by_event [eventId, position]`, `by_artist_start [artistId, startsAt]`, `by_host_artist [hostId, artistId, startsAt]`.
- `events` gains `optedOut: v.optional(v.array(v.id("profiles")))`.
- `MAX_LINEUP = 10`.
- `events.create` and `events.update` args gain `lineup?: Id<"profiles">[]`.
  - Non-venues passing a non-empty lineup get "Only venues can add a lineup".
  - For venues, `venue` and `city` are overwritten with `displayName` and `location`, and an empty `location` throws "Add your city to your profile first".
  - Each lineup id must have an accepted venue link to this host and not be in `optedOut`, otherwise "Only bands on your roster can play". Duplicates throw too.
- `EventItem` and `EventView` gain `lineup: PublicCard[]`, banned left out, in position order.
- `events.leaveLineup({ eventId }) -> null`: the caller's row is deleted and the caller is added to `optedOut`.
- `lib/links.ts dropFromFutureGigs(ctx, venueId, artistId)`: deletes rows from `by_host_artist` with `startsAt > now`. `links.remove` calls it for venue links.
- `update` rewrites the event's `gigArtists` rows, including `startsAt`.

- [ ] **Step 1: Write failing tests**
  - A venue creates an event with a 2-band lineup. `get` returns the lineup in order, and the venue name and city come from the profile.
  - A fan passing a lineup throws. A venue lineup with an unlinked or pending band throws.
  - `leaveLineup` removes the band, and a later `update` adding it back throws.
  - Removing the venue link deletes future gigArtists rows but keeps rows for a past event (insert the past event directly with `t.run`).
  - `update` with a new date moves `gigArtists.startsAt`.
- [ ] **Step 2: Run** `npx vitest run tests/convex/events.test.ts tests/convex/links.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, then the full `npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** "Let venues post gigs with a lineup from their roster".

### Task 5: Gigs UI

**Files:**
- Modify: `components/events/EventForm.tsx`, `components/events/WritePages.tsx`, `components/events/EventPage.tsx`, `components/events/EventsHome.tsx`
- Consumes: `links.mine().roster`, `events.get().lineup`, `events.leaveLineup`, `profiles.me`.

- [ ] **Step 1: Implement** the venue form.
  - Venue and City show as read-only text from the profile.
  - A lineup picker has a checkbox list of roster bands and up and down buttons to set the order. Edit pre-fills the current lineup.
- [ ] **Step 2: Implement** the event page and event cards.
  - The event page shows "Lineup:" with linked band names. A band on the lineup sees "Take us off this lineup", with a confirm.
  - Event cards in EventsHome show "with A, B".
- [ ] **Step 3: Run** `npx tsc --noEmit` and `npm run lint`. Expect clean.
- [ ] **Step 4: Commit** "Show and edit gig lineups on events".

### Task 6: Profile sections

**Files:**
- Modify: `lib/profile/types.ts`, `convex/profiles.ts`, `lib/profile/render.ts`, `lib/bridge-protocol.ts`, `lib/bridge.ts`, `components/ProfileFrame.tsx`
- Test: `tests/convex/publicProfile.test.ts`, `tests/render.test.ts`, `tests/bridge.test.ts`

**Interfaces:**
- `PublicProfile` gains the following:
  - `gigs?: Array<{ eventId: string; title: string; startsAt: number; timeZone: string; lineup: PublicCard[] }>`, venues only, upcoming, at most 20.
  - `roster?: PublicCard[]`, venues and labels, at most 200.
  - `labels?: PublicCard[]`, artists only.
- `shows` items gain optional `eventId?: string` and `venueUser?: PublicCard`. For artists, `shows` merges typed shows with upcoming gigs from `by_artist_start` (hidden events and banned hosts left out). Both sort by date and are capped at 20. A gig's `date` is its `localDate`.
- Bridge message `{ type: "topeight:openEvent"; eventId: string }`, with `EVENT_ID_PATTERN = /^[a-z0-9]{1,64}$/`. Frame attribute `data-topeight-event="<id>"`. The parent pushes `/events/<id>`.

- [ ] **Step 1: Write failing tests**
  - publicProfile:
    - A venue's `gigs` lists its upcoming event with lineup.
    - A band's `shows` contains the gig with `eventId` and `venueUser` next to a typed show, sorted.
    - A label's `roster` lists only accepted, unbanned bands. A band's `labels` lists the label.
    - A banned venue's gig drops off the band's shows.
  - render:
    - A venue renders "Gig Guide" with `data-topeight-event`.
    - A band's show row for a gig links the venue with `data-topeight-navigate`.
    - A label renders "<name>'s Bands" with navigate links.
    - A band with labels renders a "Labels" row. The free-text Record Label row still shows.
    - `window.TOPEIGHT.gigs[0].eventId` is present.
  - bridge: `openEvent` accepts a lowercase alphanumeric id and rejects `"../x"`, `""` and a 65-character id.
- [ ] **Step 2: Run** `npx vitest run tests/convex/publicProfile.test.ts tests/render.test.ts tests/bridge.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** The bridge script click delegation adds `[data-topeight-event]`, and `window.topeight.openEvent(id)` is exposed.
- [ ] **Step 4: Run** the tests, then the full `npx vitest run`. Expect PASS.
- [ ] **Step 5: Commit** "Show gig guides, rosters and labels on profiles".

### Task 7: Seed and end-to-end

**Files:**
- Modify: `convex/seed.ts`, `convex/testing.ts` (if a fixture helper is needed)
- Create: `e2e/venues.spec.ts`

- [ ] **Step 1:** Seed adds one venue and one label, both linked to an existing seeded band, and one upcoming venue gig with that band.
- [ ] **Step 2:** Write `e2e/venues.spec.ts`:
  1. Sign up a venue (radio "Venue").
  2. Open a band's profile, click "Add to our roster" and see "Request sent".
  3. As the band, accept on home.
  4. As the venue, post an event with the band in the lineup.
  5. The band's profile frame shows the gig in Upcoming Shows.
  6. The band clicks "Take us off this lineup", and the gig leaves its Shows.
- [ ] **Step 3: Run** `PORT=3100 NEXT_PUBLIC_USERCONTENT_ORIGIN=http://127.0.0.1:3100 E2E_NEXT_ONLY=1 npx playwright test e2e/venues.spec.ts --workers=1`. Expect PASS.
- [ ] **Step 4: Commit** "Seed and test venues and labels", then open the PR.
