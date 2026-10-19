# OpenSpace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build OpenSpace, an open source 2006 MySpace rebuild with classic profiles for everyone and sandboxed custom-code artist pages.

**Architecture:** One Next.js App Router project on Vercel serves two hosts. The main host serves the site. The usercontent host serves only rendered profile documents, which the main host embeds in a sandboxed iframe under a trusted strip of controls. Convex holds data, auth and live queries. Cloudflare R2 holds photos and MP3s through the `@convex-dev/r2` component.

**Tech stack:** Next.js (latest stable, App Router, TypeScript), Convex, `@convex-dev/auth` (Password provider with Resend OTP), `@convex-dev/r2`, `@convex-dev/rate-limiter`, Vitest, `convex-test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-openspace-design.md`. Approved mockup: `docs/superpowers/specs/2026-10-19-openspace-mockup.html`.

## Global constraints

- Name "OpenSpace" everywhere. No MySpace logos, icons or images in the repo. Look comes from CSS, Verdana/Arial and new artwork.
- Look: Verdana 10px body, header `#003399`, nav `#6698cb`, orange box headers text `#ff6600` on `#ffcc99`, details table keys `#b1d0f0` / values `#d5e8fb`, page width 800px. Match the mockup.
- License AGPL-3.0. Nothing owner-specific committed. Every setting lives in `.env.example`.
- Env vars: `NEXT_PUBLIC_MAIN_ORIGIN`, `NEXT_PUBLIC_USERCONTENT_ORIGIN`, `NEXT_PUBLIC_CONVEX_URL`, `ADMIN_EMAILS` (comma list), `HOUSE_USERNAME`, `HOUSE_DISPLAY_NAME`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `NEXT_PUBLIC_R2_PUBLIC_URL`.
- Local dev: main `http://localhost:3000`, usercontent `http://127.0.0.1:3000` (same server, different host, so no shared cookies).
- Limits: minimum age 13. Artists 10 tracks, 5 MB each, `audio/mpeg` only. Custom code total 100 KB (HTML + CSS + JS). Fans get CSS only. Photos 2 MB, `image/jpeg|png|gif|webp`.
- Iframe: `sandbox="allow-scripts allow-popups"` (never `allow-same-origin`), `allow="autoplay"`.
- Usercontent CSP: `default-src 'none'; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; frame-src *; font-src * data:; connect-src <USERCONTENT_ORIGIN>; form-action 'none'; base-uri 'none'`.
- Comments and bulletins are plain text. Image URLs (ending `.jpg .jpeg .png .gif .webp`) render as `<img>`. No other HTML.
- Accounts younger than 24 hours cannot post links. Bulletins older than 10 days are hidden. Rate limits per account per hour: 30 comments, 10 bulletins, 50 friend requests.
- Coming soon: Send Message, Blog, Groups, Forum, Events, Videos, Favorites, Invite, Forward to Friend.

## Review focus

1. Usernames that collide with app routes (`admin`, `edit`, `login`, `signup`, `browse`, `search`, `bulletins`, `api`, `about`, and the rest of the route list) or differ only by case must be rejected. Test in Task 2.
2. Artist code or user text containing `</script>`, `</style>` or `<!--` must not break out of the template's data block or break the OpenSpace parts of the page. Test in Task 6.
3. Banned or blocked users must disappear everywhere they show up: other people's Top 8, comments walls, Cool New People, search and bulletins. Test in Tasks 8, 9 and 13.
4. Unfriending someone who is in your Top 8 removes them from it, and Top 8 never holds non-friends. Test in Task 8.
5. A profile with no tracks, no photo or no custom code renders the classic default cleanly, and an upload that is the wrong type or too big is deleted and rejected, not kept. Test in Tasks 6 and 10.

---

## File structure

