import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { friendshipPair } from "./lib/friendships";

/**
 * Demo content so a fresh copy looks alive. Run with `npx convex run seed:run`
 * after setting OPENSPACE_ALLOW_SEED=1 on the deployment, and unset it again.
 *
 * Seed users have a `users` row and no email, so nobody can log in as them.
 * Tracks and photos point at fixed R2 keys that `scripts/seed-media.mjs` uploads.
 */

// Byte size of scripts/seed-audio/silence-N.mp3.
const SILENCE_BYTES = 12427;

type Interests = NonNullable<Doc<"profiles">["interests"]>;

type SeedTrack = { title: string; silence: 1 | 2 | 3 };
type SeedShow = { inDays: number; venue: string; city: string };

type SeedProfile = {
  username: string;
  displayName: string;
  kind: "fan" | "artist";
  birthDate: string;
  headline: string;
  location: string;
  gender?: string;
  genre?: string;
  aboutMe: string;
  whoIdLikeToMeet: string;
  interests?: Interests;
  band?: NonNullable<Doc<"profiles">["band"]>;
  tracks?: SeedTrack[];
  shows?: SeedShow[];
};

const NONE = "";
function interests(i: Partial<Interests>): Interests {
  return { general: NONE, music: NONE, movies: NONE, television: NONE, books: NONE, heroes: NONE, ...i };
}

const ARTISTS: SeedProfile[] = [
  {
    username: "lowveld",
    displayName: "Lowveld",
    kind: "artist",
    birthDate: "1994-03-12",
    headline: "Slow guitars and loud drums from Nelspruit",
    location: "Mbombela, South Africa",
    genre: "Indie rock",
    aboutMe: "Four friends who started in a garage and never found a way out. We write about long drives, small towns and people who stayed.",
    whoIdLikeToMeet: "Promoters with a stage, and anyone who owns a van.",
    band: {
      members: "Sipho on guitar and vocals, Annelie on bass, Dumi on drums, Keegan on keys",
      influences: "The National, Springbok Nude Girls, Radiohead",
      soundsLike: "Slow guitars with a big chorus",
      recordLabel: "None yet",
      labelType: "Unsigned",
    },
    tracks: [
      { title: "Long Road Home", silence: 1 },
      { title: "Marula Season", silence: 2 },
      { title: "Kruger Gate", silence: 3 },
    ],
    shows: [
      { inDays: 12, venue: "The Hive", city: "Mbombela" },
      { inDays: 40, venue: "Arts on Main", city: "Johannesburg" },
    ],
  },
  {
    username: "nightjar",
    displayName: "Nightjar",
    kind: "artist",
    birthDate: "1991-11-02",
    headline: "Dream pop recorded after midnight",
    location: "Cape Town, South Africa",
    genre: "Dream pop",
    aboutMe: "A two piece with a drum machine, a borrowed synth and a lot of reverb. New songs most months.",
    whoIdLikeToMeet: "Other bedroom producers. Swap stems with us.",
    band: {
      members: "Zanele on vocals and synth, Tom on guitar and programming",
      influences: "Beach House, Cocteau Twins, Lana Del Rey",
      soundsLike: "Hazy and warm, good for late drives",
      recordLabel: "Self released",
      labelType: "Unsigned",
    },
    tracks: [
      { title: "Glass Hours", silence: 1 },
      { title: "Tidewater", silence: 2 },
    ],
    shows: [{ inDays: 21, venue: "Mercury Live", city: "Cape Town" }],
  },
  {
    username: "papermoons",
    displayName: "Paper Moons",
    kind: "artist",
    birthDate: "1989-06-24",
    headline: "Folk songs for small rooms",
    location: "Durban, South Africa",
    genre: "Folk",
    aboutMe: "Acoustic guitar, a cello and three part harmonies. We play living rooms, cafes and the odd wedding.",
    whoIdLikeToMeet: "Venue owners who like quiet crowds.",
    band: {
      members: "Naledi on vocals and guitar, Brett on cello, Priya on harmony vocals",
      influences: "Joni Mitchell, Bon Iver, Freshlyground",
      soundsLike: "Warm and close, like a kitchen gig",
      recordLabel: "Tidal Records",
      labelType: "Indie",
    },
    tracks: [
      { title: "Kitchen Light", silence: 3 },
      { title: "Seven Winters", silence: 1 },
      { title: "Paper Boats", silence: 2 },
    ],
    shows: [
      { inDays: 8, venue: "The Corner Cafe", city: "Durban" },
      { inDays: 33, venue: "Hilton Arts Festival", city: "Hilton" },
    ],
  },
  {
    username: "djfynbos",
    displayName: "DJ Fynbos",
    kind: "artist",
    birthDate: "1993-01-30",
    headline: "House and amapiano sets, mostly outdoors",
    location: "Stellenbosch, South Africa",
    genre: "House",
    aboutMe: "I play records at sunset. Deep house, amapiano and whatever the dance floor asks for. Mixes go up here first.",
    whoIdLikeToMeet: "Vocalists and anyone with a good sound system.",
    band: {
      members: "Solo",
      influences: "Black Coffee, Kabza De Small, Floating Points",
      soundsLike: "Deep grooves with log drum bass",
      recordLabel: "None",
      labelType: "Unsigned",
    },
    tracks: [{ title: "Sunset Set (Edit)", silence: 2 }],
    shows: [
      { inDays: 5, venue: "Cafe Roux Gardens", city: "Noordhoek" },
      { inDays: 26, venue: "Wolftown", city: "Cape Town" },
    ],
  },
  {
    username: "thestatickids",
    displayName: "The Static Kids",
    kind: "artist",
    birthDate: "2001-09-09",
    headline: "Three chords and a fast tempo",
    location: "Pretoria, South Africa",
    genre: "Punk",
    aboutMe: "We are students who play too loud. Songs under two minutes, shows under forty.",
    whoIdLikeToMeet: "Bands who want to share a bill, and someone with a PA.",
    band: {
      members: "Ruan on vocals, Lindiwe on guitar, Cobus on bass, Mo on drums",
      influences: "The Ramones, Fokofpolisiekar, Green Day",
      soundsLike: "Fast, loud and a bit out of tune",
      recordLabel: "None",
      labelType: "Unsigned",
    },
    tracks: [
      { title: "Exam Week", silence: 3 },
      { title: "Taxi Rank Blues", silence: 1 },
    ],
    shows: [{ inDays: 60, venue: "Capital Craft", city: "Pretoria" }],
  },
];

