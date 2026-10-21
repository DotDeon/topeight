/**
 * Public profile data passed into the sandboxed profile document. Kept free
 * of imports so convex/ can use the same types (convex/ has no "@/" alias).
 */

/** Same shape as convex/lib/cards.ts PublicCard, re-declared to keep lib/ free of convex/. */
export type PublicCard = {
  username: string;
  displayName: string;
  photoUrl: string | null;
  kind: "fan" | "artist";
  online?: boolean;
};

/**
 * What a visitor who isn't allowed the full page gets for a private profile:
 * the left-column basics only. `age` is fans only, like PublicProfile.age.
 */
export type RestrictedProfile = {
  restricted: true;
  displayName: string;
  photoUrl: string | null;
  age?: number;
  location: string;
  mood: { icon: string; text: string } | null;
  online: boolean;
};

export type PublicProfile = {
  username: string;
  displayName: string;
  kind: "fan" | "artist";
  headline: string;
  /** The mood line. `icon` is one of lib/moods.ts MOOD_ICONS. */
  mood?: { icon: string; text: string } | null;
  /** Whether the member is online now (shares presence and was seen in the last 5 minutes). */
  online: boolean;
  location: string;
  gender?: string;
  /** Fans only, worked out on the server. The birth date itself is never sent. */
  age?: number;
  genre?: string;
  aboutMe: string;
  whoIdLikeToMeet: string;
  interests?: {
    general: string;
    music: string;
    movies: string;
    television: string;
    books: string;
    heroes: string;
  };
  band?: {
    members: string;
    influences: string;
    soundsLike: string;
    recordLabel: string;
    labelType: string;
  };
  photoUrl: string | null;
  profileViews: number;
  lastLoginAt: number;
  memberSince: number;
  friendCount: number;
  top8: PublicCard[];
  comments: Array<{ author: PublicCard; body: string; createdAt: number }>;
  /** Visible comments, counted up to 1001. Over 1000 renders as "1000+". */
  commentCount: number;
  latestBulletin: { body: string; createdAt: number } | null;
  /** The newest visible blog post. `id` is the Convex blogPosts id. */
  latestBlog?: { id: string; title: string; createdAt: number } | null;
  /**
   * `id` is the Convex track id, used by the player's Report links. `url` is a
   * short-lived signed playback URL, null until the usercontent route merges one in.
   */
  tracks: Array<{ id: string; title: string; url: string | null; autoplay: boolean }>;
  /** Artists only: false when they have turned song sharing off, so no pick links show. */
  shareSongs?: boolean;
  /**
   * The member's profile song, null when none is picked or it is unavailable (track
   * deleted, artist banned or sharing off). `id` is the Convex track id; `url` is
   * null until the usercontent route merges in a signed one.
   */
  profileSong?: { id: string; title: string; url: string | null; artist: PublicCard } | null;
  shows: Array<{ date: string; venue: string; city: string }>;
  custom: { css: string; html: string; js: string };
};
