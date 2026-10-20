import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { photoUrl } from "./media";
import { isOnline } from "./presence";

export type PublicCard = {
  username: string;
  displayName: string;
  photoUrl: string | null;
  kind: "fan" | "artist";
  /** Only on the Top 8, the friends page and Cool New People. */
  online?: boolean;
};

export function toPublicCard(
  profile: Pick<Doc<"profiles">, "username" | "displayName" | "photoKey" | "kind">,
): PublicCard {
  return {
    username: profile.username,
    displayName: profile.displayName,
    photoUrl: photoUrl(profile.photoKey),
    kind: profile.kind,
  };
}

/** A card with `online` filled in: one presence index read. */
export async function toPublicCardOnline(
  ctx: Pick<QueryCtx, "db">,
  profile: Pick<Doc<"profiles">, "_id" | "username" | "displayName" | "photoKey" | "kind" | "showOnline">,
  now: number,
): Promise<PublicCard> {
  return { ...toPublicCard(profile), online: await isOnline(ctx, profile, now) };
}
