"use client";

import { api } from "@/convex/_generated/api";
import { PagedGrid } from "./PagedGrid";

export function SearchResults({ q, kind }: { q: string; kind?: "fan" | "artist" }) {
  return (
    <PagedGrid
      key={`${q}|${kind ?? ""}`}
      empty="No results"
      query={api.search.people}
      args={{ q, kind }}
    />
  );
}
