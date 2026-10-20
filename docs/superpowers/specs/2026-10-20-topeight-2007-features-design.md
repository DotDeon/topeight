# TopEight 2007 features design

Date: 2026-10-20
Status: approved by owner, 2026-10-20

## Intent

Bring back four things people remember from MySpace around 2007 that TopEight still lacks: a profile song for everyone, "Online Now!", a mood under your photo, and private profiles. The owner picked all four.

## 1. Profile song

- **Who:** any signed-in user, fan or artist, can pick one song as their profile song.
- **Picking:** each track in an artist's player gets an "Add to my profile" link next to Report. It goes through the bridge and the parent's confirm dialog ("Make "<title>" by <artist> your profile song?"), the same pattern as song reports. Edit Profile shows the current pick with Remove.
- **Playing:** a fan's profile shows the classic player with that one song, labelled "<title> by <artist>" with the artist linked. It autoplays on first click like artist pages. Artists keep their own track list; an artist who picks someone else's song gets it at the top of their own player.
- **Artist control:** artists get a setting "Let people use my songs as profile songs", on by default. Turning it off removes their songs from every profile that picked them.
- **Credit:** Edit Profile shows artists "Your songs are on N profiles".
- **When it breaks:** if the track is deleted, the artist is banned or the artist turns sharing off, the song quietly disappears from fan profiles.
- **Playback** uses the same private bucket and 15-minute signed links as artist pages.

## 2. Online Now!

- While a signed-in user has any TopEight tab open and visible, the browser sends a heartbeat every 2 minutes. It writes to a small `presence` table, never to the profile document, so profile queries don't re-run.
- A profile shows the classic orange "Online Now!" badge under the photo when the last heartbeat is under 5 minutes old. Friend grids (Top 8, friends page, Cool New People) show a small version.
- Setting: "Show when I'm online", on by default. Off means nobody sees the badge.
- The profile page is rendered when it loads, so the badge reflects that moment and doesn't flip live. *(Claude's call: live updates inside the sandbox frame would need a new bridge channel for little gain.)*
- Heartbeats are rate limited to 2 per minute per user.

## 3. Mood

- Profiles get a mood: an icon from the existing 20 blog moods plus optional text up to 40 characters.
- Shown on the profile under the headline as "Mood: <icon> <text>", like 2007.
- Set it on Edit Profile, or from a quick "Update your mood" box on the signed-in homepage.
- Artist custom code can read it like the other public profile fields.

## 4. Private profile

- **Setting:** "Private profile: only my friends see my full page". Off by default. *(Claude's call: artists can't go private, because an artist page exists to be heard. Fans only.)*
- **What strangers see** on a private profile: display name, photo, age, location, "Online Now!", mood, and "This profile is set to private. Add <name> as a friend to see more." The trusted strip still offers Add to Friends, Send Message (their mail setting still applies) and Report.
- **What's hidden** from non-friends: the full profile frame (including custom code), comments, Top 8, friends list, blog, latest bulletin and profile song. The pages `/<username>/comments`, `/friends` and `/blog` show the same private notice.
- **Search and browse** still list private profiles by name and photo, like 2007.
- **Admins** can always see everything.
- **The sandbox catch:** the profile frame comes from the second domain, which can't see who is logged in. So the main page asks the server for a short-lived frame pass (5 minutes, signed, tied to that profile) only after confirming the viewer is a friend. The frame's address carries the pass, and the frame server refuses to render a private profile without a valid one. Without this, anyone could open the frame's address directly and read a private page.
- Friends-only content also covers the `?format=tracks` song-link refresh.

## Shared rules

- All new text renders through the existing safe renderer.
- Everything new respects bans and blocks the same way the rest of the site does (a blocked person counts as not a friend).
- Reads stay bounded, and each new write has a rate limit.

## Calls made by Claude after the builder check

- The frame pass lasts 2 hours and is tied to the profile, not the viewer. The song-link refresh inside the frame sends the pass too, so music keeps playing on a private page for a normal visit. Someone who copies a friend's frame address could read the page until the pass expires; a friend could screenshot it anyway, so tying it to the viewer isn't worth the extra machinery.
- Turning song sharing off hides the songs at read time instead of deleting picks. Turning it back on brings them back.
- Switching from fan to artist turns the private setting off.
- With "Show when I'm online" off, the browser stops sending heartbeats and the existing presence row is deleted, so nothing is stored to leak.

## Left to the builder

- Schema shape, function layout, the exact badge artwork (original, no MySpace images), and the frame-pass signing details (an HMAC with a secret from an environment variable, documented in `.env.example` and `docs/deploy.md`).
