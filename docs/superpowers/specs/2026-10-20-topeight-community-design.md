# TopEight community features design

Date: 2026-10-20
Status: approved by owner, 2026-10-20

## Intent

TopEight's profiles, friends, comments and music work. The nav still shows Mail, Blog, Events, Groups and Favorites as "coming soon". The owner asked to build all of them, plus a hardening pass before launch. The point is the same as the rest of the site: make it feel like 2006 MySpace, where people came back every day to check messages, read friends' blogs and see what was on this weekend.

## Scope and order

Built in this order, each shippable on its own:

1. Pre-launch hardening (no new pages)
2. Mail (private messages)
3. Blog
4. Favorites (small, rides along with Mail)
5. Events
6. Groups (with message boards)

Invite (needs real email sending) and Forum stay "coming soon". Groups' message boards cover what Forum would have been.

## Goals

- Every "coming soon" nav item above becomes a working page.
- Nothing new lets a stranger reach someone who didn't invite contact. Spam and harassment controls ship with each feature, not after.
- Every new kind of user content can be reported and hidden from `/admin`, and banned or blocked users disappear from it, the same as comments.
- All reads stay bounded, as in the rest of the codebase.

## Non-goals

- Real-time chat or instant messaging. Mail is message-based like 2006, with live unread counts.
- Email notifications (Resend is not live yet).
- Rich text editors. All new text is plain text with the existing comment rules (image URLs show as pictures, links clickable, no HTML).
- Private or invite-only groups.

## Anti-goals

- Admins reading private mail that nobody reported.
- A message, blog post or group post able to run code. Artist custom code stays confined to the profile sandbox.

## Shared rules (apply to every feature)

- Text rendering reuses `tokenizeComment` and the React renderer the comments page uses.
- The 24-hour no-links rule for new accounts applies to messages, blog posts, blog comments, event descriptions, group posts and replies.
- Blocks apply both ways: a blocked pair cannot message each other, comment on each other's blog, or see each other's group posts.
- Banned users' content is hidden everywhere.
- Each new content type gets a Report link and a `reports.targetType`, with admin Hide.
- Rate limits use the existing limiter, error "Slow down".

## 1. Pre-launch hardening

Picked from the deferred review findings:

- Rate limit `?format=tracks` refreshes and `playbackUrls` per IP-less key (per username, 120/min) so a loop can't burn Convex calls.
- Add a small `profileHeader` query (name, banned, kind) and use it on the profile page and the tracks endpoint instead of the full `getPublicProfile`.
- Fix the suspended-gate flash (render nothing while `me` loads).
- Browser tests for: a signed-in song report reaching the admin queue, admin Play using a signed link, the suspended page, and the header search form.
- Remove the duplicated `errorText` helpers into one shared helper.

## 2. Mail

Like 2006 MySpace mail: subject lines, inbox, sent, no threads.

