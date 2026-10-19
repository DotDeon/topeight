import type { Doc } from "../_generated/dataModel";
import { photoUrl } from "./media";

export type PublicCard = {
  username: string;
  displayName: string;
  photoUrl: string | null;
  kind: "fan" | "artist";
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
