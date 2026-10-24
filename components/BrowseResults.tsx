"use client";

import { api } from "@/convex/_generated/api";
import { PagedGrid } from "./PagedGrid";
import type { ProfileKind } from "@/lib/profile/types";

export function BrowseResults({
  kind,
  location,
  genre,
}: {
  kind?: ProfileKind;
  location: string;
  genre: string;
}) {
  return (
    <PagedGrid
      key={`${kind ?? ""}|${location}|${genre}`}
      empty="No results"
      query={api.search.browse}
      args={{ kind, location, genre }}
    />
  );
}
