# Venue and label profiles

## Why

TopEight has two kinds of profile, fan and artist. Bands list gigs by hand in Shows, and anyone can post an event, but the venue in both is free text. Nothing ties a band, a venue and a gig together, and a band's record label is only a text box.

Deon wants venues to run their gig guides on TopEight and tag the bands playing, so each gig shows on the venue's profile and on every band's profile from one entry. Labels want a page that promotes their bands. Both give TopEight a reason for fans to come back every week, and gig guides do that most.

## Goals

- Two new profile kinds, venue and label, picked at sign-up next to fan and artist (4 radio options).
- A venue can ask a band to join its roster. A label can ask a band to sign it to the label. The band approves or declines.
- A venue posts gigs as real events, with RSVPs, the city filter and the events page, and picks bands from its roster as the lineup.
- A gig shows on the venue's profile as its gig guide, on each lineup band's profile in Shows, and on the events page.
- A label's profile shows its roster of bands. Each band's profile links to the labels that signed it.
- Either side can remove a roster or label link at any time.

## Non-goals

- No admin approval or verification of venues and labels. Anyone can pick either kind at sign-up.
- Venues and labels can't change kind after sign-up. Fans keep the existing fan to artist switch (`profiles.becomeArtist`), and nothing else switches. (Claude's call: a venue or label turning into an artist would leave stale links and lineups.)
- Labels don't post gigs or tag bands on events in this version.
- No ticketing, payments or capacity tracking.
- No migration of existing free-text shows or events onto venues.

## Anti-goals

- A venue or label must never put itself on a band's profile without the band's approval. That is the whole point of the request flow.
- Band members must not have to re-enter a gig a venue already posted.
- The sandbox and custom code rules must not loosen for the new kinds.

## Decided by Deon

- Kind is chosen at sign-up, with 4 options. No approval step.
- Labels must request to be a band's label, and the band approves.
- Venues must request a band onto their roster, and the band approves.
- Roster approval covers every future gig at that venue. The venue doesn't need per-gig consent.
- Venue gigs are real events with RSVPs.
- The band's free-text "Record label" field stays for labels that aren't on TopEight.

## How it fits the current system

### Profiles

- `profiles.kind` becomes `"fan" | "artist" | "venue" | "label"`. Everything that switches on kind today (about 30 files, heaviest in `convex/profiles.ts`, `lib/profile/render.ts`, `components/AdminQueue.tsx`, `convex/seed.ts`) has to handle the two new values.
- Venues and labels get the artist custom code rules: HTML, CSS and JS, 100 KB, same sandbox.
- Venues and labels don't upload tracks and have no band fields.
- Venue details: address and city (city reuses `location`). Label details: genres they sign (reuses `genre`) and website. Builder may add one or two more fields if the edit form clearly needs them, nothing more.
- Browse and search get Venue and Label filters next to Fan and Artist.

### Links (roster and label)

- One new table holds both kinds of link. Each row has the requesting venue or label, the band, the link type (`venue` or `label`), a status (`pending`, `accepted` or `declined`) and when it was answered. Removing an accepted link deletes the row. A declined row is kept, and the sender can't ask that band again for 7 days, matching `DECLINE_COOLDOWN_MS` for friend requests. (Claude's call: otherwise a venue could re-send the moment a band says no.)
- Only a venue can send a venue request and only a label can send a label request. The target must be an artist profile. One row per pair.
- Requests reach the band where friend requests do today, using the same patterns as `friendRequests` in `convex/social.ts`. Accept and decline buttons live there.
- Either side can remove an accepted link from its profile page or edit page.
- Blocks, bans and rate limits apply as they do for friend requests: a blocked or banned profile can't send requests, and banned profiles drop out of rosters on display.
- A band can have more than one label.

### Gigs

- A venue creates events through the existing events flow. The venue name and city fill in from the venue's profile and can't be edited on its own events.
- The event form gains a lineup picker, shown only to venues, that lists the bands on the venue's roster. Lineup is optional and ordered.
- The lineup is stored so events can be looked up by band (a join table or indexed field, builder's call).
- A band can take itself off one gig's lineup without leaving the roster, and the venue can't add it back to that gig. (Claude's call: it keeps the band in control of a single wrong listing.)
- When a band leaves a venue's roster, it drops off that venue's events that haven't started yet. Past events keep it.
- RSVP, cancel, hide, moderation and the 5-a-day limit work as for any event.

### Where gigs show

- Venue profile: a gig guide section listing its upcoming events, soonest first, with lineup.
- Band profile: the existing Shows section merges the band's own typed shows with upcoming venue events it's on, sorted by date. Venue events link to the event and the venue profile.
- Events page and `events.upcoming` show venue events like any other event, with the lineup on the card.
- `window.TOPEIGHT` exposes the gig guide (venue), roster (venue and label) and labels (band) so custom code can render them.

### Label profile

- A roster section lists accepted bands with their photo and name.
- Band profiles show the TopEight labels they've accepted near the band fields, linking to each label. The free-text label field still shows when filled in.

## Builder's calls

- Table and field names, index design, and how the lineup is stored.
- Layout and wording of the new profile sections, matching the existing classic profile style.
- Limits on roster size and lineup length, chosen to fit `MAX_SCAN` and existing query patterns.
- Seed data and e2e coverage for both new kinds.
- Whether this ships as one PR or a short stack (venues first, then labels).
