import type { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BridgeAction } from "@/lib/bridge-protocol";

/**
 * Who the action is about. `track` is set for reportTrack only, and always
 * comes from the parent's server-loaded track list, never from the frame.
 */
export type ActionTarget = { username: string; displayName: string; track?: { id: string; title: string } };

/**
 * Everything the confirm dialog can do: the bridge actions plus the ones only
 * the trusted strip or the parent page can start (reporting a song, removing a
 * friend, unblocking). Artist code can never request those.
 */
export type DialogAction = BridgeAction | "reportTrack" | "removeFriend" | "unblock";

/** What an action did: `ok` is true only when it went through, `text` is what the dialog shows. */
export type ActionResult = { ok: boolean; text: string };

export type ProfileAction = {
  /** Button and link text. */
  label: string;
  /** The question the confirm dialog asks. */
  question: (name: string, target: ActionTarget) => string;
  /**
   * Runs after the visitor clicks Confirm in the parent page. Returns the
   * text the dialog shows next. Absent means the feature is coming soon and
   * the dialog has no Confirm button.
   */
  run?: (target: ActionTarget, client: ConvexReactClient, text: string) => Promise<ActionResult>;
  /** When set, the dialog asks for text first and passes it to `run`. */
  input?: { label: string; maxLength: number };
};


/** Dialog text for a failed mutation. */
function failure(e: unknown, loggedOut: string): ActionResult {
  const message = e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong.";
  if (message === "Not signed in") return { ok: false, text: loggedOut };
  if (message === "Email not verified") return { ok: false, text: "Verify your email first" };
  if (message === "No profile") return { ok: false, text: "Finish setting up your profile" };
  return { ok: false, text: message };
}

/** Runs a social mutation on the profile being viewed and turns the outcome into dialog text. */
async function runSocial(
  target: ActionTarget,
  client: ConvexReactClient,
  loggedOut: string,
  go: (id: Id<"profiles">) => Promise<string>,
): Promise<ActionResult> {
  try {
    const id = await client.query(api.social.profileIdByUsername, { username: target.username });
    if (id === null) return { ok: false, text: "Profile not found" };
    return { ok: true, text: await go(id) };
  } catch (e) {
    return failure(e, loggedOut);
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

const removeFriend = (target: ActionTarget, client: ConvexReactClient) =>
  runSocial(target, client, "Log in to manage friends", async (id) => {
    await client.mutation(api.social.removeFriend, { other: id });
    return "Removed from your friends";
  });

const unblock = (target: ActionTarget, client: ConvexReactClient) =>
  runSocial(target, client, "Log in to unblock people", async (id) => {
    await client.mutation(api.social.unblock, { other: id });
    return "Unblocked";
  });

const addComment = (target: ActionTarget, client: ConvexReactClient, text: string) =>
  runSocial(target, client, "Log in to comment", async (id) => {
    await client.mutation(api.comments.add, { profileId: id, body: text });
    return "Comment posted";
  });

const report = (target: ActionTarget, client: ConvexReactClient, text: string) =>
  runSocial(target, client, "Log in to report", async (id) => {
    await client.mutation(api.moderation.report, { targetType: "profile", targetId: id, reason: text });
    return "Thanks. An admin will review this profile.";
  });

/** The server checks the track belongs to the profile being viewed. */
async function reportTrack(target: ActionTarget, client: ConvexReactClient, text: string): Promise<ActionResult> {
  if (!target.track) return { ok: false, text: "Not found" };
  try {
    await client.mutation(api.moderation.report, {
      targetType: "track",
      targetId: target.track.id,
      profileUsername: target.username,
      reason: text,
    });
    return { ok: true, text: "Thanks, a moderator will review it" };
  } catch (e) {
    return failure(e, "Log in to report");
  }
}

export const PROFILE_ACTIONS: Record<DialogAction, ProfileAction> = {
  addFriend: { label: "Add to Friends", question: (n) => `Add ${n} to your friends?`, run: addFriend },
  addComment: {
    label: "Add Comment", question: (n) => `Add a comment to ${n}'s profile?`,
    run: addComment,
    input: { label: "Your comment", maxLength: 2000 },
  },
  report: {
    label: "Report", question: (n) => `Report ${n}'s profile?`,
    run: report,
    input: { label: "Reason", maxLength: 500 },
  },
  block: { label: "Block", question: (n) => `Block ${n}?`, run: block },
  removeFriend: {
    label: "Remove from Friends", question: (n) => `Remove ${n} from your friends?`, run: removeFriend,
  },
  unblock: { label: "Unblock", question: (n) => `Unblock ${n}?`, run: unblock },
  forward: { label: "Forward to Friend", question: () => "Forward to Friend is coming soon." },
  message: { label: "Send Message", question: () => "Send Message is coming soon." },
  reportTrack: {
    label: "Report", question: (_n, t) => `Report the song "${t.track?.title ?? ""}"?`,
    run: reportTrack,
    input: { label: "What's wrong?", maxLength: 500 },
  },
};
