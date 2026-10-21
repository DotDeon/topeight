import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalQuery } from "./_generated/server";
import { canSeeFull, viewerProfile } from "./lib/access";
import { FRAME_PASS_TTL_MS, framePassSecret, signFramePass, verifyFramePass } from "./lib/framePass";
import { profileByUsername } from "./profiles";

/**
 * The id of an unbanned private profile, when `forViewer` is false, or when the
 * signed-in viewer may see its full page. Null otherwise.
 */
export const privateTarget = internalQuery({
  args: { username: v.string(), forViewer: v.boolean() },
  returns: v.union(v.id("profiles"), v.null()),
  handler: async (ctx, { username, forViewer }): Promise<Id<"profiles"> | null> => {
    const p = await profileByUsername(ctx, username);
    if (p === null || p.banned || p.private !== true) return null;
    if (forViewer && !(await canSeeFull(ctx, await viewerProfile(ctx), p))) return null;
    return p._id;
  },
});

/**
 * A frame pass for a private profile the caller may see in full, valid 2 hours.
 * Null for public profiles (they need none), for viewers who only get the
 * restricted card, and when FRAME_PASS_SECRET is unset, in which case private
 * profiles never render in the frame. An action, so the expiry is always counted
 * from now and never from a cached query result.
 */
export const issue = action({
  args: { username: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { username }): Promise<string | null> => {
    const secret = framePassSecret();
    if (secret === null) return null;
    const id: Id<"profiles"> | null = await ctx.runQuery(internal.framePass.privateTarget, {
      username,
      forViewer: true,
    });
    if (id === null) return null;
    return await signFramePass(id, Date.now() + FRAME_PASS_TTL_MS, secret);
  },
});

/**
 * Whether `pass` is a valid, unexpired frame pass for this unbanned private
 * profile. The usercontent route's `?format=tracks` refresh uses it to decide
 * between answering and a 404.
 */
export const verify = action({
  args: { username: v.string(), pass: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { username, pass }): Promise<boolean> => {
    const secret = framePassSecret();
    if (secret === null) return false;
    const id: Id<"profiles"> | null = await ctx.runQuery(internal.framePass.privateTarget, {
      username,
      forViewer: false,
    });
    return id !== null && (await verifyFramePass(pass, id, Date.now(), secret));
  },
});
