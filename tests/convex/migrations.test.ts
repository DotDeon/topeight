import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { NOW, addProfile, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function legacyWorld(t: T) {
  const photo = await addProfile(t, "photo", { photoKey: "a.jpg" });
  const plain = await addProfile(t, "plain");
  const band = await addProfile(t, "band", { kind: "artist" });
  await t.run((ctx) =>
    ctx.db.insert("tracks", { profileId: band, title: "x", key: "k", size: 1, order: 0, autoplay: true }),
  );
  return { photo, plain, band };
}

const flagsOf = (t: T, id: Id<"profiles">) =>
  t.run(async (ctx) => {
    const p = await ctx.db.get(id);
    return [p!.hasPhoto, p!.hasTracks];
  });

async function runAll(t: T) {
  await t.mutation(internal.migrations.backfillMediaFlags, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("backfillMediaFlags", () => {
  test("sets correct flags on legacy rows and is idempotent", async () => {
    const t = setup();
    const { photo, plain, band } = await legacyWorld(t);
    await runAll(t);
    expect(await flagsOf(t, photo)).toEqual([true, false]);
    expect(await flagsOf(t, plain)).toEqual([false, false]);
    expect(await flagsOf(t, band)).toEqual([false, true]);
    await runAll(t);
    expect(await flagsOf(t, photo)).toEqual([true, false]);
    expect(await flagsOf(t, band)).toEqual([false, true]);
  });

  test("one invocation touches at most 100 rows and the rest finish through the schedule", async () => {
    const t = setup();
    const ids: Id<"profiles">[] = [];
    for (let i = 0; i < 250; i++) ids.push(await addProfile(t, `u${i}`, { photoKey: "p.jpg" }));
    await t.mutation(internal.migrations.backfillMediaFlags, {});
    const done = async () =>
      (await t.run((ctx) => ctx.db.query("profiles").collect())).filter((p) => p.hasPhoto === true).length;
    expect(await done()).toBe(100);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await done()).toBe(250);
  });
});