```
app/                         Next.js routes (main host)
  layout.tsx, globals.css    classic chrome and CSS
  page.tsx                   homepage (logged out / logged in)
  signup/ login/ reset/      auth pages
  [username]/page.tsx        profile shell: trusted strip + iframe
  [username]/friends/page.tsx, [username]/comments/page.tsx
  edit/page.tsx              edit profile
  bulletins/page.tsx, browse/page.tsx, search/page.tsx, admin/page.tsx
  coming-soon/page.tsx, (static)/about|faq|terms|privacy|safety/page.tsx
  usercontent/[username]/route.ts   rendered profile document (usercontent host only)
components/                  Header, NavBar, Footer, Box, TrustedStrip, ProfileFrame, ConfirmDialog, LoginBox
lib/
  hosts.ts                   host classification and routing
  validation.ts              usernames, age, links, image urls
  profile/render.ts          renderProfileDocument
  profile/csp.ts             buildUsercontentCsp
  bridge.ts                  postMessage protocol
middleware.ts                host split + Convex Auth middleware
convex/
  schema.ts, auth.ts, auth.config.ts, http.ts, convex.config.ts
  profiles.ts, social.ts, comments.ts, bulletins.ts, media.ts, shows.ts
  home.ts, search.ts, moderation.ts, seed.ts, lib/access.ts, lib/limits.ts
tests/ (vitest, convex-test)   e2e/ (playwright)
```

---

### Task 1: Scaffold, hosts and tooling

**Files:**
- Create: Next.js app via `npx create-next-app@latest . --ts --app --eslint --no-tailwind --no-src-dir`, `convex/` via `npx convex dev --once --configure new`, `LICENSE` (AGPL-3.0 text), `.env.example`, `vitest.config.ts`, `playwright.config.ts`, `lib/hosts.ts`, `middleware.ts`
- Test: `tests/hosts.test.ts`

**Interfaces:**
- Produces: `type HostKind = "main" | "usercontent" | "unknown"`; `classifyHost(host: string): HostKind`; `routeForHost(kind: HostKind, pathname: string): { action: "next" } | { action: "rewrite"; to: string } | { action: "notFound" }`.

- [ ] **Step 1: Scaffold** the Next.js app (keep existing README, assets, docs, `.gitignore` entries), add Convex, Vitest (two projects: `edge-runtime` for `convex/`, `node` for `lib/`), `convex-test`, Playwright. Add scripts `test`, `test:e2e`, `dev` (runs `next dev` and `convex dev` together via `npm-run-all`).
- [ ] **Step 2: Write failing tests**

```ts
test("classifies hosts from env origins", () => {
  // env: MAIN=http://localhost:3000, USERCONTENT=http://127.0.0.1:3000
  expect(classifyHost("localhost:3000")).toBe("main");
  expect(classifyHost("127.0.0.1:3000")).toBe("usercontent");
  expect(classifyHost("evil.com")).toBe("unknown");
});
test("usercontent host only serves profile documents", () => {
  expect(routeForHost("usercontent", "/lowveld")).toEqual({ action: "rewrite", to: "/usercontent/lowveld" });
  expect(routeForHost("usercontent", "/admin")).toEqual({ action: "rewrite", to: "/usercontent/admin" });
  expect(routeForHost("usercontent", "/a/b")).toEqual({ action: "notFound" });
});
test("main host never serves /usercontent", () => {
  expect(routeForHost("main", "/usercontent/lowveld")).toEqual({ action: "notFound" });
  expect(routeForHost("main", "/lowveld")).toEqual({ action: "next" });
});
```

- [ ] **Step 3: Run** `npm test -- hosts` and confirm FAIL (module not found).
- [ ] **Step 4: Implement** `lib/hosts.ts` reading the two `NEXT_PUBLIC_*_ORIGIN` env vars, and `middleware.ts` applying `routeForHost` (Convex Auth middleware is added in Task 3). `unknown` hosts are treated as `main` in development only.
- [ ] **Step 5: Run** `npm test` and confirm PASS. Run `npm run build` and confirm it succeeds.
- [ ] **Step 6: Commit** `feat: scaffold Next.js, Convex and host routing`

### Task 2: Schema and validation

**Files:**
- Create: `convex/schema.ts`, `lib/validation.ts`
- Test: `tests/validation.test.ts`

**Interfaces:**
- Produces: tables below; `normalizeUsername(raw: string): string`; `validateUsername(raw: string): { ok: true; username: string } | { ok: false; reason: string }`; `ageOn(birthDate: string /* YYYY-MM-DD */, today: Date): number`; `containsLink(text: string): boolean`; `tokenizeComment(text: string): Array<{ type: "text"; value: string } | { type: "image"; url: string } | { type: "link"; url: string }>`; `RESERVED_USERNAMES: ReadonlySet<string>`.

