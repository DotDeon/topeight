import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** The signed-in user with a verified email, or throws. */
export async function requireVerifiedUser(ctx: Ctx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("Not signed in");
  const user = await ctx.db.get(userId);
  if (user === null) throw new ConvexError("Not signed in");
  if (user.emailVerificationTime === undefined) {
    throw new ConvexError("Email not verified");
  }
  return user;
}

export async function profileForUser(
  ctx: Ctx,
  userId: Doc<"users">["_id"],
): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** The signed-in, verified, unbanned user's profile, or throws. */
export async function requireProfile(ctx: Ctx): Promise<Doc<"profiles">> {
  const user = await requireVerifiedUser(ctx);
  const profile = await profileForUser(ctx, user._id);
  if (profile === null) throw new ConvexError("No profile");
  if (profile.banned) throw new ConvexError("Account banned");
  return profile;
}

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True if the signed-in user's verified email is listed in ADMIN_EMAILS. */
export async function isAdmin(ctx: Ctx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return false;
  const user = await ctx.db.get(userId);
  if (!user?.email || user.emailVerificationTime === undefined) return false;
  return adminEmails().has(user.email.toLowerCase());
}
