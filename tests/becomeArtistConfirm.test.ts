import { expect, test } from "vitest";
import { becomeArtistConfirm } from "@/components/edit/EditProfile";

test("warns a private fan that switching to artist turns private off", () => {
  expect(becomeArtistConfirm(true)).toBe(
    "Artist pages are public. Switching turns off your private profile setting. Continue?",
  );
  expect(becomeArtistConfirm(false)).toBe("Switch to an artist profile?");
});
