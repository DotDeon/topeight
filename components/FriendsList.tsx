"use client";

import { useState } from "react";
import type { PublicCard } from "@/convex/lib/cards";
import { PhotoGrid } from "./PhotoGrid";

export const FRIENDS_PER_PAGE = 40;

/** The classic friends grid, 40 per page, paged in the browser. */
export function FriendsList({ friends }: { friends: PublicCard[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(friends.length / FRIENDS_PER_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = friends.slice(current * FRIENDS_PER_PAGE, (current + 1) * FRIENDS_PER_PAGE);
  return (
    <>
      <PhotoGrid cards={slice} empty="No friends yet" />
      {pages > 1 && (
        <p data-friends-pager="">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>{" "}
          Page {current + 1} of {pages}{" "}
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </p>
      )}
    </>
  );
}
