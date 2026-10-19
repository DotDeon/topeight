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
};

export type PublicProfile = {
  username: string;
  displayName: string;
  kind: "fan" | "artist";
  headline: string;
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
  tracks: Array<{ title: string; url: string; autoplay: boolean }>;
  shows: Array<{ date: string; venue: string; city: string }>;
  custom: { css: string; html: string; js: string };
};
