"use client";

import { useQuery } from "convex/react";
import { Box } from "@/components/Box";
import { PhotoGrid } from "@/components/PhotoGrid";
import { api } from "@/convex/_generated/api";

export function CoolNewPeople() {
  const cards = useQuery(api.home.coolNewPeople);
  return (
    <Box title="Cool New People">
      <PhotoGrid cards={cards} empty="No new people yet" />
    </Box>
  );
}

export function CoolNewMusic() {
  const cards = useQuery(api.home.coolNewMusic);
  return (
    <Box title="Cool New Music">
      <PhotoGrid cards={cards} empty="No new music yet" />
    </Box>
  );
}
