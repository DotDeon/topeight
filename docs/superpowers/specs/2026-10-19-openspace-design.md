# OpenSpace design

Date: 2026-10-19
Status: approved by owner, 2026-10-19

## Intent

OpenSpace is an open source rebuild of MySpace as it looked around 2006. Anyone
can sign up. Landing on it should feel exactly like landing on the old MySpace
homepage. The point of the site is artist pages: artists get the classic profile
layout and can rewrite it with their own HTML, CSS and JavaScript, the way people
pasted code into "About me" in 2006, but with full JavaScript allowed.

The project is open source, so anyone can read the code and run their own copy.

## Decisions made by the owner

- Public site. Anyone can sign up.
- The homepage is a faithful copy of the 2006 MySpace homepage. The approved
  layout mockup is `docs/superpowers/specs/2026-10-19-openspace-mockup.html`.
  The mockup predates the name, so "myspace.com" in its logo becomes
  "OpenSpace" with the same tagline style.
- Everyone gets a profile in the classic layout. Fans and artists share the same
  page structure.
- Artist profiles start from the classic layout and can be customised with the
  artist's own HTML, CSS and JavaScript.
- Artist pages have all four of: a music player with uploaded tracks, Top 8 and
  friend requests, a comments wall, and shows and bulletins.
- Stack: Next.js hosted on Vercel, with Convex for the database, logins and file
  storage.
- The name is OpenSpace, and the code is open source.
- Approved from the mockup: a default first friend in everyone's Top 8 (the
  "Tom" role), and Report and Block links in every profile's Contacting box.

## Goals

1. Someone who used MySpace in 2006 recognises the homepage and profile pages
   within a second of seeing them.
2. An artist can sign up, upload tracks, add shows, paste in custom code and
   share a working profile URL within 15 minutes.
3. Artist JavaScript can do anything visual on the artist's own profile and can
   never read or act on a visitor's OpenSpace login.
4. A stranger can clone the repo and run their own OpenSpace by following the
   README.

## Non-goals for the first version

- Mobile apps. The site is desktop first, like the original. It should not break
  on a phone, but it does not need a mobile layout.
- Private messages (the "Send Message" link). It appears in the layout but can
  show "coming soon". See open items.
- Blogs, groups, forums, videos, classifieds and the other nav items. They appear
  in the nav bar for the look and lead to a simple "coming soon" page.
- Paid features, ads or analytics. The banner slot shows a house message.

## Anti-goals

These would make the project a failure even if everything else works.

- A modern, cleaned-up redesign. Verdana at 10px, the blue header and the orange
  boxes stay.
- Any path for profile code to reach the main site's cookies, session tokens or
  Convex auth. A repeat of the 2005 Samy worm is the worst outcome.
- Hardcoded secrets, domains or owner-specific names in the code. Self-hosters
  set these through environment variables.

## How it works

### Pages

- `/` homepage, logged out: header with search, nav bar, banner slot, Cool New
  People, Cool New Music, announcements, Member Login box with Sign Up, upcoming
  shows across all artists, footer links.
- `/` homepage, logged in: the classic logged-in home, with the user's photo,
  friend requests waiting, latest bulletins from friends and links to edit the
  profile. Builder chooses the exact contents from the 2006 logged-in home.
- `/signup`, `/login`, password reset.
- `/<username>` profile page in the classic layout from the mockup.
- `/<username>/friends` all friends.
- `/<username>/comments` all comments.
- `/edit` edit profile: details, photo, Top 8 order, and for artists the
  tracks, shows, band details and custom code.
- `/bulletins` bulletins from friends, and posting a new one.
- `/browse` and `/search` for people and music.
- `/admin` moderation queue, admin only.
- Footer pages: About, FAQ, Terms, Privacy, Safety Tips, Report Abuse.

### Accounts

- Sign up with email and password through Convex Auth. Email verification is
  required before posting comments or bulletins.
- At signup the user picks fan or artist. A fan can switch to artist later from
  the edit page. Switching back is not needed.
- Minimum age 13, checked by a date of birth field at signup.
- Every new account is automatically friends with the house account, and the
  house account fills the first Top 8 slot until the user changes it. The house
  account's username and display name come from config, so a self-hoster can
  name it anything.
- Admin accounts are set by an environment variable listing admin emails.

### Profiles

All profiles share the classic two-column layout:

- Left: display name, photo, headline quote, gender/age/location for fans or
  genre/location for artists, profile views, last login, "View My: Pics",
  Contacting box (Send Message, Add to Friends, Forward to Friend, Add to
  Favorites, Report, Block User), profile URL, details table.
