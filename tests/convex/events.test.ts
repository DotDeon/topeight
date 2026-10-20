import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DAY, NOW, addProfile, as, block, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("ADMIN_EMAILS", "boss@example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** A host, a guest and an admin, all old enough to post links. "Now" is 2026-10-21T12:00Z. */
async function world() {
  const t = setup();
  const host = await addProfile(t, "host");
  const guest = await addProfile(t, "guest");
  const boss = await addProfile(t, "boss");
  vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
  return { t, host, guest, boss };
}

const base = {
  title: "Gig night",
  localDate: "2026-10-24",
  localTime: "20:00",
  timeZone: "Africa/Johannesburg",
  venue: "The Bassline",
  city: "Johannesburg",
  description: "Bring friends",
};

async function create(t: T, who: Id<"profiles">, extra: Record<string, unknown> = {}) {
  return await (await as(t, who)).mutation(api.events.create, { ...base, ...extra });
}

async function addShow(t: T, artist: Id<"profiles">, date: string, city = "Johannesburg", venue = "Club") {
  return await t.run((ctx) => ctx.db.insert("shows", { profileId: artist, date, venue, city }));
}

async function insertEvent(t: T, hostId: Id<"profiles">, startsAt: number, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("events", {
      hostId,
      title: "raw",
      localDate: "2026-10-26",
      localTime: "20:00",
      timeZone: "UTC",
      startsAt,
      venue: "v",
      city: "c",
      cityKey: "c",
      description: "",
      cancelled: false,
      hidden: false,
      goingCount: 0,
      maybeCount: 0,
      ...extra,
    }),
  );
}

async function ban(t: T, boss: Id<"profiles">, profileId: Id<"profiles">) {
  await (await as(t, boss)).mutation(api.moderation.ban, { profileId });
}

