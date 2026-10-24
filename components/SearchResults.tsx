"use client";

import { api } from "@/convex/_generated/api";
import { PagedGrid } from "./PagedGrid";
import type { ProfileKind } from "@/lib/profile/types";

export function SearchResults({ q, kind }: { q: string; kind?: ProfileKind }) {
  return (
    <PagedGrid
      key={`${q}|${kind ?? ""}`}
      empty="No results"
      query={api.search.people}
      args={{ q, kind }}
    />
  );
}
