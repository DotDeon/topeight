import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as mailModule from "../../convex/mail";
import { rateLimiter } from "../../convex/lib/limits";
import { DAY, NOW, addProfile, as, befriend, block, setup, type T } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** Two friends and a stranger, all old enough to post links. */
async function world() {
  const t = setup();
  const alice = await addProfile(t, "alice");
  const bob = await addProfile(t, "bob");
  const carol = await addProfile(t, "carol");
  await befriend(t, alice, bob);
  vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
  return { t, alice, bob, carol };
}

async function send(t: T, from: Id<"profiles">, to: string, subject = "hi", body = "hello there") {
  return await (await as(t, from)).mutation(api.mail.send, { to, subject, body });
}

async function insertMessage(t: T, senderId: Id<"profiles">, recipientId: Id<"profiles">, subject: string) {
  return await t.run((ctx) =>
    ctx.db.insert("messages", {
      senderId,
      recipientId,
      subject,
      body: "b",
      unread: true,
      senderDeleted: false,
      recipientDeleted: false,
    }),
  );
}

describe("mail.send and canMessage", () => {
  test("friends can message each other and the message is stored trimmed and unread", async () => {
    const { t, alice, bob } = await world();
    const id = await (await as(t, alice)).mutation(api.mail.send, { to: "bob", subject: "  hey  ", body: "  how are you  " });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({
      senderId: alice,
      recipientId: bob,
      subject: "hey",
      body: "how are you",
      unread: true,
      senderDeleted: false,
      recipientDeleted: false,
    });
    expect(row!.readAt).toBeUndefined();
    expect(await (await as(t, alice)).query(api.mail.canMessage, { username: "bob" })).toBe(true);
  });

  test("a friends-only recipient rejects a non-friend; Anyone allows it", async () => {
    const { t, bob, carol } = await world();
    const c = await as(t, carol);
    expect(await c.query(api.mail.canMessage, { username: "bob" })).toBe(false);
    await expect(send(t, carol, "bob")).rejects.toThrow("This person only accepts messages from friends");
    await (await as(t, bob)).mutation(api.mail.setMailFrom, { value: "anyone" });
    expect(await c.query(api.mail.canMessage, { username: "bob" })).toBe(true);
    await send(t, carol, "bob");
  });

  test("setMailFrom stores the setting and friends is the default", async () => {
    const { t, bob } = await world();
    const b = await as(t, bob);
    expect((await t.run((ctx) => ctx.db.get(bob)))!.mailFrom).toBeUndefined();
    await b.mutation(api.mail.setMailFrom, { value: "anyone" });
    expect((await t.run((ctx) => ctx.db.get(bob)))!.mailFrom).toBe("anyone");
    await b.mutation(api.mail.setMailFrom, { value: "friends" });
    expect((await t.run((ctx) => ctx.db.get(bob)))!.mailFrom).toBe("friends");
    await expect(t.mutation(api.mail.setMailFrom, { value: "anyone" })).rejects.toThrow("Not signed in");
  });

  test("a block either way rejects with Not allowed, even between friends on Anyone", async () => {
    const { t, alice, bob } = await world();
    await (await as(t, bob)).mutation(api.mail.setMailFrom, { value: "anyone" });
    await block(t, bob, alice);
    await expect(send(t, alice, "bob")).rejects.toThrow("Not allowed");
    await expect(send(t, bob, "alice")).rejects.toThrow("Not allowed");
    expect(await (await as(t, alice)).query(api.mail.canMessage, { username: "bob" })).toBe(false);
    expect(await (await as(t, bob)).query(api.mail.canMessage, { username: "alice" })).toBe(false);
  });

  test("you cannot message yourself or the house account", async () => {
    const { t, alice } = await world();
    const house = await addProfile(t, "tom", { isHouse: true, mailFrom: "anyone" });
    await befriend(t, alice, house);
    await expect(send(t, alice, "alice")).rejects.toThrow("Not allowed");
    await expect(send(t, alice, "tom")).rejects.toThrow("Not allowed");
    const a = await as(t, alice);
    expect(await a.query(api.mail.canMessage, { username: "alice" })).toBe(false);
    expect(await a.query(api.mail.canMessage, { username: "tom" })).toBe(false);
  });

  test("unknown and banned recipients are not found, and canMessage is false for them and signed-out callers", async () => {
    const { t, alice } = await world();
    const banned = await addProfile(t, "gone", { banned: true, mailFrom: "anyone" });
    await befriend(t, alice, banned);
    await expect(send(t, alice, "nobody")).rejects.toThrow("Profile not found");
    await expect(send(t, alice, "gone")).rejects.toThrow("Profile not found");
    await expect(send(t, alice, "Not A Name!")).rejects.toThrow("Profile not found");
    const a = await as(t, alice);
    expect(await a.query(api.mail.canMessage, { username: "gone" })).toBe(false);
    expect(await a.query(api.mail.canMessage, { username: "nobody" })).toBe(false);
    expect(await t.query(api.mail.canMessage, { username: "bob" })).toBe(false);
  });

  test("subject 1 to 100 and body 1 to 5000 characters after trimming", async () => {
    const { t, alice } = await world();
    await expect(send(t, alice, "bob", "   ", "body")).rejects.toThrow("Subject can't be empty");
    await expect(send(t, alice, "bob", "x".repeat(101), "body")).rejects.toThrow("Subject is too long");
    await expect(send(t, alice, "bob", "s", "   ")).rejects.toThrow("Message can't be empty");
    await expect(send(t, alice, "bob", "s", "x".repeat(5001))).rejects.toThrow("Message is too long");
    await send(t, alice, "bob", ` ${"x".repeat(100)} `, ` ${"y".repeat(5000)} `);
  });

  test("new accounts cannot put links in the subject or the body", async () => {
    const t = setup();
    const fresh = await addProfile(t, "fresh");
    const bob = await addProfile(t, "bob");
    await befriend(t, fresh, bob);
    await expect(send(t, fresh, "bob", "see https://a.com", "body")).rejects.toThrow("New accounts can't post links yet");
    await expect(send(t, fresh, "bob", "s", "pic www.a.com")).rejects.toThrow("New accounts can't post links yet");
    await send(t, fresh, "bob", "plain", "plain text is fine");
    vi.setSystemTime(new Date(NOW.getTime() + DAY + 1000));
    await send(t, fresh, "bob", "see https://a.com", "https://b.com");
  });

  test("banned users cannot send and signed-out callers are refused", async () => {
    const { t, alice } = await world();
    await t.run((ctx) => ctx.db.patch(alice, { banned: true }));
    await expect(send(t, alice, "bob")).rejects.toThrow("Account banned");
    await expect(t.mutation(api.mail.send, { to: "bob", subject: "s", body: "b" })).rejects.toThrow("Not signed in");
  });

  test("30 messages an hour, then Slow down; failed sends don't use up the quota", async () => {
    const { t, alice } = await world();
    for (let i = 0; i < 10; i++) {
      await expect(send(t, alice, "bob", "", "body")).rejects.toThrow("Subject can't be empty");
      await expect(send(t, alice, "carol")).rejects.toThrow("This person only accepts messages from friends");
    }
    for (let i = 0; i < 30; i++) await send(t, alice, "bob", `m${i}`);
    await expect(send(t, alice, "bob")).rejects.toThrow("Slow down");
    vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY + 61 * 60 * 1000));
    await send(t, alice, "bob");
  });

  test("200 messages a day, then Slow down until the next day", async () => {
    // The limiter starts each window at a random offset unless told otherwise; pin it to the first send.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { t, alice } = await world();
    const start = NOW.getTime() + 2 * DAY;
    for (let h = 0; h < 7; h++) {
      vi.setSystemTime(new Date(start + h * 61 * 60 * 1000));
      const n = h < 6 ? 30 : 20;
      for (let i = 0; i < n; i++) await send(t, alice, "bob", `h${h}m${i}`);
    }
    vi.setSystemTime(new Date(start + 7 * 61 * 60 * 1000));
    await expect(send(t, alice, "bob")).rejects.toThrow("Slow down");
    vi.setSystemTime(new Date(start + DAY + 8 * 61 * 60 * 1000));
    await send(t, alice, "bob");
    random.mockRestore();
  });

  test("after an unfriend, a reply to a friends-only sender is refused", async () => {
    const { t, alice, bob } = await world();
    const id = await send(t, alice, "bob", "question");
    await t.run(async (ctx) => {
      for (const f of await ctx.db.query("friendships").take(10)) await ctx.db.delete(f._id);
    });
    const b = await as(t, bob);
    expect((await b.query(api.mail.get, { id })).canReply).toBe(false);
    await expect(
      b.mutation(api.mail.send, { to: "alice", subject: "Re: question", body: "answer", replyTo: id }),
    ).rejects.toThrow("This person only accepts messages from friends");
  });

  test("when the daily limit refuses a send, the hourly hit is rolled back", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { t, alice } = await world();
    const start = NOW.getTime() + 2 * DAY;
    for (let h = 0; h < 7; h++) {
      vi.setSystemTime(new Date(start + h * 61 * 60 * 1000));
      const n = h < 6 ? 30 : 20;
      for (let i = 0; i < n; i++) await send(t, alice, "bob", `h${h}m${i}`);
    }
    // A fresh hour: the hourly limit has room, the daily one does not.
    vi.setSystemTime(new Date(start + 7 * 61 * 60 * 1000));
    const hourly = () => t.run((ctx) => rateLimiter.getValue(ctx, "mail", { key: alice }));
    const before = (await hourly()).value;
    for (let i = 0; i < 3; i++) await expect(send(t, alice, "bob")).rejects.toThrow("Slow down");
    expect((await hourly()).value).toBe(before);
    random.mockRestore();
  });

  test("replyTo must be a message the sender received from the person being replied to", async () => {
    const { t, alice, bob, carol } = await world();
    await befriend(t, alice, carol);
    const first = await send(t, alice, "bob", "question");
    const b = await as(t, bob);
    const reply = await b.mutation(api.mail.send, { to: "alice", subject: "Re: question", body: "answer", replyTo: first });
    expect((await t.run((ctx) => ctx.db.get(reply)))!.replyTo).toBe(first);
    // Alice sent `first`, she did not receive it.
    await expect(
      (await as(t, alice)).mutation(api.mail.send, { to: "bob", subject: "s", body: "b", replyTo: first }),
    ).rejects.toThrow("Not found");
    // Carol never saw it.
    await expect(
      (await as(t, carol)).mutation(api.mail.send, { to: "alice", subject: "s", body: "b", replyTo: first }),
    ).rejects.toThrow("Not found");
    const view = await (await as(t, alice)).query(api.mail.get, { id: reply });
    expect(view.replyTo).toEqual({ subject: "question" });
  });
});

