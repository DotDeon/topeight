import type { BridgeAction } from "@/lib/bridge-protocol";

/** Who the action is about. Later tasks add what their mutations need. */
export type ActionTarget = { username: string; displayName: string };

export type ProfileAction = {
  /** Button and link text. */
  label: string;
  /** The question the confirm dialog asks. */
  question: (name: string) => string;
  /**
   * Runs after the visitor clicks Confirm in the parent page. Returns the
   * text the dialog shows next. Absent means the feature is coming soon and
   * the dialog has no Confirm button.
   */
  run?: (target: ActionTarget) => Promise<string>;
};

export const COMING_SOON = "Coming soon. This feature arrives in a later update.";

// Task 8 swaps in the friend and block mutations, Task 9 comments, Task 13 reports.
const comingSoon = async () => COMING_SOON;

export const PROFILE_ACTIONS: Record<BridgeAction, ProfileAction> = {
  addFriend: { label: "Add to Friends", question: (n) => `Add ${n} to your friends?`, run: comingSoon },
  addComment: { label: "Add Comment", question: (n) => `Add a comment to ${n}'s profile?`, run: comingSoon },
  report: { label: "Report", question: (n) => `Report ${n}'s profile?`, run: comingSoon },
  block: { label: "Block", question: (n) => `Block ${n}?`, run: comingSoon },
  forward: { label: "Forward to Friend", question: () => "Forward to Friend is coming soon." },
  message: { label: "Send Message", question: () => "Send Message is coming soon." },
};

/** Actions the trusted strip shows, in order. */
export const STRIP_ACTIONS: readonly BridgeAction[] = ["addFriend", "addComment", "report", "block"];