- **Who can message whom:** friends can always message each other. Each user has a setting, "Who can send me messages": Friends only (default) or Anyone. Blocks override both. *(Claude's call: friends-only default keeps spam off a public site.)*
- **Composing:** "Send Message" in a profile's Contacting box and trusted strip opens `/mail/compose?to=<username>`. Subject up to 100 characters, body up to 5,000. Reply prefills "Re: " and quotes the original below a line.
- **Folders:** Inbox and Sent, 25 per page, newest first. Each side can delete its own copy without affecting the other.
- **Unread:** the header shows a flashing orange "New Messages!" link while you have unread mail, like 2006. Opening a message marks it read.
- **Limits:** 30 messages per hour, 200 per day. New accounts can't send links for 24 hours.
- **Moderation:** Report on a received message sends that one message to `/admin`. Admins see only reported messages.
- **Favorites:** "Add to Favorites" in the Contacting box saves a profile to `/favorites`, a simple grid with Remove. Private to you. Max 500.

## 3. Blog

- Every profile gets `/<username>/blog`: posts newest first, 10 per page, and each post has its own page.
- **Post fields:** title (up to 100), body (up to 20,000), optional "Current mood" (a short text plus one of about 20 classic mood emoticons), optional "Currently listening" (text). *(Claude's call: mood and listening are the 2006 touch.)*
- **Comments:** any signed-in user can comment unless blocked either way. The author can delete any comment on their posts.
- **Profile box:** the profile's "Latest Blog Entry" box shows the newest post title and date with a link. Artist custom code can read this like other public profile data.
- **Limits:** 10 posts per day, 30 comments per hour (shared with profile comments).
- **Moderation:** Report on posts and comments.
- Nav "Blog" goes to a "Recent posts from friends" page, with a link to your own blog and "Write a new post".

## 4. Events

General events anyone can post, separate from artists' Shows.

- **Fields:** title, date and start time, venue, city, description (up to 5,000), optional image URL shown with the comment image rules.
- **Pages:** `/events` lists upcoming events, soonest first, with a city filter. `/events/<id>` shows the event, the host, and who's going.
- **RSVP:** Going or Maybe, one click, changeable. The event page shows counts and a grid of up to 24 attendees going.
- **Artist shows:** artists' upcoming shows also appear in `/events` as read-only entries linking to the artist. *(Claude's call: one place to see what's on.)*
- **Hosts** can edit or cancel their event. Cancelled events stay visible with "Cancelled".
- **Limits:** 5 new events per day.
- **Moderation:** Report and admin Hide.

## 5. Groups

- **Create:** any user with an account older than 7 days can create a group: name (unique, up to 60), description, a photo (same photo upload rules), and a category from a fixed list (Music, Local, Hobbies, Fan clubs, Other). *(Claude's call: the 7-day rule slows spam groups.)*
- **Join:** public groups, one-click Join and Leave. The group page shows members and the board.
- **Board:** members can start topics (title plus first post) and reply. Topics sort by latest reply. 20 topics per page, 50 replies per page.
- **Owner tools:** the creator can remove posts, remove and ban members, and hand over ownership. Deleting a group hides it, and admins can restore it.
- **Pages:** `/groups` with category tabs and search by name, `/groups/<slug>`, `/groups/<slug>/t/<topicId>`.
- **Limits:** 3 new groups per day, 10 topics per hour, 60 replies per hour.
- **Moderation:** Report on groups, topics and replies.

## Calls made by Claude after the builder check

- Blocks, friendships and account age already exist (`blocks` table, `friendships` table, profile `_creationTime`). The 24-hour and 7-day rules use the profile's `_creationTime`.
- A mail report copies the reported message's subject and body into the report row, so it survives either side deleting their copy. Admins never get a general read path into mail.
- "Recent posts from friends" reads the 300 most recent friendships, the same bounded pattern as the bulletins feed. A fan-out feed table is the long-term fix.
- The unread count is bounded: the header shows "New Messages!" when any unread exists, and the inbox shows the count up to "99+".
- Banned hosts' events and banned users' RSVPs are hidden and not counted. A banned owner's group stays up, and admins can hand ownership to another member from `/admin`.
- Events store the host's chosen IANA timezone (defaulting to the host's browser timezone) with the local date and time. "Upcoming" compares in UTC, and pages show the event's own local time with the timezone abbreviation.
- `/events` merges events and artist shows with a bounded read of each (newest 100 upcoming per source), then sorts. City filtering applies to both.
- A group's slug is set from its name at creation and never changes. The display name can be edited.
- Blocked pairs in groups: the viewer's own blocks filter topics and replies on read, within the page that was fetched (short pages accepted, the existing pattern).

## Left to the builder

- Schema, indexes and function layout, following existing patterns.
- Exact page layouts, matched to the 2006 look and existing Box styles.
- The mood emoticon set (drawn as small inline SVGs or Unicode, no MySpace artwork).

## Open items

- None blocking. Email notifications for mail wait for Resend.
