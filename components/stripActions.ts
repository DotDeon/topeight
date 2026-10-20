import type { Relationship } from "@/convex/social";
import type { DialogAction } from "./profileActions";

/** One button in the trusted strip. `disabled` buttons show a state, not an action. */
export type StripButton = { action: DialogAction; label: string; disabled?: boolean };

/**
 * The strip's buttons for this viewer and profile. `rel` is undefined while it
 * loads and null when the profile is unknown; both fall back to the signed-out
 * layout, which the server still checks on every click.
 */
export function stripButtons(rel: Relationship | null | undefined, isHouse: boolean): StripButton[] {
  const comment: StripButton = { action: "addComment", label: "Add Comment" };
  const report: StripButton = { action: "report", label: "Report" };
  if (rel?.self) return [comment, report];

  let friend: StripButton[];
  if (rel?.friends) friend = isHouse ? [] : [{ action: "removeFriend", label: "Remove from Friends" }];
  else if (rel?.pendingOut) friend = [{ action: "addFriend", label: "Request sent", disabled: true }];
  else friend = [{ action: "addFriend", label: "Add to Friends" }];

  const block: StripButton = rel?.blocked
    ? { action: "unblock", label: "Unblock" }
    : { action: "block", label: "Block" };
  return [...friend, comment, report, block];
}