const FANS: SeedProfile[] = [
  {
    username: "jess",
    displayName: "Jess",
    kind: "fan",
    birthDate: "2000-04-17",
    headline: "Always at the front of the crowd",
    location: "Cape Town, South Africa",
    aboutMe: "Student, part time barista, full time gig goer. I keep a list of every show I go to.",
    whoIdLikeToMeet: "People who want company at gigs.",
    interests: interests({ music: "Indie, dream pop, anything live", movies: "Lady Bird, Whiplash", books: "Normal People" }),
  },
  {
    username: "marco",
    displayName: "Marco",
    kind: "fan",
    birthDate: "1998-08-05",
    headline: "Vinyl first, streaming second",
    location: "Johannesburg, South Africa",
    aboutMe: "I collect records and trade them on weekends. Ask me about pressings.",
    whoIdLikeToMeet: "Other collectors and anyone selling Hugh Masekela originals.",
    interests: interests({ music: "Jazz, rock, soul", movies: "Heat, Drive", television: "Succession" }),
  },
  {
    username: "thandi",
    displayName: "Thandi",
    kind: "fan",
    birthDate: "1999-12-21",
    headline: "Dancing is a good use of a Friday",
    location: "Durban, South Africa",
    aboutMe: "I am here for the house sets and the new music. I share anything good I find.",
    whoIdLikeToMeet: "DJs, dancers and people with good playlists.",
    interests: interests({ music: "House, amapiano, R&B", movies: "Black Panther", general: "Dancing, road trips" }),
  },
  {
    username: "kyle",
    displayName: "Kyle",
    kind: "fan",
    birthDate: "2002-02-14",
    headline: "Learning bass, badly",
    location: "Pretoria, South Africa",
    aboutMe: "Second year engineering. I play bass in my room and go to every punk show I can.",
    whoIdLikeToMeet: "Drummers who need a bass player.",
    interests: interests({ music: "Punk, ska, metal", television: "Rick and Morty" }),
  },
  {
    username: "ren",
    displayName: "Ren",
    kind: "fan",
    birthDate: "1997-07-07",
    headline: "Photographer, gig regular",
    location: "Cape Town, South Africa",
    aboutMe: "I shoot bands on film. If I took your picture at a show, say hi.",
    whoIdLikeToMeet: "Bands who want photos and people who like film.",
    interests: interests({ general: "Film photography", music: "Shoegaze, post punk", movies: "In the Mood for Love" }),
  },
  {
    username: "lerato",
    displayName: "Lerato",
    kind: "fan",
    birthDate: "1996-10-03",
    headline: "Teacher by day, playlist maker by night",
    location: "Mbombela, South Africa",
    aboutMe: "I make a playlist for every month and send it to friends. Request one if you like.",
    whoIdLikeToMeet: "People who recommend songs.",
    interests: interests({ music: "Indie, folk, gospel", books: "Born a Crime", general: "Hiking" }),
  },
  {
    username: "pieter",
    displayName: "Pieter",
    kind: "fan",
    birthDate: "1995-05-19",
    headline: "Festival season never ends",
    location: "Stellenbosch, South Africa",
    aboutMe: "I drive too far for live music. Tell me where the next good show is.",
    whoIdLikeToMeet: "Anyone with a spare festival ticket.",
    interests: interests({ music: "Folk, rock, electronic", general: "Camping, cooking on a fire" }),
  },
  {
    username: "aisha",
    displayName: "Aisha",
    kind: "fan",
    birthDate: "2001-01-11",
    headline: "New music every Friday",
    location: "Cape Town, South Africa",
    aboutMe: "I read, I listen and I leave comments. I like finding bands before they get big.",
    whoIdLikeToMeet: "Bands with a first EP out.",
    interests: interests({ music: "Dream pop, folk, house", books: "Americanah", television: "Atlanta" }),
  },
];