Schema (`convex/schema.ts`, plus `...authTables`):
- `profiles`: `userId: Id<"users">`, `username` (lowercase, unique, 3 to 20 of `[a-z0-9_]`), `displayName`, `kind: "fan" | "artist"`, `birthDate`, `headline`, `location`, `gender?`, `genre?`, `aboutMe`, `whoIdLikeToMeet`, `interests?: { general, music, movies, television, books, heroes }`, `band?: { members, influences, soundsLike, recordLabel, labelType }`, `photoKey?`, `profileViews: number`, `lastLoginAt: number`, `customCss`, `customHtml`, `customJs`, `top8: Id<"profiles">[]`, `isHouse: boolean`, `banned: boolean`. Indexes `by_username`, `by_user`, `by_kind_creation` (`kind`, `_creationTime`).
- `friendRequests`: `from`, `to` (profiles), `status: "pending" | "accepted" | "declined"`. Indexes `by_to_status`, `by_pair` (`from`, `to`).
- `friendships`: `a`, `b` (profiles, `a < b` by id string). Indexes `by_a`, `by_b`, `by_pair`.
- `comments`: `profileId`, `authorId`, `body`, `hidden: boolean`. Index `by_profile` (`profileId`, `_creationTime`).
- `bulletins`: `authorId`, `body`, `hidden: boolean`. Index `by_author` (`authorId`, `_creationTime`).
- `tracks`: `profileId`, `title`, `key`, `size`, `order: number`, `autoplay: boolean`. Index `by_profile_order`.
- `shows`: `profileId`, `date` (YYYY-MM-DD), `venue`, `city`. Indexes `by_profile_date`, `by_date`.
- `blocks`: `blocker`, `blocked`. Index `by_pair`, `by_blocker`.
- `reports`: `reporterId`, `targetType: "profile" | "comment" | "bulletin" | "track"`, `targetId: string`, `reason`, `status: "open" | "actioned" | "dismissed"`. Index `by_status`.

- [ ] **Step 1: Write failing tests**

```ts
test("usernames", () => {
  expect(validateUsername("Lowveld")).toEqual({ ok: true, username: "lowveld" });
  expect(validateUsername("ab").ok).toBe(false);
  expect(validateUsername("has space").ok).toBe(false);
  for (const r of ["admin", "edit", "login", "signup", "browse", "search", "bulletins", "api", "about", "usercontent", "coming-soon"])
    expect(validateUsername(r).ok).toBe(false);
});
test("age", () => {
  expect(ageOn("2013-10-20", new Date("2026-10-19"))).toBe(12);
  expect(ageOn("2013-10-19", new Date("2026-10-19"))).toBe(13);
});
test("links and images", () => {
  expect(containsLink("see www.spam.biz")).toBe(true);
  expect(containsLink("see you in cape town")).toBe(false);
  expect(tokenizeComment("hi https://x.com/a.gif yo")).toEqual([
    { type: "text", value: "hi " }, { type: "image", url: "https://x.com/a.gif" }, { type: "text", value: " yo" }]);
  expect(tokenizeComment("javascript:alert(1).png")).toEqual([{ type: "text", value: "javascript:alert(1).png" }]);
});
```

- [ ] **Step 2: Run** `npm test -- validation`, expect FAIL.
- [ ] **Step 3: Implement** `lib/validation.ts` (only `http:`/`https:` URLs count as links or images; `RESERVED_USERNAMES` includes every top-level route in the file structure) and `convex/schema.ts`.
- [ ] **Step 4: Run** `npm test` and `npx convex dev --once`, expect PASS and schema pushed.
- [ ] **Step 5: Commit** `feat: add schema and validation helpers`

### Task 3: Accounts and signup

**Files:**
- Create: `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/profiles.ts` (create part), `convex/lib/access.ts`, `app/signup/page.tsx`, `app/login/page.tsx`, `app/reset/page.tsx`, `components/ConvexClientProvider.tsx`
- Modify: `middleware.ts` (wrap with `convexAuthNextjsMiddleware`)
- Test: `tests/convex/signup.test.ts`

**Interfaces:**
- Consumes: `validateUsername`, `ageOn` (Task 2).
- Produces: `api.profiles.createMyProfile({ username, displayName, kind, birthDate }) -> Id<"profiles">`; `api.profiles.me() -> Doc<"profiles"> | null`; `internal.profiles.ensureHouse() -> Id<"profiles">`; in `convex/lib/access.ts`: `requireProfile(ctx) -> Doc<"profiles">` (throws if not signed in, no profile, banned, or email unverified), `isAdmin(ctx) -> boolean` (email in `ADMIN_EMAILS`).

