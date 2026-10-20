import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const COMMENTER = "e2e-commenter@fixture.invalid";
const ADMIN = "e2e-admin@fixture.invalid";

async function logIn(page: Page, email: string, password: string | undefined) {
  if (!password) throw new Error("Fixture passwords are set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

/** Clears the e2e accounts' groups and group rate limits, and sets their account ages (admin old, commenter new). */
function resetGroups() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetGroupsFixture"], { stdio: "inherit" });
}

test("an aged owner runs a group: join, topic, reply, remove a post, ban, unban", async ({ browser }) => {
  resetGroups();
  const stamp = Date.now();
  const name = `E2E Club ${stamp}`;

  const owner = await (await browser.newContext()).newPage();
  await logIn(owner, ADMIN, process.env.E2E_ADMIN_PASSWORD);
  const member = await (await browser.newContext()).newPage();
  await logIn(member, COMMENTER, process.env.E2E_COMMENTER_PASSWORD);

  // A week-old rule: the new commenter sees the server's error inline.
  await member.goto("/groups/new");
  await member.getByLabel("Name:").fill(`Too young ${stamp}`);
  await member.getByRole("button", { name: "Create group" }).click();
  await expect(member.locator("form [role=alert]")).toHaveText("Your account must be a week old to create a group");

  // The owner creates a group and it is listed.
  await owner.goto("/groups/new");
  await owner.getByLabel("Name:").fill(name);
  await owner.getByLabel("Description:").fill("A club for tests");
  await owner.getByRole("button", { name: "Create group" }).click();
  await expect(owner).toHaveURL(/\/groups\/e2e-club-\d+$/, { timeout: 20_000 });
  const groupUrl = owner.url();
  await expect(owner.getByRole("heading", { name })).toBeVisible();
  await expect(owner.locator("[data-member-count]")).toHaveText("1");
  await owner.goto("/groups");
  await expect(owner.locator("[data-group-item]", { hasText: name })).toBeVisible();

  // The commenter joins, then starts a topic.
  await member.goto(groupUrl);
  await expect(member.getByRole("button", { name: "Leave Group" })).toHaveCount(0);
  await member.getByRole("button", { name: "Join Group" }).click();
  await expect(member.locator("[data-member-count]")).toHaveText("2");
  await member.getByRole("button", { name: "New topic" }).click();
  await member.getByLabel("Topic:").fill("Hello board");
  await member.getByLabel("Message:").fill("First post <b>not html</b>");
  await member.getByRole("button", { name: "Post topic" }).click();
  await expect(member).toHaveURL(/\/t\/[^/]+$/, { timeout: 20_000 });
  const topicUrl = member.url();
  await expect(member.getByText("First post <b>not html</b>")).toBeVisible();

  // The owner sees the board row and replies.
  await owner.goto(groupUrl);
  const row = owner.locator("[data-topic-row]", { hasText: "Hello board" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Hello board" }).click();
  await owner.getByLabel("Reply:").fill("Owner reply");
  await owner.getByRole("button", { name: "Post reply" }).click();
  await expect(owner.locator("[data-post]", { hasText: "Owner reply" })).toBeVisible();
  await expect(member.locator("[data-post]", { hasText: "Owner reply" })).toBeVisible({ timeout: 15_000 });
  await expect(member.getByRole("button", { name: "Remove" })).toHaveCount(0);

  // The owner removes the reply.
  await owner.locator("[data-post]", { hasText: "Owner reply" }).getByRole("button", { name: "Remove" }).click();
  await expect(owner.locator("[data-post]", { hasText: "Owner reply" })).toHaveCount(0);
  await expect(member.locator("[data-post]", { hasText: "Owner reply" })).toHaveCount(0, { timeout: 15_000 });

  // The owner bans the member from settings. They can't post any more.
  await owner.goto(`${groupUrl}/settings`);
  await owner.getByLabel("Ban a user by username:").fill("e2ecommenter");
  await owner.getByRole("button", { name: "Ban", exact: true }).click();
  await expect(owner.getByText("Banned e2ecommenter")).toBeVisible();
  await expect(owner.locator("[data-banned-row]", { hasText: "e2ecommenter" })).toBeVisible();
  await member.goto(topicUrl);
  await expect(member.getByLabel("Reply:")).toHaveCount(0);
  await expect(member.getByText("Join the group to reply")).toBeVisible();
  await member.goto(groupUrl);
  await expect(member.getByText("You're banned from this group")).toBeVisible();
  await expect(member.getByRole("button", { name: "Join Group" })).toHaveCount(0);

  // Unban lets them join again.
  await owner.locator("[data-banned-row]", { hasText: "e2ecommenter" }).getByRole("button", { name: "Unban" }).click();
  await expect(owner.locator("[data-banned-row]")).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Join Group" })).toBeVisible({ timeout: 15_000 });

  // Signed-out visitors can read the group.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(groupUrl);
  await expect(guest.getByRole("heading", { name })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Log in to join this group" })).toBeVisible();

  // A non-owner can't open the settings.
  await member.goto(`${groupUrl}/settings`);
  await expect(member.getByText("You can't change this group")).toBeVisible();
});
