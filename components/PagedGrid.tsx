"use client";

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useState } from "react";
import { PhotoGrid } from "./PhotoGrid";
import type { PublicCard } from "@/convex/lib/cards";

type Page = { page: PublicCard[]; isDone: boolean; continueCursor: string };

/**
 * Photo grid with Previous / Next links. `data` is the result for the current cursor
 * (undefined while loading). `stack` holds the cursors of earlier pages.
 */
export function PagedGrid<Args extends { cursor: string | null }>({
  query,
  args,
  empty,
}: {
  query: FunctionReference<"query", "public", Args, Page>;
  args: Omit<Args, "cursor">;
  empty: string;
}) {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack[stack.length - 1];
  const data = useQuery(query, { ...args, cursor } as never);
  return (
    <>
      <PhotoGrid cards={data?.page} empty={empty} />
      {(stack.length > 1 || (data && !data.isDone)) && (
        <p>
          <button type="button" disabled={stack.length === 1} onClick={() => setStack(stack.slice(0, -1))}>
            Previous
          </button>{" "}
          Page {stack.length}{" "}
          <button
            type="button"
            disabled={!data || data.isDone}
            onClick={() => data && setStack([...stack, data.continueCursor])}
          >
            Next
          </button>
        </p>
      )}
    </>
  );
}
