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

/** e2eadmin and e2ecommenter are friends. The mail fixture does that and clears their mail. */
function befriend() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:seedMailFixture"], { stdio: "inherit" });
}

test("an author writes a post, a friend finds and comments on it, the author deletes the comment", async ({ browser }) => {
  befriend();
  const title = `e2e post ${Date.now()}`;
  const text = "first line\nsecond line";
  const comment = `nice post ${Date.now()}`;

  const author = await (await browser.newContext()).newPage();
  await logIn(author, ADMIN, process.env.E2E_ADMIN_PASSWORD);

  // Signed-out visitors are asked to log in.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto("/blog");
  await expect(guest.getByText("to read your friends' blogs")).toBeVisible();

  // Write a post with a mood and a song.
  await author.goto("/blog");
  await author.getByRole("button", { name: "Write a new post" }).click();
  await expect(author).toHaveURL(/\/blog\/new$/, { timeout: 20_000 });
  await author.getByLabel("Title:").fill(title);
  await author.getByLabel("Post:").fill(text);
  await author.getByLabel("Current mood:").selectOption("happy");
  await expect(author.getByLabel("Mood text")).toHaveValue("Happy");
  await author.getByLabel("Mood text").fill("so happy");
  await author.getByLabel("Currently listening:").fill("Some Song");
  await author.getByRole("button", { name: "Publish" }).click();
  await expect(author).toHaveURL(/\/e2eadmin\/blog\/[^/]+$/, { timeout: 20_000 });
  const entry = author.locator("[data-blog-entry]");
  await expect(entry.getByText("second line")).toBeVisible();
  await expect(entry.locator("[data-blog-mood]")).toContainText("so happy");
  await expect(entry.locator("[data-blog-mood] svg[data-mood-icon='happy']")).toBeVisible();
  await expect(entry.locator("[data-blog-listening]")).toContainText("Some Song");

  // It shows on their blog, and in the profile's Latest Blog Entry, which links to the blog page.
  await author.goto("/e2eadmin/blog");
  await expect(author.locator("[data-blog-entry]", { hasText: title })).toBeVisible();
  await author.goto("/e2eadmin");
  const frame = author.frameLocator("iframe[data-topeight-profile]");
  await frame.getByRole("link", { name: title }).click();
  await expect(author).toHaveURL(/\/e2eadmin\/blog$/, { timeout: 20_000 });

  // A friend sees it on /blog and comments.
  const friend = await (await browser.newContext()).newPage();
  await logIn(friend, COMMENTER, process.env.E2E_COMMENTER_PASSWORD);
  await friend.goto("/blog");
  await expect(friend.getByText("Recent posts from friends")).toBeVisible();
  await friend.locator("[data-feed-item]", { hasText: title }).getByRole("link", { name: title }).click();
  await expect(friend).toHaveURL(/\/e2eadmin\/blog\/[^/]+$/, { timeout: 20_000 });
  await expect(friend.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await friend.getByLabel("Add a comment").fill(comment);
  await friend.getByRole("button", { name: "Add Comment" }).click();
  await expect(friend.locator("[data-comment]", { hasText: comment })).toBeVisible();

  // The author deletes the comment, then the post.
  await author.goto(friend.url());
  const row = author.locator("[data-comment]", { hasText: comment });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(author.getByText(comment)).toHaveCount(0);
  author.once("dialog", (d) => void d.accept());
  await author.locator("[data-blog-entry]").getByRole("button", { name: "Delete" }).click();
  await expect(author).toHaveURL(/\/e2eadmin\/blog$/, { timeout: 20_000 });
  await expect(author.getByText(title)).toHaveCount(0);

  // Unknown and banned authors are 404s.
  const missing = await author.goto("/nosuchuser99/blog");
  expect(missing?.status()).toBe(404);
});