- [ ] **Step 1: Write failing tests** with `convex-test` and a signed-in identity:
  - `createMyProfile` with birthDate making the user 12 throws `"You must be 13 or older"`.
  - Duplicate username (any case) throws `"Username taken"`.
  - A new profile is friends with the house profile and `top8` equals `[houseId]`; house profile is created from `HOUSE_USERNAME` / `HOUSE_DISPLAY_NAME` if missing.
  - Second call for the same user throws `"Profile already exists"`.
- [ ] **Step 2: Run** `npm test -- signup`, expect FAIL.
- [ ] **Step 3: Implement** Convex Auth with `Password({ verify: ResendOTP, reset: ResendOTPPasswordReset })` (sender `AUTH_EMAIL_FROM`), the mutations above, and the three pages styled like the classic login box. Signup flow: email, password, verify code, then username, display name, fan/artist, date of birth. `lastLoginAt` updates on `me()` callers via a `touchLogin` mutation called once per session.
- [ ] **Step 4: Run** `npm test`, expect PASS. Manually sign up locally and confirm the verification email arrives (or the code is logged when `AUTH_RESEND_KEY` is unset).
- [ ] **Step 5: Commit** `feat: add accounts, signup and house friend`

### Task 4: Classic chrome and static pages

**Files:**
- Create: `app/globals.css`, `app/layout.tsx`, `components/Header.tsx`, `components/NavBar.tsx`, `components/Footer.tsx`, `components/Box.tsx`, `app/coming-soon/page.tsx`, `app/(static)/{about,faq,terms,privacy,safety}/page.tsx`, `assets/logo.svg` (new OpenSpace wordmark)
- Test: `e2e/chrome.spec.ts`

**Interfaces:**
- Produces: `<Box title color="orange" | "blue">children</Box>`; `<Header />` with search (MySpace/People/Music radios posting to `/search?q=&type=`); `<NavBar />` with links Home, Browse, Search, Invite, Mail, Blog, Favorites, Forum, Groups, Events, Music, Bulletins (coming-soon items go to `/coming-soon?f=<name>`).

- [ ] **Step 1: Write failing e2e test**: `/about` shows the header text "OpenSpace" and "a place for friends", the nav has 12 links, footer has "Report Abuse"; `/coming-soon?f=blog` shows "Blog is coming soon".
- [ ] **Step 2: Run** `npm run test:e2e -- chrome`, expect FAIL.
- [ ] **Step 3: Implement** the chrome to match the mockup header, nav and footer. Privacy page includes: "Artist pages can load images, audio, video and scripts from other websites. Those websites can see your IP address when you view an artist page." Terms set the 13+ age rule.
- [ ] **Step 4: Run** the e2e test, expect PASS. Screenshot `/about` beside the mockup and compare.
- [ ] **Step 5: Commit** `feat: add classic chrome and static pages`

### Task 5: Homepage

**Files:**
- Create: `convex/home.ts`, `convex/shows.ts` (query part), `app/page.tsx`, `components/LoginBox.tsx`, `components/PhotoGrid.tsx`
- Test: `tests/convex/home.test.ts`, `e2e/home.spec.ts`

**Interfaces:**
- Consumes: `requireProfile` (Task 3).
- Produces: `api.home.coolNewPeople() -> PublicCard[]` (5 newest unbanned fan profiles with photos, excluding house); `api.home.coolNewMusic() -> PublicCard[]` (5 newest unbanned artists with at least one track); `api.shows.upcoming({ limit }) -> Array<{ date, venue, city, artist: PublicCard }>` (today onward, ascending); `api.home.dashboard() -> { me: PublicCard, pendingRequests: PublicCard[], bulletins: BulletinView[] }`. `type PublicCard = { username, displayName, photoUrl: string | null, kind }`. `photoUrl(key?: string): string | null` in `convex/lib/media.ts` builds `NEXT_PUBLIC_R2_PUBLIC_URL/key`.