describe("events.create", () => {
  test("stores trimmed fields, the UTC start and the city key", async () => {
    const { t, host } = await world();
    const id = await create(t, host, {
      title: "  Gig night  ",
      venue: " The Bassline ",
      city: "  Johannesburg ",
      description: "  Bring friends  ",
      imageUrl: " https://example.com/flyer.jpg ",
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({
      hostId: host,
      title: "Gig night",
      venue: "The Bassline",
      city: "Johannesburg",
      cityKey: "johannesburg",
      description: "Bring friends",
      imageUrl: "https://example.com/flyer.jpg",
      startsAt: Date.parse("2026-10-24T18:00:00Z"),
      cancelled: false,
      hidden: false,
      goingCount: 0,
      maybeCount: 0,
    });
    const got = await (await as(t, host)).query(api.events.get, { id });
    expect(got).toMatchObject({
      id,
      title: "Gig night",
      localDate: "2026-10-24",
      localTime: "20:00",
      timeZone: "Africa/Johannesburg",
      host: { username: "host" },
      going: 0,
      maybe: 0,
      attendees: [],
      myStatus: null,
      canEdit: true,
      cancelled: false,
    });
    expect((await t.query(api.events.get, { id }))?.canEdit).toBe(false);
  });

  test("stores the canonical timezone name", async () => {
    const { t, host } = await world();
    const id = await create(t, host, { timeZone: "europe/london" });
    expect((await t.run((ctx) => ctx.db.get(id)))!.timeZone).toBe("Europe/London");
  });

  test("blank description and image are allowed", async () => {
    const { t, host } = await world();
    const id = await create(t, host, { description: "  ", imageUrl: "  " });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.description).toBe("");
    expect(row).not.toHaveProperty("imageUrl");
  });

  test("date, time, timezone and future checks", async () => {
    const { t, host } = await world();
    await expect(create(t, host, { timeZone: "Mars/Olympus" })).rejects.toThrow("Invalid timezone");
    await expect(create(t, host, { timeZone: "+02:00" })).rejects.toThrow("Invalid timezone");
    await expect(create(t, host, { localDate: "2026-02-30" })).rejects.toThrow("Invalid date");
    await expect(create(t, host, { localDate: "24/10/2026" })).rejects.toThrow("Invalid date");
    await expect(create(t, host, { localTime: "25:00" })).rejects.toThrow("Invalid time");
    await expect(create(t, host, { localTime: "8pm" })).rejects.toThrow("Invalid time");
    await expect(create(t, host, { localDate: "2026-10-20" })).rejects.toThrow("Event must be in the future");
    // 2026-10-21 13:00 SAST is 11:00Z, an hour ago.
    await expect(create(t, host, { localDate: "2026-10-21", localTime: "13:00" })).rejects.toThrow(
      "Event must be in the future",
    );
    await create(t, host, { localDate: "2026-10-21", localTime: "15:00" });
  });

  test("field limits", async () => {
    const { t, host } = await world();
    await expect(create(t, host, { title: " " })).rejects.toThrow("Title can't be empty");
    await expect(create(t, host, { title: "x".repeat(101) })).rejects.toThrow("Title is too long");
    await expect(create(t, host, { venue: " " })).rejects.toThrow("Venue can't be empty");
    await expect(create(t, host, { venue: "x".repeat(101) })).rejects.toThrow("Venue is too long");
    await expect(create(t, host, { city: "" })).rejects.toThrow("City can't be empty");
    await expect(create(t, host, { city: "x".repeat(101) })).rejects.toThrow("City is too long");
    await expect(create(t, host, { description: "x".repeat(5001) })).rejects.toThrow("Description is too long");
    await create(t, host, {
      title: "x".repeat(100),
      venue: "x".repeat(100),
      city: "x".repeat(100),
      description: "x".repeat(5000),
    });
  });

  test("the image link must be http(s) and at most 500 characters", async () => {
    const { t, host } = await world();
    const msg = "Image link must start with http:// or https://";
    for (const imageUrl of [
      "javascript:alert(1)",
      "ftp://a.com/x.jpg",
      "example.com/x.jpg",
      "https://",
      "https://a.com/" + "x".repeat(500),
    ]) {
      await expect(create(t, host, { imageUrl })).rejects.toThrow(msg);
    }
    await create(t, host, { imageUrl: "http://a.com/x.png" });
    await create(t, host, { imageUrl: "https://a.com/" + "x".repeat(486) });
  });

  test("accounts under 24 hours cannot put links in the description or an image", async () => {
    const t = setup();
    const fresh = await addProfile(t, "fresh");
    vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
    for (const extra of [
      { description: "see https://a.com" },
      { description: "www.a.com" },
      { imageUrl: "https://a.com/x.jpg" },
    ]) {
      await expect(create(t, fresh, extra)).rejects.toThrow("New accounts can't post links yet");
    }
    await create(t, fresh);
    vi.setSystemTime(new Date(NOW.getTime() + DAY + 1000));
    await create(t, fresh, {
      description: "see https://a.com",
      imageUrl: "https://a.com/x.jpg",
    });
  });

  test("5 events a day, refused ones do not count", async () => {
    const { t, host } = await world();
    await expect(create(t, host, { title: "" })).rejects.toThrow();
    await expect(create(t, host, { localDate: "2020-01-01" })).rejects.toThrow();
    for (let i = 0; i < 5; i++) await create(t, host, { title: `e${i}` });
    await expect(create(t, host)).rejects.toThrow("Slow down");
    vi.setSystemTime(new Date(Date.now() + DAY + 1000));
    await create(t, host, { localDate: "2026-10-30" });
  });

  test("needs a signed-in, unbanned profile", async () => {
    const { t, host, boss } = await world();
    await expect(t.mutation(api.events.create, base)).rejects.toThrow("Not signed in");
    await ban(t, boss, host);
    await expect(create(t, host)).rejects.toThrow("Account banned");
  });
});

describe("events.update and cancel", () => {
  test("only the host edits, and edits recompute the start and city key", async () => {
    const { t, host, guest } = await world();
    const id = await create(t, host);
    const fields = {
      ...base,
      title: "Moved",
      localTime: "21:30",
      timeZone: "Europe/London",
      city: "LONDON ",
    };
    await expect((await as(t, guest)).mutation(api.events.update, { id, ...fields })).rejects.toThrow("Not allowed");
    await expect(t.mutation(api.events.update, { id, ...fields })).rejects.toThrow("Not signed in");
    await (await as(t, host)).mutation(api.events.update, { id, ...fields });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({
      title: "Moved",
      city: "LONDON",
      cityKey: "london",
      timeZone: "Europe/London",
      localTime: "21:30",
      startsAt: Date.parse("2026-10-24T20:30:00Z"),
    });
  });

  test("update runs the same checks and drops a removed image", async () => {
    const { t, host } = await world();
    const id = await create(t, host, { imageUrl: "https://a.com/x.jpg" });
    const h = await as(t, host);
    await expect(h.mutation(api.events.update, { id, ...base, title: "" })).rejects.toThrow("Title can't be empty");
    await expect(h.mutation(api.events.update, { id, ...base, timeZone: "Nope/Nope" })).rejects.toThrow(
      "Invalid timezone",
    );
    await expect(h.mutation(api.events.update, { id, ...base, localDate: "2026-10-01" })).rejects.toThrow(
      "Event must be in the future",
    );
    await expect(h.mutation(api.events.update, { id, ...base, imageUrl: "data:x" })).rejects.toThrow(
      "Image link must start with http:// or https://",
    );
    await h.mutation(api.events.update, { id, ...base });
    expect(await t.run((ctx) => ctx.db.get(id))).not.toHaveProperty("imageUrl");
  });

  test("only the host cancels; a cancelled event stays listed as cancelled", async () => {
    const { t, host, guest } = await world();
    const id = await create(t, host);
    await expect((await as(t, guest)).mutation(api.events.cancel, { id })).rejects.toThrow("Not allowed");
    await (await as(t, host)).mutation(api.events.cancel, { id });
    expect((await t.query(api.events.get, { id }))?.cancelled).toBe(true);
    const list = await t.query(api.events.upcoming, {});
    expect(list.items).toEqual([expect.objectContaining({ kind: "event", id, cancelled: true })]);
    await expect(
      (await as(t, guest)).mutation(api.events.rsvp, {
        eventId: id,
        status: "going",
      }),
    ).rejects.toThrow("Event is cancelled");
  });

  test("get returns null for malformed ids and hidden events", async () => {
    const { t, host } = await world();
    const id = await create(t, host);
    expect(await t.query(api.events.get, { id: "nope" })).toBeNull();
    await t.run((ctx) => ctx.db.patch(id, { hidden: true }));
    expect(await t.query(api.events.get, { id })).toBeNull();
    await expect((await as(t, host)).mutation(api.events.cancel, { id })).rejects.toThrow("Not found");
  });
});

describe("events.rsvp", () => {
  test("going, maybe and clearing keep the counts in step", async () => {
    const { t, host, guest } = await world();
    const id = await create(t, host);
    const g = await as(t, guest);
    const counts = async () => {
      const e = await t.run((ctx) => ctx.db.get(id));
      return [e!.goingCount, e!.maybeCount];
    };

    await g.mutation(api.events.rsvp, { eventId: id, status: "going" });
    expect(await counts()).toEqual([1, 0]);
    await g.mutation(api.events.rsvp, { eventId: id, status: "going" });
    expect(await counts()).toEqual([1, 0]);
    let got = await g.query(api.events.get, { id });
    expect(got).toMatchObject({
      going: 1,
      maybe: 0,
      myStatus: "going",
      attendees: [{ username: "guest" }],
    });

    await g.mutation(api.events.rsvp, { eventId: id, status: "maybe" });
    expect(await counts()).toEqual([0, 1]);
    got = await g.query(api.events.get, { id });
    expect(got).toMatchObject({
      going: 0,
      maybe: 1,
      myStatus: "maybe",
      attendees: [],
    });

    await (await as(t, host)).mutation(api.events.rsvp, { eventId: id, status: "going" });
    expect(await counts()).toEqual([1, 1]);

    await g.mutation(api.events.rsvp, { eventId: id, status: null });
    await g.mutation(api.events.rsvp, { eventId: id, status: null });
    expect(await counts()).toEqual([1, 0]);
    expect((await g.query(api.events.get, { id }))?.myStatus).toBeNull();
    const rows = await t.run((ctx) => ctx.db.query("rsvps").collect());
    expect(rows).toHaveLength(1);

    const list = await t.query(api.events.upcoming, {});
    expect(list.items[0]).toMatchObject({ kind: "event", going: 1 });
  });

  test("the attendee grid shows at most 24 going", async () => {
    const { t, host } = await world();
    const id = await create(t, host);
    for (let i = 0; i < 26; i++) {
      const p = await addProfile(t, `fan${i}`);
      await (await as(t, p)).mutation(api.events.rsvp, { eventId: id, status: "going" });
    }
    const got = await t.query(api.events.get, { id });
    expect(got?.going).toBe(26);
    expect(got?.attendees).toHaveLength(24);
  });

  test("60 answers a minute per member", async () => {
    const { t, host, guest } = await world();
    const id = await create(t, host);
    const g = await as(t, guest);
    for (let i = 0; i < 60; i++) {
      await g.mutation(api.events.rsvp, {
        eventId: id,
        status: i % 2 === 0 ? "going" : null,
      });
    }
    await expect(g.mutation(api.events.rsvp, { eventId: id, status: "maybe" })).rejects.toThrow("Slow down");
    vi.setSystemTime(new Date(Date.now() + 61 * 1000));
    await g.mutation(api.events.rsvp, { eventId: id, status: "maybe" });
  });

  test("blocked pairs cannot RSVP, and past events cannot take new RSVPs", async () => {
    const { t, host, guest } = await world();
    const id = await create(t, host, {
      localDate: "2026-10-21",
      localTime: "15:00",
    });
    await block(t, host, guest);
    await expect(
      (await as(t, guest)).mutation(api.events.rsvp, {
        eventId: id,
        status: "going",
      }),
    ).rejects.toThrow("Not allowed");
    const other = await addProfile(t, "other");
    const o = await as(t, other);
    await o.mutation(api.events.rsvp, { eventId: id, status: "maybe" });
    vi.setSystemTime(new Date(Date.parse("2026-10-21T14:00:00Z")));
    await expect(o.mutation(api.events.rsvp, { eventId: id, status: "going" })).rejects.toThrow(
      "Event has already started",
    );
    await o.mutation(api.events.rsvp, { eventId: id, status: null });
  });
});

describe("banned members", () => {
  test("a banned host's events disappear from get, upcoming and myEvents", async () => {
    const { t, host, guest, boss } = await world();
    const id = await create(t, host);
    await (await as(t, guest)).mutation(api.events.rsvp, { eventId: id, status: "going" });
    await ban(t, boss, host);
    expect(await t.query(api.events.get, { id })).toBeNull();
    expect((await t.query(api.events.upcoming, {})).items).toEqual([]);
    expect(await (await as(t, guest)).query(api.events.myEvents, {})).toEqual([]);
    await expect(
      (await as(t, guest)).mutation(api.events.rsvp, {
        eventId: id,
        status: "maybe",
      }),
    ).rejects.toThrow("Not found");
  });

  test("a banned member's RSVPs leave the grid and the counts, and come back on unban", async () => {
    const { t, host, guest, boss } = await world();
    const id = await create(t, host);
    const other = await addProfile(t, "other");
    await (await as(t, guest)).mutation(api.events.rsvp, { eventId: id, status: "going" });
    await (await as(t, other)).mutation(api.events.rsvp, { eventId: id, status: "maybe" });
    await (await as(t, host)).mutation(api.events.rsvp, { eventId: id, status: "going" });

    await ban(t, boss, guest);
    await ban(t, boss, other);
    await ban(t, boss, other); // a repeat ban changes nothing
    let got = await t.query(api.events.get, { id });
    expect(got).toMatchObject({ going: 1, maybe: 0 });
    expect(got?.attendees.map((a) => a.username)).toEqual(["host"]);

    await (await as(t, boss)).mutation(api.moderation.unban, { profileId: guest });
    await (await as(t, boss)).mutation(api.moderation.unbanByUsername, { username: "other" });
    await (await as(t, boss)).mutation(api.moderation.unban, { profileId: other }); // already unbanned
    got = await t.query(api.events.get, { id });
    expect(got).toMatchObject({ going: 2, maybe: 1 });
  });
});

describe("events.upcoming", () => {
  test("merges events and artist shows by start, with the city filter on both", async () => {
    const { t, host } = await world();
    const artist = await addProfile(t, "band", { kind: "artist" });
    const bannedArtist = await addProfile(t, "badband", {
      kind: "artist",
      banned: true,
    });
    // 24 Oct 18:00Z, 23 Oct 18:00Z (Joburg), and London 24 Oct 20:00 BST = 19:00Z.
    const e1 = await create(t, host);
    const e2 = await create(t, host, {
      localDate: "2026-10-23",
      title: "Earlier",
    });
    const e3 = await create(t, host, {
      timeZone: "Europe/London",
      city: "London",
      title: "London",
    });
    // A show on 24 Oct starts at 00:00Z that day, so before e1 and after e2.
    const s1 = await addShow(t, artist, "2026-10-24", " johannesburg ");
    const s2 = await addShow(t, artist, "2026-10-21", "London");
    await addShow(t, artist, "2026-10-20"); // past
    await addShow(t, bannedArtist, "2026-10-22");

    const all = await t.query(api.events.upcoming, {});
    expect(all.items.map((i) => i.id)).toEqual([s2, e2, s1, e1, e3]);
    expect(all.nextCursor).toBeNull();
    expect(all.items[0]).toEqual({
      kind: "show",
      id: s2,
      artist: {
        username: "band",
        displayName: "BAND",
        photoUrl: null,
        kind: "artist",
      },
      date: "2026-10-21",
      startsAt: Date.UTC(2026, 9, 21),
      venue: "Club",
      city: "London",
    });
    expect(all.items[1]).toEqual({
      kind: "event",
      id: e2,
      title: "Earlier",
      startsAt: Date.parse("2026-10-23T18:00:00Z"),
      timeZone: "Africa/Johannesburg",
      venue: "The Bassline",
      city: "Johannesburg",
      host: {
        username: "host",
        displayName: "HOST",
        photoUrl: null,
        kind: "fan",
      },
      going: 0,
      cancelled: false,
    });

    const joburg = await t.query(api.events.upcoming, {
      city: "  JOHANNESBURG ",
    });
    expect(joburg.items.map((i) => i.id)).toEqual([e2, s1, e1]);
    const london = await t.query(api.events.upcoming, { city: "london" });
    expect(london.items.map((i) => i.id)).toEqual([s2, e3]);
    expect((await t.query(api.events.upcoming, { city: "Paris" })).items).toEqual([]);
  });

  test("events that have started and hidden events are left out", async () => {
    const { t, host } = await world();
    const soon = await create(t, host, {
      localDate: "2026-10-21",
      localTime: "15:00",
    });
    const hidden = await create(t, host, { title: "Hidden" });
    await t.run((ctx) => ctx.db.patch(hidden, { hidden: true }));
    expect((await t.query(api.events.upcoming, {})).items.map((i) => i.id)).toEqual([soon]);
    vi.setSystemTime(new Date(Date.parse("2026-10-21T13:30:00Z")));
    expect((await t.query(api.events.upcoming, {})).items).toEqual([]);
  });

  test("pages of 50 with a cursor that handles ties", async () => {
    const { t, host } = await world();
    const artist = await addProfile(t, "band", { kind: "artist" });
    // 30 shows on one date (all start at the same instant), then 40 events at one time a day later.
    const shows: string[] = [];
    for (let i = 0; i < 30; i++) shows.push(await addShow(t, artist, "2026-10-25"));
    const events: string[] = [];
    await t.run(async (ctx) => {
      const startsAt = Date.parse("2026-10-26T18:00:00Z");
      for (let i = 0; i < 40; i++) {
        events.push(
          await ctx.db.insert("events", {
            hostId: host,
            title: `e${i}`,
            localDate: "2026-10-26",
            localTime: "20:00",
            timeZone: "Africa/Johannesburg",
            startsAt,
            venue: "v",
            city: "c",
            cityKey: "c",
            description: "",
            cancelled: false,
            hidden: false,
            goingCount: 0,
            maybeCount: 0,
          }),
        );
      }
    });
    const first = await t.query(api.events.upcoming, {});
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await t.query(api.events.upcoming, {
      cursor: first.nextCursor!,
    });
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map((i) => i.id);
    expect(seen).toEqual([...shows, ...events]);
  });

  test("reads at most 100 rows per source and stops at the shorter source", async () => {
    const { t, host } = await world();
    const artist = await addProfile(t, "band", { kind: "artist" });
    const banned = await addProfile(t, "badhost", { banned: true });
    await t.run(async (ctx) => {
      // 120 events by a banned host fill the event read; one visible event sits after them.
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert("events", {
          hostId: banned,
          title: `b${i}`,
          localDate: "2026-10-22",
          localTime: "20:00",
          timeZone: "UTC",
          startsAt: Date.parse("2026-10-22T20:00:00Z") + i,
          venue: "v",
          city: "c",
          cityKey: "c",
          description: "",
          cancelled: false,
          hidden: false,
          goingCount: 0,
          maybeCount: 0,
        });
      }
    });
    const late = await create(t, host, { localDate: "2026-10-28" });
    const show = await addShow(t, artist, "2026-10-30");
    const first = await t.query(api.events.upcoming, {});
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await t.query(api.events.upcoming, {
      cursor: first.nextCursor!,
    });
    expect(second.items.map((i) => i.id)).toEqual([late, show]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("events.upcoming cursor edge cases", () => {
  test("does not skip shows when the first event sits on the date of the 100th show", async () => {
    const { t, host } = await world();
    const artist = await addProfile(t, "band", { kind: "artist" });
    const shows: string[] = [];
    // 98 shows early, then 22 on the 100th show's date; only the first two of those are in the first read.
    for (let i = 0; i < 98; i++) shows.push(await addShow(t, artist, "2026-10-22", "c"));
    for (let i = 0; i < 22; i++) shows.push(await addShow(t, artist, "2026-10-25", "c"));
    const events: string[] = [];
    // A hidden event on that date makes the event read start there, and leaves the pages short.
    await insertEvent(t, host, Date.parse("2026-10-25T00:00:00Z"), {
      hidden: true,
    });
    for (let i = 0; i < 99; i++) events.push(await insertEvent(t, host, Date.parse("2026-10-26T00:00:00Z")));
    const seen: string[] = [];
    let cursor: { startsAt: number; skip: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await t.query(api.events.upcoming, {
        city: "c",
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((x) => x.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...shows, ...events].sort());
  });

  test("a cursor that is not finite gives an empty page", async () => {
    const { t, host } = await world();
    await create(t, host);
    for (const startsAt of [NaN, Infinity, -Infinity]) {
      expect(await t.query(api.events.upcoming, { cursor: { startsAt, skip: 0 } })).toEqual({
        items: [],
        nextCursor: null,
      });
    }
    expect(
      await t.query(api.events.upcoming, {
        cursor: { startsAt: 0, skip: NaN },
      }),
    ).toMatchObject({
      nextCursor: null,
    });
  });
});

describe("events.myEvents", () => {
  test("reads the newest RSVPs first when there are more than 200", async () => {
    const { t, host, guest } = await world();
    const start = Date.parse("2026-10-30T00:00:00Z");
    const ids: Id<"events">[] = [];
    for (let i = 0; i < 205; i++) ids.push(await insertEvent(t, host, start + i * 1000));
    // Answer in reverse event order, so the newest answer is for the first event.
    await t.run(async (ctx) => {
      for (let i = ids.length - 1; i >= 0; i--) {
        await ctx.db.insert("rsvps", {
          eventId: ids[i],
          profileId: guest,
          status: "going",
        });
      }
    });
    const list = await (await as(t, guest)).query(api.events.myEvents, {});
    expect(list).toHaveLength(200);
    expect(list.some((e) => e.id === ids[0])).toBe(true);
    expect(list.some((e) => e.id === ids[204])).toBe(false);
  });

  test("upcoming events the viewer hosts or answered, soonest first", async () => {
    const { t, host, guest } = await world();
    const mine = await create(t, guest, {
      localDate: "2026-10-25",
      title: "Mine",
    });
    const going = await create(t, host, { localDate: "2026-10-23" });
    const maybe = await create(t, host, { localDate: "2026-10-27" });
    const ignored = await create(t, host, { localDate: "2026-10-28" });
    const g = await as(t, guest);
    await g.mutation(api.events.rsvp, { eventId: going, status: "going" });
    await g.mutation(api.events.rsvp, { eventId: maybe, status: "maybe" });
    await g.mutation(api.events.rsvp, { eventId: mine, status: "going" });
    const list = await g.query(api.events.myEvents, {});
    expect(list.map((e) => [e.id, e.role])).toEqual([
      [going, "going"],
      [mine, "host"],
      [maybe, "maybe"],
    ]);
    expect(list.some((e) => e.id === ignored)).toBe(false);
    expect(await t.query(api.events.myEvents, {})).toEqual([]);
  });
});

describe("moderation", () => {
  test("an event can be reported, previewed and hidden", async () => {
    const { t, host, guest, boss } = await world();
    const id = await create(t, host, {
      title: "Bad",
      description: "bad words",
    });
    await (
      await as(t, guest)
    ).mutation(api.moderation.report, {
      targetType: "event",
      targetId: id,
      reason: "spam",
    });
    await (
      await as(t, host)
    ).mutation(api.events.update, {
      id,
      ...base,
      title: "Clean",
      description: "clean",
    });
    const b = await as(t, boss);
    const [row] = await b.query(api.moderation.listOpen, {});
    expect(row.preview).toEqual({
      kind: "event",
      title: "Bad",
      body: "bad words",
      authorId: host,
      author: {
        username: "host",
        displayName: "HOST",
        photoUrl: null,
        kind: "fan",
      },
    });
    await b.mutation(api.moderation.hide, { reportId: row.id });
    expect((await t.run((ctx) => ctx.db.get(id)))?.hidden).toBe(true);
    expect(await t.query(api.events.get, { id })).toBeNull();
    expect(await b.query(api.moderation.listOpen, {})).toEqual([]);
  });
});

describe("resetEventsFixture", () => {
  async function fixture(t: T, username: string, email: string) {
    const profile = await addProfile(t, username);
    await t.run(async (ctx) => {
      await ctx.db.patch((await ctx.db.get(profile))!.userId, { email });
    });
    return profile;
  }

  test("refuses an e2eadmin or e2ecommenter that isn't the fixture user", async () => {
    vi.stubEnv("TOPEIGHT_TEST_FIXTURES", "1");
    const { t, host } = await world();
    const real = await addProfile(t, "e2eadmin");
    const eventId = await insertEvent(t, real, Date.now() + DAY);
    await expect(t.mutation(internal.testing.resetEventsFixture, {})).rejects.toThrow(/not a fixture/);
    expect(await t.run((ctx) => ctx.db.get(eventId))).not.toBeNull();
    void host;
  });

  test("deletes fixture events and RSVPs and keeps other hosts' counts right", async () => {
    vi.stubEnv("TOPEIGHT_TEST_FIXTURES", "1");
    const { t, host, guest } = await world();
    const admin = await fixture(t, "e2eadmin", "e2e-admin@fixture.invalid");
    const commenter = await fixture(t, "e2ecommenter", "e2e-commenter@fixture.invalid");
    const theirs = await create(t, host);
    const mine = await insertEvent(t, admin, Date.now() + DAY);
    await (await as(t, admin)).mutation(api.events.rsvp, { eventId: theirs, status: "going" });
    await (await as(t, commenter)).mutation(api.events.rsvp, { eventId: theirs, status: "maybe" });
    await (await as(t, guest)).mutation(api.events.rsvp, { eventId: theirs, status: "going" });
    await (await as(t, guest)).mutation(api.events.rsvp, { eventId: mine, status: "going" });

    await t.mutation(internal.testing.resetEventsFixture, {});
    expect(await t.run((ctx) => ctx.db.get(mine))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(theirs))).toMatchObject({ goingCount: 1, maybeCount: 0 });
    const left = await t.run((ctx) => ctx.db.query("rsvps").take(10));
    expect(left.map((r) => [r.eventId, r.profileId])).toEqual([[theirs, guest]]);
  });
});
