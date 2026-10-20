import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { MOOD_ICONS } from "../../lib/moods";
import { moodSvg } from "../../lib/moodSvg";
import { addProfile, as, setup } from "./helpers";

describe("profiles.setMood", () => {
  test("sets, trims, reads back on the public profile, and clears", async () => {
    const t = setup();
    const me = await addProfile(t, "mia");
    const mia = await as(t, me);
    await mia.mutation(api.profiles.setMood, { icon: "happy", text: "  great day  " });
    let p = await t.query(api.profiles.getPublicProfile, { username: "mia" });
    expect(p).toMatchObject({ mood: { icon: "happy", text: "great day" } });

    await mia.mutation(api.profiles.setMood, { icon: null });
    p = await t.query(api.profiles.getPublicProfile, { username: "mia" });
    expect(p).toMatchObject({ mood: null });
    expect((await t.run((ctx) => ctx.db.get(me)))!.mood).toBeUndefined();
  });

  test("text alone keeps the current icon; with no mood it needs an icon", async () => {
    const t = setup();
    const me = await addProfile(t, "mia");
    const mia = await as(t, me);
    await expect(mia.mutation(api.profiles.setMood, { text: "hi" })).rejects.toThrow("Pick a mood");
    await mia.mutation(api.profiles.setMood, { icon: "sad", text: "meh" });
    await mia.mutation(api.profiles.setMood, { text: "better" });
    expect((await t.run((ctx) => ctx.db.get(me)))!.mood).toEqual({ icon: "sad", text: "better" });
  });

  test("rejects text over 40 characters but allows exactly 40", async () => {
    const t = setup();
    const mia = await as(t, await addProfile(t, "mia"));
    await expect(mia.mutation(api.profiles.setMood, { icon: "happy", text: "x".repeat(41) })).rejects.toThrow(
      "Mood is too long",
    );
    await mia.mutation(api.profiles.setMood, { icon: "happy", text: "x".repeat(40) });
  });

  test("needs a profile and is limited to 30 an hour", async () => {
    const t = setup();
    await expect(t.mutation(api.profiles.setMood, { icon: "happy" })).rejects.toThrow();
    const mia = await as(t, await addProfile(t, "mia"));
    for (let i = 0; i < 30; i++) await mia.mutation(api.profiles.setMood, { icon: "happy", text: `n${i}` });
    await expect(mia.mutation(api.profiles.setMood, { icon: "happy", text: "more" })).rejects.toThrow("Slow down");
  });

  test("a profile with no mood reports null", async () => {
    const t = setup();
    await addProfile(t, "mia");
    expect(await t.query(api.profiles.getPublicProfile, { username: "mia" })).toMatchObject({ mood: null });
  });
});

describe("lib/moodSvg", () => {
  test("draws every icon as its own svg", () => {
    for (const icon of MOOD_ICONS) expect(moodSvg(icon)).toContain(`data-mood-icon="${icon}"`);
  });
});