const ROSTER = [...ARTISTS, ...FANS];

/** [profile, author, text]. Plain text, nothing that needs a link. */
const COMMENTS: Array<[string, string, string]> = [
  ["lowveld", "jess", "Long Road Home has been on repeat all week. Please play Cape Town."],
  ["lowveld", "lerato", "Saw you at The Hive last year. The new songs are even better."],
  ["lowveld", "pieter", "Drove four hours to hear you play and it was worth it."],
  ["lowveld", "nightjar", "Great drums on Marula Season. Who mixed it?"],
  ["nightjar", "ren", "Your reverb is something else. Took some shots at your last show, will send them over."],
  ["nightjar", "aisha", "Glass Hours is my song of the month. Thank you."],
  ["nightjar", "lowveld", "Would love to share a bill with you one day."],
  ["nightjar", "jess", "Playing Tidewater while I study. Grades are fine so far."],
  ["papermoons", "lerato", "Kitchen Light made me cry on the way to work. In a good way."],
  ["papermoons", "thandi", "Not my usual thing but I played Seven Winters three times in a row."],
  ["papermoons", "marco", "The cello on Paper Boats is lovely. Are you pressing a record?"],
  ["papermoons", "pieter", "See you at Hilton!"],
  ["djfynbos", "thandi", "Your last sunset set was perfect. The log drums at the end."],
  ["djfynbos", "kyle", "Never thought I would like house until a friend played me your edit."],
  ["djfynbos", "ren", "Got some great photos of the crowd at Cafe Roux. Check your inbox soon."],
  ["djfynbos", "nightjar", "Open to a remix swap? We have a track that needs a four on the floor."],
  ["thestatickids", "kyle", "Exam Week is the anthem of my second year. See you at the front."],
  ["thestatickids", "jess", "Louder than I expected for a living room. Loved it."],
  ["thestatickids", "lowveld", "Good luck with the new shows. Keep it fast."],
  ["thestatickids", "aisha", "Taxi Rank Blues is a total mood."],
  ["jess", "marco", "Thanks for the gig tip last weekend. That band was great."],
  ["jess", "thandi", "Let's go to the Nightjar show together."],
  ["jess", "ren", "Your photos from last night are up. You look happy in all of them."],
  ["marco", "kyle", "Found that record you were after. I will bring it Saturday."],
  ["marco", "pieter", "Good to hear the new pressing sounds as good as the old one."],
  ["thandi", "aisha", "Your Friday list had three songs I had never heard. Thank you."],
  ["kyle", "thestatickids", "Come to the next show, we will put you on the list."],
  ["ren", "jess", "Thank you for the print. It is on my wall now."],
  ["lerato", "aisha", "Playlist number six is the best one yet."],
  ["pieter", "lerato", "Where is the next good show? Send me the date."],
  ["aisha", "ren", "Your latest roll came out so well."],
];

const BULLETINS: Array<[string, string]> = [
  ["lowveld", "New date added at Arts on Main in Johannesburg. We would love to see you there."],
  ["djfynbos", "Sunset set at Cafe Roux Gardens this week. Come early, the light is the best part."],
  ["papermoons", "We are recording a live session in a living room next month. Message us if you want to host."],
  ["jess", "Looking for someone to go to shows with next month. I will buy the first round."],
  ["thestatickids", "Our rehearsal room has a new amp and it is too loud. Come hear it at the next gig."],
];

