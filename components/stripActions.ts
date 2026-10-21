import type { Relationship } from "@/convex/social";
import { PROFILE_ACTIONS, type DialogAction } from "./profileActions";

/** One button in the trusted strip. `disabled` buttons show a state, not an action. */
export type StripButton = { action: DialogAction; label: string; disabled?: boolean };

const labelOf = (action: DialogAction) => PROFILE_ACTIONS[action].label;
const button = (action: DialogAction): StripButton => ({ action, label: labelOf(action) });

/**
 * The strip's buttons for this viewer and profile. `rel` and `isHouse` are
 * undefined while they load: the friend and block slots stay empty until both
 * are in, so a wrong label never flashes. `rel` null (unknown profile) gets the
 * signed-out layout; the server still checks every click.
 */
export function stripButtons(
  rel: Relationship | null | undefined,
  isHouse: boolean | undefined,
  { canComment = true }: { canComment?: boolean } = {},
): StripButton[] {
  // Viewers who only get a private profile's card can't comment, so they get no Add Comment.
  const comment = canComment ? [button("addComment")] : [];
  const report = button("report");
  if (rel === undefined || isHouse === undefined) return [...comment, report];
  if (rel?.self) return [...comment, report];

  let friend: StripButton[];
  if (rel?.friends) friend = isHouse ? [] : [button("removeFriend")];
  else if (rel?.pendingOut) friend = [{ action: "addFriend", label: "Request sent", disabled: true }];
  else friend = [button("addFriend")];

  return [...friend, button("message"), ...comment, report, button(rel?.blocked ? "unblock" : "block")];
}