- Right: "is in your extended network" box, latest bulletin, blurbs (About me,
  Who I'd like to meet), Friend Space with friend count and Top 8, comments
  wall showing the latest 10 with View All and Add Comment.

Artist profiles add:

- A music player at the top of the left column.
- An Upcoming Shows table on the right.
- Band details (members, influences, sounds like, record label) in place of the
  fan details table.

### Music

- An artist can upload up to 10 MP3 tracks, 5 MB each (owner decision; about 5 minutes at 128 kbps), stored in Convex file
  storage.
- The artist sets track order and picks which one autoplays.
- Visitors see a play/pause, a progress bar, the track list and a mute control.
  Because browsers block autoplay with sound until the visitor interacts, the
  player starts the moment the visitor first clicks anywhere on the page.

### Custom code (the sandbox)

This is the most important technical part.

- The main site runs on the main domain (for example `openspace.example`).
- Custom profile code is served from a second domain that shares no cookies with
  the main one (for example `openspaceusercontent.example`). Both domains come
  from environment variables. In local development they are `localhost:3000`
  and `127.0.0.1:3001`.
- An artist profile page on the main domain has two parts. At the top is a thin
  strip of trusted OpenSpace controls that artist code cannot touch: Add to
  Friends, Add Comment, Report and Block, plus the site header and nav. Below it
  is one iframe from the usercontent domain that renders the rest of the classic
  profile plus the artist's HTML, CSS and JavaScript. The artist may restyle or
  replace anything inside the iframe, including the duplicate Contacting box
  links, but the trusted strip always works. (Owner decision.) The iframe gets
  `sandbox="allow-scripts allow-popups"` with no `allow-same-origin`, so its
  code runs in an opaque origin with no access to any cookies or storage.
- Profile data the artist's code may read (name, tracks, shows, Top 8, latest
  comments) is passed into the iframe as public data. Nothing private goes in.
- Actions that need the visitor's login (Add to Friends, Add Comment, Report)
  must not run inside the iframe. The iframe sends a request to the parent page
  with `postMessage`, and the parent page, which holds the login, shows its own
  confirmation step before acting. Artist code can therefore ask to add a friend
  but can never do it without the visitor clicking in a box the artist cannot
  draw over. The builder designs the exact confirmation UI.
- Outside content (owner decision): the usercontent domain's content security
  policy allows images, audio, video and iframe embeds (YouTube, SoundCloud and
  similar) from any origin, and allows scripts from any origin. It sets
  `form-action 'none'` so artist pages cannot post forms anywhere, and limits
  `connect-src` to the usercontent domain itself so artist code cannot send data
  out with fetch or WebSockets. The Privacy page states that artist pages can
  load outside content, which means outside sites may see a visitor's IP
  address.
- Fans get custom CSS only, applied in the same sandboxed iframe approach so the
  same code path covers both. No JavaScript for fans.
- The artist edits the code in a plain text area on `/edit`, with a preview.
  Size limit 100 KB.

### Social

- Friend requests need the other person to accept.
- Each user picks their Top 8 from their friends, in order.
- Comments and bulletins are plain text (owner decision). URLs ending in an
  image extension, or from an allowed image host list, show as pictures, so
  picture comments work like 2006. No other HTML is allowed. Comments are
  rendered by OpenSpace code, never by artist code, and are passed into the
  iframe as escaped text.
- Comments appear immediately. The profile owner can delete any comment on
  their profile. The author can delete their own comment.
- Bulletins go to all of the poster's friends and show on their logged-in home
  and on `/bulletins`. Bulletins older than 10 days drop off, like the original.
- Block hides the blocked user's comments and stops them sending friend
  requests or commenting.
- Convex live queries keep friend requests, comments and bulletins up to date
  without a refresh.

### Moderation

- Every profile, comment, bulletin and track has a Report link with a reason.
- `/admin` lists open reports. The admin can hide the content, dismiss the
  report, or ban the account. Banned accounts cannot log in and their profile
  shows "This profile is unavailable".
- Rate limits on comments, bulletins and friend requests per account per hour.
- Accounts younger than 24 hours cannot post links in comments or bulletins.

### Open source

- License: AGPL-3.0 (builder's note: this was Claude's call, see below).
- README covers: what it is, screenshots, running locally, deploying your own
  copy to Vercel and Convex, setting both domains, setting admins and the house
  account.
- `.env.example` lists every setting. Nothing owner-specific is committed.
- Seed script that creates demo fans, demo artists with silent sample tracks,
  shows and comments, so a fresh copy looks alive.

## Calls made by Claude, not the owner

- AGPL-3.0 license, so anyone who runs a modified public copy must share their
  changes. MIT is the alternative if wide reuse matters more than that.
- Fan or artist chosen at signup, fan can switch to artist later.
- Minimum age 13.
- 10 tracks, 100 KB custom code limit. (5 MB per track was the owner's call.)
- Fans get CSS only, artists get JavaScript.
- New accounts cannot post links for 24 hours.
- The owner is the only admin at launch, set by environment variable.
- Profile actions from artist code go through a parent-page confirmation.
- Private messages, blogs, groups and the other nav items are "coming soon".
- All artwork is recreated. No logos, icons or images copied from MySpace go in
  the repo, because the repo is public and those assets belong to someone else.
  The look comes from CSS, system fonts (Verdana, Arial) and new artwork.

## Left to the builder

- Exact pixel matching to 2006 screenshots, and the choice of reference
  screenshots.
- Convex schema, indexes and function layout.
- How the usercontent domain is served on Vercel (second project or the same
  project routed by host).
- Test approach.
- Image sizes and cropping for profile photos.

## Open items

- "OpenSpace" is already used by other companies, including a construction
  software company. This is fine for an open source project but worth checking
  before buying a domain.