async function findByUsername(ctx: MutationCtx, username: string): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.OPENSPACE_ALLOW_SEED !== "1") {
      throw new ConvexError("Seeding is disabled");
    }

    const ids = new Map<string, Id<"profiles">>();
    const now = Date.now();

    // Profiles: patch if present, create (with a user that has no email) if not.
    for (const p of ROSTER) {
      const fields = {
        displayName: p.displayName,
        kind: p.kind,
        birthDate: p.birthDate,
        headline: p.headline,
        location: p.location,
        genre: p.genre,
        aboutMe: p.aboutMe,
        whoIdLikeToMeet: p.whoIdLikeToMeet,
        interests: p.interests,
        band: p.band,
        photoKey: `seed/avatar-${p.username}.png`,
      };
      const existing = await findByUsername(ctx, p.username);
      if (existing !== null) {
        if (existing.isHouse) throw new ConvexError(`"${p.username}" is the house account`);
        await ctx.db.patch(existing._id, fields);
        ids.set(p.username, existing._id);
      } else {
        const userId = await ctx.db.insert("users", { name: p.displayName });
        const id = await ctx.db.insert("profiles", {
          ...fields,
          userId,
          username: p.username,
          profileViews: 0,
          lastLoginAt: now,
          customCss: "",
          customHtml: "",
          customJs: "",
          top8: [],
          isHouse: false,
          banned: false,
        });
        ids.set(p.username, id);
      }
    }
    const id = (username: string): Id<"profiles"> => {
      const found = ids.get(username);
      if (!found) throw new ConvexError(`Unknown seed user ${username}`);
      return found;
    };

    // Tracks and shows. Shows are replaced each run so dates stay relative to today.
    for (const p of ARTISTS) {
      const profileId = id(p.username);
      const oldTracks = await ctx.db
        .query("tracks")
        .withIndex("by_profile_order", (q) => q.eq("profileId", profileId))
        .collect();
      for (const t of oldTracks) await ctx.db.delete(t._id);
      for (const [order, t] of (p.tracks ?? []).entries()) {
        await ctx.db.insert("tracks", {
          profileId,
          title: t.title,
          key: `seed/silence-${t.silence}.mp3`,
          size: SILENCE_BYTES,
          order,
          autoplay: false,
        });
      }

      const oldShows = await ctx.db
        .query("shows")
        .withIndex("by_profile_date", (q) => q.eq("profileId", profileId))
        .collect();
      for (const s of oldShows) await ctx.db.delete(s._id);
      for (const s of p.shows ?? []) {
        const date = new Date(now + s.inDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await ctx.db.insert("shows", { profileId, date, venue: s.venue, city: s.city });
      }
    }

    // Friendships: every artist with every other artist, every fan with every
    // artist, and each fan with the next two fans in the list.
    const pairs = new Set<string>();
    const wanted: Array<[string, string]> = [];
    const add = (x: string, y: string) => {
      const key = [x, y].sort().join(":");
      if (x === y || pairs.has(key)) return;
      pairs.add(key);
      wanted.push([x, y]);
    };
    for (const a of ARTISTS) for (const b of ARTISTS) add(a.username, b.username);
    for (const f of FANS) for (const a of ARTISTS) add(f.username, a.username);
    FANS.forEach((f, i) => {
      add(f.username, FANS[(i + 1) % FANS.length].username);
      add(f.username, FANS[(i + 2) % FANS.length].username);
    });
    for (const [x, y] of wanted) {
      const pair = friendshipPair(id(x), id(y));
      const exists = await ctx.db
        .query("friendships")
        .withIndex("by_pair", (q) => q.eq("a", pair.a).eq("b", pair.b))
        .unique();
      if (exists === null) await ctx.db.insert("friendships", pair);
    }

    // Top 8: the first eight friends in roster order.
    for (const p of ROSTER) {
      const friends = ROSTER.filter((o) => pairs.has([p.username, o.username].sort().join(":")));
      await ctx.db.patch(id(p.username), { top8: friends.slice(0, 8).map((f) => id(f.username)) });
    }

    // Comments and bulletins, matched on their text so reruns add nothing new.
    for (const [profile, author, body] of COMMENTS) {
      const profileId = id(profile);
      const authorId = id(author);
      const rows = await ctx.db
        .query("comments")
        .withIndex("by_profile", (q) => q.eq("profileId", profileId))
        .collect();
      if (!rows.some((c) => c.authorId === authorId && c.body === body)) {
        await ctx.db.insert("comments", { profileId, authorId, body, hidden: false });
      }
    }
    for (const [author, body] of BULLETINS) {
      const authorId = id(author);
      const rows = await ctx.db
        .query("bulletins")
        .withIndex("by_author", (q) => q.eq("authorId", authorId))
        .collect();
      // Bulletins expire after 10 days, so a rerun replaces them to keep them fresh.
      for (const b of rows) if (b.body === body) await ctx.db.delete(b._id);
      await ctx.db.insert("bulletins", { authorId, body, hidden: false });
    }

    return null;
  },
});
