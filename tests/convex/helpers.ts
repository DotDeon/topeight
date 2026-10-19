/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");
export const NOW = new Date("2026-10-19T12:00:00Z");

export type T = ReturnType<typeof convexTest>;
export function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

export async function addProfile(t: T, username: string, extra: Record<string, unknown> = {}): Promise<Id<"profiles">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: `${username}@example.com`,
      emailVerificationTime: Date.now(),
    });
    return await ctx.db.insert("profiles", {
      userId,
      username,
      displayName: username.toUpperCase(),
      kind: "fan",
      birthDate: "2000-01-01",
      headline: "",
      location: "",
      aboutMe: "",
      whoIdLikeToMeet: "",
      lastLoginAt: 0,
      customCss: "",
      customHtml: "",
      customJs: "",
      top8: [],
      isHouse: false,
      banned: false,
      ...extra,
    });
  });
}

export async function as(t: T, id: Id<"profiles">) {
  const p = await t.run((ctx) => ctx.db.get(id));
  return t.withIdentity({ subject: `${p!.userId}|s1` });
}

export async function befriend(t: T, x: Id<"profiles">, y: Id<"profiles">) {
  const [a, b] = x < y ? [x, y] : [y, x];
  await t.run((ctx) => ctx.db.insert("friendships", { a, b }));
}

export async function block(t: T, blocker: Id<"profiles">, blocked: Id<"profiles">) {
  await t.run((ctx) => ctx.db.insert("blocks", { blocker, blocked }));
}

export const DAY = 24 * 60 * 60 * 1000;