describe("inbox, sent, read, remove", () => {
  test("inbox and sent list newest first, 25 a page, with the other party's card", async () => {
    const { t, alice, bob } = await world();
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000);
      await send(t, alice, "bob", `m${i}`);
    }
    const b = await as(t, bob);
    const first = await b.query(api.mail.inbox, { cursor: null });
    expect(first.page).toHaveLength(25);
    expect(first.page[0]).toMatchObject({ other: { username: "alice" }, subject: "m29", unread: true });
    expect(first.page[0]).not.toHaveProperty("body");
    expect(first.isDone).toBe(false);
    const second = await b.query(api.mail.inbox, { cursor: first.continueCursor });
    expect(second.page.map((m) => m.subject)).toEqual(["m4", "m3", "m2", "m1", "m0"]);

    const a = await as(t, alice);
    const sent = await a.query(api.mail.sent, { cursor: null });
    expect(sent.page).toHaveLength(25);
    expect(sent.page[0]).toMatchObject({ other: { username: "bob" }, subject: "m29" });
    expect((await a.query(api.mail.inbox, { cursor: null })).page).toHaveLength(0);
    expect((await b.query(api.mail.sent, { cursor: null })).page).toHaveLength(0);
    expect(await t.query(api.mail.inbox, { cursor: null })).toEqual({ page: [], isDone: true, continueCursor: "" });
  });

  test("get returns the view with no side effects; markRead marks it read for the recipient only", async () => {
    const { t, alice, bob } = await world();
    const id = await send(t, alice, "bob", "subj", "line one\nline two");
    const a = await as(t, alice);
    const asSender = await a.query(api.mail.get, { id });
    expect(asSender).toMatchObject({
      id,
      from: { username: "alice" },
      to: { username: "bob" },
      subject: "subj",
      body: "line one\nline two",
      isRecipient: false,
      canReply: false,
      unread: false,
    });
    await a.mutation(api.mail.markRead, { id });
    expect((await t.run((ctx) => ctx.db.get(id)))!.unread).toBe(true);

    const b = await as(t, bob);
    const view = await b.query(api.mail.get, { id });
    expect(view).toMatchObject({ isRecipient: true, canReply: true, unread: true });
    expect(view.replyTo).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(id)))!.unread).toBe(true);
    await b.mutation(api.mail.markRead, { id });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.unread).toBe(false);
    expect(row!.readAt).toBe(Date.now());
    expect((await b.query(api.mail.inbox, { cursor: null })).page[0].unread).toBe(false);
    expect((await b.query(api.mail.get, { id })).unread).toBe(false);
    // A second markRead is a no-op and keeps the first readAt.
    vi.advanceTimersByTime(5000);
    await b.mutation(api.mail.markRead, { id });
    expect((await t.run((ctx) => ctx.db.get(id)))!.readAt).toBe(row!.readAt);
  });

  test("a third party, an admin, or a signed-out caller cannot read a message", async () => {
    vi.stubEnv("ADMIN_EMAILS", "carol@example.com");
    try {
      const { t, alice, carol } = await world();
      const id = await send(t, alice, "bob");
      await expect((await as(t, carol)).query(api.mail.get, { id })).rejects.toThrow("Not found");
      await expect(t.query(api.mail.get, { id })).rejects.toThrow("Not signed in");
      await expect((await as(t, carol)).mutation(api.mail.markRead, { id })).rejects.toThrow("Not found");
      await expect((await as(t, carol)).mutation(api.mail.remove, { id })).rejects.toThrow("Not found");
      expect((await t.run((ctx) => ctx.db.get(id)))!.unread).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("each side deletes its own copy, and the row goes when both have", async () => {
    const { t, alice, bob } = await world();
    const id = await send(t, alice, "bob");
    const a = await as(t, alice);
    const b = await as(t, bob);
    await b.mutation(api.mail.remove, { id });
    expect((await b.query(api.mail.inbox, { cursor: null })).page).toHaveLength(0);
    expect((await a.query(api.mail.sent, { cursor: null })).page).toHaveLength(1);
    await expect(b.query(api.mail.get, { id })).rejects.toThrow("Not found");
    await a.query(api.mail.get, { id });
    await a.mutation(api.mail.remove, { id });
    expect((await a.query(api.mail.sent, { cursor: null })).page).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });

  test("canReply is false when the sender has since blocked or been blocked", async () => {
    const { t, alice, bob } = await world();
    const id = await send(t, alice, "bob");
    await block(t, alice, bob);
    expect((await (await as(t, bob)).query(api.mail.get, { id })).canReply).toBe(false);
  });

  test("banned senders' messages leave the inbox and the unread count but stay readable", async () => {
    const { t, alice, bob } = await world();
    const id = await send(t, alice, "bob", "from alice");
    const b = await as(t, bob);
    expect(await b.query(api.mail.unreadCount, {})).toBe(1);
    await t.run((ctx) => ctx.db.patch(alice, { banned: true }));
    expect((await b.query(api.mail.inbox, { cursor: null })).page).toHaveLength(0);
    expect(await b.query(api.mail.unreadCount, {})).toBe(0);
    const view = await b.query(api.mail.get, { id });
    expect(view.subject).toBe("from alice");
    expect(view.canReply).toBe(false);
  });

  test("messages to a banned recipient leave the sender's sent list but stay readable", async () => {
    const { t, alice, bob } = await world();
    const id = await send(t, alice, "bob", "to bob");
    await t.run((ctx) => ctx.db.patch(bob, { banned: true }));
    const a = await as(t, alice);
    expect((await a.query(api.mail.sent, { cursor: null })).page).toHaveLength(0);
    expect((await a.query(api.mail.get, { id })).subject).toBe("to bob");
  });

  test("a block either way hides the sender's mail from the inbox and unread count until lifted", async () => {
    const { t, alice, bob } = await world();
    await send(t, alice, "bob", "before");
    const b = await as(t, bob);
    for (const [blocker, blocked] of [
      [bob, alice],
      [alice, bob],
    ] as const) {
      await block(t, blocker, blocked);
      expect((await b.query(api.mail.inbox, { cursor: null })).page).toHaveLength(0);
      expect(await b.query(api.mail.unreadCount, {})).toBe(0);
      await t.run(async (ctx) => {
        for (const row of await ctx.db.query("blocks").take(10)) await ctx.db.delete(row._id);
      });
      expect((await b.query(api.mail.inbox, { cursor: null })).page.map((m) => m.subject)).toEqual(["before"]);
      expect(await b.query(api.mail.unreadCount, {})).toBe(1);
    }
  });

  test("inbox skips hidden rows without returning empty pages while visible mail remains", async () => {
    const { t, alice, bob, carol } = await world();
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(1000);
      await insertMessage(t, alice, bob, `visible${i}`);
    }
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(1000);
      await insertMessage(t, carol, bob, `hidden${i}`);
    }
    await block(t, bob, carol);
    const b = await as(t, bob);
    const first = await b.query(api.mail.inbox, { cursor: null });
    expect(first.page.map((m) => m.subject)).toEqual(Array.from({ length: 25 }, (_, i) => `visible${29 - i}`));
    expect(first.isDone).toBe(false);
    const second = await b.query(api.mail.inbox, { cursor: first.continueCursor });
    expect(second.page.map((m) => m.subject)).toEqual(["visible4", "visible3", "visible2", "visible1", "visible0"]);
    expect(second.isDone).toBe(true);
  });

  test("inbox reports isDone when only hidden rows follow, and a full scan of hidden rows moves the cursor on", async () => {
    const { t, alice, bob, carol } = await world();
    await insertMessage(t, alice, bob, "old");
    for (let i = 0; i < 80; i++) {
      vi.advanceTimersByTime(1000);
      await insertMessage(t, carol, bob, `hidden${i}`);
    }
    for (let i = 0; i < 25; i++) {
      vi.advanceTimersByTime(1000);
      await insertMessage(t, alice, bob, `new${i}`);
    }
    await block(t, carol, bob);
    const b = await as(t, bob);
    const first = await b.query(api.mail.inbox, { cursor: null });
    expect(first.page).toHaveLength(25);
    expect(first.isDone).toBe(false);
    // 75 hidden rows in a row: an empty page that is not done.
    const second = await b.query(api.mail.inbox, { cursor: first.continueCursor });
    expect(second).toMatchObject({ page: [], isDone: false });
    const third = await b.query(api.mail.inbox, { cursor: second.continueCursor });
    expect(third.page.map((m) => m.subject)).toEqual(["old"]);
    expect(third.isDone).toBe(true);
    expect(await b.query(api.mail.inbox, { cursor: "not a cursor" })).toEqual({ page: [], isDone: true, continueCursor: "" });
  });

  test("a full page followed only by hidden rows is done", async () => {
    const { t, alice, bob, carol } = await world();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      await insertMessage(t, carol, bob, `hidden${i}`);
    }
    for (let i = 0; i < 25; i++) {
      vi.advanceTimersByTime(1000);
      await insertMessage(t, alice, bob, `new${i}`);
    }
    await t.run((ctx) => ctx.db.patch(carol, { banned: true }));
    const page = await (await as(t, bob)).query(api.mail.inbox, { cursor: null });
    expect(page.page).toHaveLength(25);
    expect(page.isDone).toBe(true);
  });

  test("unreadCount counts unread, undeleted mail and caps at 100", async () => {
    const { t, alice, bob, carol } = await world();
    const b = await as(t, bob);
    expect(await t.query(api.mail.unreadCount, {})).toBe(0);
    expect(await b.query(api.mail.unreadCount, {})).toBe(0);
    const ids: Id<"messages">[] = [];
    for (let i = 0; i < 3; i++) ids.push(await insertMessage(t, alice, bob, `m${i}`));
    expect(await b.query(api.mail.unreadCount, {})).toBe(3);
    await b.mutation(api.mail.markRead, { id: ids[0] });
    await b.mutation(api.mail.remove, { id: ids[1] });
    expect(await b.query(api.mail.unreadCount, {})).toBe(1);
    for (let i = 0; i < 120; i++) await insertMessage(t, carol, bob, `bulk${i}`);
    expect(await b.query(api.mail.unreadCount, {})).toBe(100);
  });
});

describe("admin access to mail", () => {
  test("the mail module exposes only the member functions", () => {
    expect(Object.keys(mailModule).sort()).toEqual(
      ["canMessage", "get", "inbox", "markRead", "remove", "send", "sent", "setMailFrom", "unreadCount"].sort(),
    );
  });
});
