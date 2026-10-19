import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  run?: (target: ActionTarget, client: ConvexReactClient) => Promise<string>;
};

export const COMING_SOON = "Coming soon. This feature arrives in a later update.";

// Task 9 swaps in comments, Task 13 reports.
const comingSoon = async () => COMING_SOON;

/** Runs a social mutation on the profile being viewed and turns the outcome into dialog text. */
async function runSocial(
  target: ActionTarget,
  client: ConvexReactClient,
  loggedOut: string,
  go: (id: Id<"profiles">) => Promise<string>,
): Promise<string> {
  try {
    const id = await client.query(api.social.profileIdByUsername, { username: target.username });
    if (id === null) return "Profile not found";
    return await go(id);
  } catch (e) {
    const message = e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong.";
    if (message === "Not signed in") return loggedOut;
    if (message === "Email not verified") return "Verify your email first";
    if (message === "No profile") return "Finish setting up your profile";
    return message;
  }
}

const addFriend = (target: ActionTarget, client: ConvexReactClient) =>
  runSocial(target, client, "Log in to add friends", async (id) => {
    const result = await client.mutation(api.social.sendFriendRequest, { to: id });
    return result === "accepted" ? "You are now friends" : "Friend request sent";
  });

const block = (target: ActionTarget, client: ConvexReactClient) =>
  runSocial(target, client, "Log in to block people", async (id) => {
    await client.mutation(api.social.block, { other: id });
    return `${target.displayName} is blocked`;
  });

export const PROFILE_ACTIONS: Record<BridgeAction, ProfileAction> = {
  addFriend: { label: "Add to Friends", question: (n) => `Add ${n} to your friends?`, run: addFriend },
  addComment: { label: "Add Comment", question: (n) => `Add a comment to ${n}'s profile?`, run: comingSoon },
  report: { label: "Report", question: (n) => `Report ${n}'s profile?`, run: comingSoon },
  block: { label: "Block", question: (n) => `Block ${n}?`, run: block },
  forward: { label: "Forward to Friend", question: () => "Forward to Friend is coming soon." },
  message: { label: "Send Message", question: () => "Send Message is coming soon." },
};

/** Actions the trusted strip shows, in order. */
export const STRIP_ACTIONS: readonly BridgeAction[] = ["addFriend", "addComment", "report", "block"];