- [ ] **Step 1: Write failing tests**: `coolNewPeople` excludes banned and house profiles and returns at most 5; `coolNewMusic` excludes artists with no tracks; `upcoming` excludes past shows and sorts ascending.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** queries and the homepage: logged out matches the mockup left frame; logged in shows "Hello, <name>!", photo, "View My: Profile | Edit Profile", friend requests waiting (accept/decline), bulletins from friends and the same Cool New boxes. Banner slot shows a house message.
- [ ] **Step 4: Run** unit and e2e tests (`e2e/home.spec.ts`: logged-out page has "Member Login" and "SIGN UP!"), expect PASS.
- [ ] **Step 5: Commit** `feat: add classic homepage`

### Task 6: Profile document renderer and CSP

**Files:**
- Create: `lib/profile/render.ts`, `lib/profile/csp.ts`, `lib/profile/profile.css` (inlined into the document)
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `tokenizeComment` (Task 2).
- Produces: `type PublicProfile = { username, displayName, kind, headline, location, gender?, genre?, aboutMe, whoIdLikeToMeet, interests?, band?, photoUrl: string | null, profileViews, lastLoginAt, memberSince, friendCount, top8: PublicCard[], comments: Array<{ author: PublicCard; body: string; createdAt: number }>, commentCount, latestBulletin: { body; createdAt } | null, tracks: Array<{ title; url; autoplay }>, shows: Array<{ date; venue; city }>, custom: { css: string; html: string; js: string } }`; `renderProfileDocument(p: PublicProfile, opts: { mainOrigin: string }): string`; `buildUsercontentCsp(usercontentOrigin: string): string`.

Document layout: the right and left columns from the mockup, minus the site header and nav (those live in the trusted strip). Contacting box links post bridge messages (Task 7). Data is exposed as `window.OPENSPACE = <json>` with `<`, `>`, `&`, U+2028 and U+2029 escaped as `\uXXXX`. Order in `<head>`: profile.css, then `<style>` with custom CSS. Custom HTML goes into the About me blurb. Custom JS goes in a final `<script>` (artists only). The player autoplays the `autoplay` track on first `pointerdown` in the document and has a mute button.

- [ ] **Step 1: Write failing tests**

```ts
test("escapes user text", () => {
  const html = renderProfileDocument(fan({ aboutMe: "</script><b>x", comments: [c("<img src=x onerror=alert(1)>")] }), opts);
  expect(html).not.toContain("<img src=x onerror");
  expect(html).not.toMatch(/<\/script><b>x/);
});
test("fans never get custom JS or HTML", () => {
  const html = renderProfileDocument(fan({ custom: { css: "body{}", html: "<marquee>", js: "alert(1)" } }), opts);
  expect(html).toContain("body{}");
  expect(html).not.toContain("alert(1)");
  expect(html).not.toContain("<marquee>");
});
test("artists get custom code and the player", () => {
  const html = renderProfileDocument(artist({ custom: { css: "", html: "<marquee>hi</marquee>", js: "console.log(1)" }, tracks: [t("Red Dust", true)] }), opts);
  expect(html).toContain("<marquee>hi</marquee>");
  expect(html).toContain("console.log(1)");
  expect(html).toContain("Red Dust");
});
test("custom CSS cannot close its style block", () => {
  const html = renderProfileDocument(fan({ custom: { css: "</style><script>alert(1)</script>", html: "", js: "" } }), opts);
  expect(html).not.toContain("<script>alert(1)</script>");
});
test("image comments render as images", () => {
  expect(renderProfileDocument(fan({ comments: [c("https://x.com/a.gif")] }), opts)).toContain('<img src="https://x.com/a.gif"');
});
test("empty profile renders defaults", () => {
  const html = renderProfileDocument(fan({ photoUrl: null, comments: [], top8: [] }), opts);
  expect(html).toContain("has 0 friends");
  expect(html).toContain("default-photo");
});
test("csp", () => {
  const csp = buildUsercontentCsp("http://127.0.0.1:3000");
  expect(csp).toContain("connect-src http://127.0.0.1:3000");
  expect(csp).toContain("form-action 'none'");
  expect(csp).not.toContain("allow-same-origin");
});
```

