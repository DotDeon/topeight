import { v } from "convex/values";
import { query } from "./_generated/server";
import { toPublicCard, type PublicCard } from "./lib/cards";
import { normalizeUsername } from "../lib/validation";
import { profileKind } from "./lib/kinds";

const PAGE_SIZE = 40;
const MAX_FILTER_LENGTH = 100;
const MAX_QUERY_LENGTH = 100;

const kindValidator = profileKind;

type Page = { page: PublicCard[]; isDone: boolean; continueCursor: string };

function cleanFilter(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_FILTER_LENGTH).toLowerCase();
}

/** Search by display name, with an exact username match put first on the first page. */
export const people = query({
  args: {
    q: v.string(),
    kind: v.optional(kindValidator),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<Page> => {
    const q = args.q.trim().slice(0, MAX_QUERY_LENGTH);
    if (q === "") return { page: [], isDone: true, continueCursor: "" };

    const result = await ctx.db
      .query("profiles")
      .withSearchIndex("search_name", (s) => {
        const base = s.search("displayName", q).eq("banned", false);
        return args.kind ? base.eq("kind", args.kind) : base;
      })
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor });

    const page: PublicCard[] = [];
    let exactUsername: string | null = null;
    if (args.cursor === null) {
      const exact = await ctx.db
        .query("profiles")
        .withIndex("by_username", (i) => i.eq("username", normalizeUsername(q)))
        .unique();
      if (exact && !exact.banned && (!args.kind || exact.kind === args.kind)) {
        page.push(toPublicCard(exact));
        exactUsername = exact.username;
      }
    }
    for (const p of result.page) {
      if (p.username === exactUsername) continue;
      page.push(toPublicCard(p));
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Newest profiles first, 40 per page. Location and genre filter each page, so a page can be short. */
export const browse = query({
  args: {
    kind: v.optional(kindValidator),
    location: v.optional(v.string()),
    genre: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<Page> => {
    const location = cleanFilter(args.location);
    const genre = cleanFilter(args.genre);
    const kind = args.kind;
    const opts = { numItems: PAGE_SIZE, cursor: args.cursor };
    const result = kind
      ? await ctx.db
          .query("profiles")
          .withIndex("by_kind_creation", (i) => i.eq("kind", kind))
          .order("desc")
          .paginate(opts)
      : await ctx.db.query("profiles").order("desc").paginate(opts);

    const page = result.page
      .filter(
        (p) =>
          !p.banned &&
          (location === "" || p.location.toLowerCase().includes(location)) &&
          (genre === "" || (p.genre ?? "").toLowerCase().includes(genre)),
      )
      .map(toPublicCard);
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