- [ ] **Step 2: Run** `npm test -- render`, expect FAIL.
- [ ] **Step 3: Implement** with a small `escapeHtml` and the CSP string from Global constraints. Custom CSS is made safe by replacing `</style` (case-insensitive) with `<\/style`.
- [ ] **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat: render classic profile documents`

### Task 7: Profile page, usercontent route and bridge

**Files:**
- Create: `convex/profiles.ts` (`getPublicProfile`, `recordView`), `app/usercontent/[username]/route.ts`, `app/[username]/page.tsx`, `components/TrustedStrip.tsx`, `components/ProfileFrame.tsx`, `components/ConfirmDialog.tsx`, `lib/bridge.ts`
- Test: `tests/bridge.test.ts`, `e2e/sandbox.spec.ts`

**Interfaces:**
- Consumes: `renderProfileDocument`, `buildUsercontentCsp` (Task 6), `routeForHost` (Task 1).
- Produces: `api.profiles.getPublicProfile({ username }) -> PublicProfile | { unavailable: true } | null` (banned returns `{ unavailable: true }`); `api.profiles.recordView({ username })`; `type BridgeMessage = { type: "openspace:action"; action: "addFriend" | "addComment" | "report" | "block" | "forward" | "message" } | { type: "openspace:resize"; height: number } | { type: "openspace:navigate"; username: string }`; `parseBridgeMessage(ev: { origin: string; data: unknown; source: unknown }, frame: unknown): BridgeMessage | null`. Bridge script in the document: `window.openspace.request(action)`.

The route handler fetches `getPublicProfile` with `ConvexHttpClient`, returns the document with `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. It returns 404 on the main host. The profile page renders `<Header/>`, `<NavBar/>`, `<TrustedStrip/>` (Add to Friends, Add Comment, Report, Block, all working directly), then `<ProfileFrame/>`: an iframe of `${USERCONTENT_ORIGIN}/${username}` with the Global constraints sandbox and allow attributes, resized from `openspace:resize`. Bridge actions open `ConfirmDialog` in the parent, which the iframe cannot draw over, before calling the Task 8/9 mutations. A banned profile shows "This profile is unavailable" without an iframe.

- [ ] **Step 1: Write failing unit tests**: `parseBridgeMessage` accepts only `origin === "null"` and `source === frame`; rejects unknown types, non-numeric heights and heights over 50000.
- [ ] **Step 2: Write failing e2e security test** (`e2e/sandbox.spec.ts`) using a seeded artist whose custom JS writes results into `document.title` inside the frame:
  - `document.cookie` is `""` and `localStorage` access throws.
  - `fetch(MAIN_ORIGIN + "/api/anything")` rejects (CSP).
  - `parent.document` access throws.
  - Submitting a `<form action=MAIN_ORIGIN>` does not navigate.
  - Calling `openspace.request("addFriend")` shows the parent confirm dialog and nothing changes until "Confirm" is clicked in the parent.
  - `MAIN_ORIGIN/usercontent/lowveld` returns 404.
- [ ] **Step 3: Run** both, expect FAIL.
- [ ] **Step 4: Implement** the files above. `recordView` increments `profileViews` once per page load from the parent page.
- [ ] **Step 5: Run** both, expect PASS.
- [ ] **Step 6: Commit** `feat: sandboxed profile pages with trusted controls`

### Task 8: Friends, Top 8 and block

**Files:**
- Create: `convex/social.ts`, `app/[username]/friends/page.tsx`, `convex/convex.config.ts` (add `rateLimiter`), `convex/lib/limits.ts`
- Test: `tests/convex/social.test.ts`

**Interfaces:**
- Consumes: `requireProfile`.
- Produces: `api.social.sendFriendRequest({ to: Id<"profiles"> })`, `respondFriendRequest({ requestId, accept: boolean })`, `removeFriend({ other })`, `setTop8({ ids: Id<"profiles">[] })`, `block({ other })`, `unblock({ other })`, `listFriends({ username, cursor }) -> paginated PublicCard[]`, `areFriends(ctx, a, b): Promise<boolean>`, `isBlockedEitherWay(ctx, a, b): Promise<boolean>` (helpers in `convex/lib/access.ts`).

- [ ] **Step 1: Write failing tests**:
  - Request then accept creates one friendship; duplicate request throws `"Request already sent"`; requesting an existing friend throws `"Already friends"`.
  - A blocked user cannot send a request (`"Not allowed"`).
  - `setTop8` rejects non-friends and more than 8 ids.
  - `removeFriend` removes the other from both users' `top8`.
  - `block` also removes the friendship and Top 8 entries.
  - Banned profiles are omitted from `top8` cards and `listFriends`.
  - The 51st request in an hour throws `"Slow down"`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement**, with `@convex-dev/rate-limiter` configured in `convex/lib/limits.ts` (values from Global constraints). Friends page lists all friends in the classic grid.
- [ ] **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat: friends, Top 8 and blocking`

### Task 9: Comments and bulletins

**Files:**
- Create: `convex/comments.ts`, `convex/bulletins.ts`, `app/[username]/comments/page.tsx`, `app/bulletins/page.tsx`, `components/CommentForm.tsx`
- Test: `tests/convex/comments.test.ts`, `tests/convex/bulletins.test.ts`

**Interfaces:**
- Consumes: `requireProfile`, `isBlockedEitherWay`, `containsLink`, rate limiter.
- Produces: `api.comments.add({ profileId, body })`, `remove({ commentId })`, `list({ username, cursor })`; `api.bulletins.post({ body })`, `remove({ bulletinId })`, `feed() -> BulletinView[]`. Body limits: comment 2000 chars, bulletin 5000 chars, trimmed, non-empty.

- [ ] **Step 1: Write failing tests**:
  - Only the profile owner or comment author can remove a comment.
  - A blocked user cannot comment, and their old comments are hidden from the profile owner's wall.
  - An account under 24 hours old posting a link throws `"New accounts can't post links yet"`; an image URL counts as a link.
  - `feed` returns only friends' bulletins from the last 10 days, newest first, excluding banned authors and hidden posts.
  - The 31st comment in an hour throws `"Slow down"`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement**. The parent profile page reloads the iframe after a successful comment. The comments page and bulletins page render with `tokenizeComment` in React (no `dangerouslySetInnerHTML`).
- [ ] **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat: comments and bulletins`

### Task 10: Uploads to R2 (photos and tracks)

**Files:**
- Create: `convex/media.ts`
- Modify: `convex/convex.config.ts` (add `r2`; `rateLimiter` was added in Task 8), `convex/lib/media.ts` (add `trackUrl` beside `photoUrl` from Task 5)
- Test: `tests/convex/media.test.ts`

**Interfaces:**
- Produces: `export const { generateUploadUrl, syncMetadata } = r2.clientApi({ checkUpload, onUpload })` in `convex/media.ts`, with the purpose passed by calling `api.media.beginUpload({ purpose: "photo" | "track", title? }) -> { uploadId }` first; `api.media.reorderTracks({ ids })`, `setAutoplay({ trackId })`, `renameTrack({ trackId, title })`, `deleteTrack({ trackId })`. Client: `useUploadFile(api.media)` from `@convex-dev/r2/react`.

- [ ] **Step 1: Write failing tests** (mock the R2 component metadata):
  - A fan starting a track upload throws `"Only artists can upload tracks"`.
  - An 11th track throws `"Maximum 10 tracks"`.
  - `onUpload` with size over 5 MB or type other than `audio/mpeg` deletes the object and records no track; photos over 2 MB or wrong type likewise.
  - First uploaded track is `autoplay: true`; `setAutoplay` leaves exactly one autoplay track; deleting the autoplay track moves autoplay to the next by order.
  - New photo replaces `photoKey` and deletes the old object.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** with `@convex-dev/r2`. Public URLs come from `NEXT_PUBLIC_R2_PUBLIC_URL`. Bucket CORS must allow PUT from `MAIN_ORIGIN`; document this in the README in Task 14.
- [ ] **Step 4: Run**, expect PASS. Upload a real MP3 locally and play it on a profile.
- [ ] **Step 5: Commit** `feat: photo and track uploads to R2`

### Task 11: Edit profile

**Files:**
- Create: `app/edit/page.tsx`, `components/edit/{DetailsForm,PhotoForm,Top8Picker,TracksForm,ShowsForm,CodeEditor}.tsx`, `convex/profiles.ts` (update part), `convex/shows.ts` (mutations)
- Test: `tests/convex/edit.test.ts`, `e2e/edit.spec.ts`

**Interfaces:**
- Consumes: Tasks 8 (`setTop8`), 10 (uploads), 6 (`renderProfileDocument` for preview).
- Produces: `api.profiles.updateDetails({ ...editable fields })`, `updateCustomCode({ css, html, js })`, `becomeArtist()`; `api.shows.add({ date, venue, city })`, `remove({ showId })`.

- [ ] **Step 1: Write failing tests**:
  - `updateCustomCode` over 100 KB total (UTF-8 bytes) throws `"Custom code is limited to 100 KB"`.
  - A fan calling `updateCustomCode` with non-empty `html` or `js` throws `"Fans can use CSS only"`.
  - `becomeArtist` switches `kind` to `artist` and is a no-op for artists.
  - `shows.add` rejects bad dates and fans.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement**. The code editor is three plain textareas (HTML, CSS, JavaScript; fans see CSS only) with a byte counter and a "Preview" button that shows the document in the same sandboxed iframe via `srcdoc`. Sections in classic 2006 edit-page style.
- [ ] **Step 4: Run** unit tests and `e2e/edit.spec.ts` (artist pastes `<marquee>hi</marquee>`, saves, profile frame shows "hi"), expect PASS.
- [ ] **Step 5: Commit** `feat: edit profile and custom code`

### Task 12: Browse and search

**Files:**
- Create: `convex/search.ts`, `app/browse/page.tsx`, `app/search/page.tsx`
- Test: `tests/convex/search.test.ts`

**Interfaces:**
- Produces: `api.search.people({ q, kind?: "fan" | "artist", cursor })` using a Convex search index `search_name` on `profiles` over `displayName` with `username` and `banned` filter fields; `api.search.browse({ kind?, location?, genre?, cursor })`.

- [ ] **Step 1: Write failing tests**: search finds by display name and exact username; banned profiles never appear; `kind: "artist"` excludes fans.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** (add the search index to `convex/schema.ts`). Results use the classic photo grid.
- [ ] **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat: browse and search`

### Task 13: Moderation

**Files:**
- Create: `convex/moderation.ts`, `app/admin/page.tsx`
- Modify: `convex/lib/access.ts` (`requireProfile` rejects banned)
- Test: `tests/convex/moderation.test.ts`

**Interfaces:**
- Consumes: `isAdmin`.
- Produces: `api.moderation.report({ targetType, targetId, reason })`, `listOpen()`, `hide({ reportId })`, `dismiss({ reportId })`, `ban({ profileId })`, `unban({ profileId })`.

- [ ] **Step 1: Write failing tests**:
  - Non-admins calling `listOpen`, `hide`, `ban` throw `"Not allowed"`.
  - `hide` on a comment report sets `hidden: true` and the comment leaves the profile wall; on a track it deletes the track; on a profile it bans.
  - `ban` makes `getPublicProfile` return `{ unavailable: true }`, makes every mutation by that user throw, and removes them from Cool New People, search, Top 8 cards and bulletin feeds.
  - The house profile cannot be banned.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement**. Banned users who sign in see a "Your account has been suspended" page. Admin page lists open reports with a preview of the content and three buttons.
- [ ] **Step 4: Run**, expect PASS.
- [ ] **Step 5: Commit** `feat: reports, admin queue and bans`

### Task 14: Seed data, README and deploy

**Files:**
- Create: `convex/seed.ts`, `scripts/seed-audio/` (three short silent MP3s generated with ffmpeg, under 100 KB each), `docs/deploy.md`
- Modify: `README.md`, `.env.example`
- Test: `tests/convex/seed.test.ts`

**Interfaces:**
- Produces: `internal.seed.run()` (idempotent), run by `npx convex run seed:run`.

- [ ] **Step 1: Write failing test**: running `seed.run` twice leaves exactly 8 fans, 5 artists with tracks and shows, and at least 20 comments.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** the seed (fictional names from the mockup: Lowveld, Nightjar, Paper Moons, DJ Fynbos, The Static Kids; fans Jess, Marco, Thandi, Kyle, Ren, plus three more) uploading the silent MP3s to R2.
- [ ] **Step 4: Write README and `docs/deploy.md`**: what OpenSpace is, screenshot, local setup, Convex deploy, R2 bucket with public domain and CORS, Resend, Vercel project with both domains attached, every env var, setting admins and the house account, AGPL note.
- [ ] **Step 5: Run** the full suite: `npm test && npm run test:e2e && npm run build`, expect all PASS.
- [ ] **Step 6: Commit** `feat: seed data and deploy docs`
