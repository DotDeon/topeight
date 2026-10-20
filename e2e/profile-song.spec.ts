import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const FAN = "e2e-commenter@fixture.invalid";
const EDITOR = "e2e-editor@fixture.invalid";

function resetFixture(sandboxShares?: boolean) {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  const args = sandboxShares === undefined ? [] : [JSON.stringify({ sandboxShares })];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetProfileSongFixture", ...args], {
    stdio: "inherit",
  });
}

async function logIn(page: Page, email: string, password: string | undefined) {
  if (!password) throw new Error("Fixture passwords are set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

// The tests share one fan, one artist and their pick state, so they cannot run in parallel workers.
test.describe.configure({ mode: "serial" });
test.beforeEach(() => resetFixture());
test.afterAll(() => resetFixture());

test("a fan picks an artist's track, sees it on their frame, and loses it when sharing goes off", async ({ page }) => {
  await logIn(page, FAN, process.env.E2E_COMMENTER_PASSWORD);

  await page.goto("/sandboxtest");
  const artistFrame = page.frameLocator("iframe[data-topeight-profile]");
  const row = artistFrame.locator(".player-tracks li").first();
  await expect(row.locator("[data-topeight-report-track]")).toBeVisible({ timeout: 15_000 });
  await row.locator("[data-topeight-pick-track]").click();

  const dialog = page.locator("dialog[data-topeight-confirm]");
  await expect(dialog).toContainText('Make "Probe Song" by Sandbox Test your profile song?');
  await expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Your profile song is set", { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Close" }).click();

  // The fan's own profile frame shows it, with a Report link and no pick link.
  await page.goto("/e2ecommenter");
  const fanFrame = page.frameLocator("iframe[data-topeight-profile]");
  const song = fanFrame.locator(".player-song");
  await expect(song).toContainText("Probe Song by Sandbox Test", { timeout: 30_000 });
  await expect(song.locator("[data-topeight-report-track]")).toBeVisible();
  await expect(fanFrame.locator("[data-topeight-pick-track]")).toHaveCount(0);

  // Edit Profile shows it with Remove.
  await page.goto("/edit");
  const section = page.locator("[data-profile-song]");
  await expect(section).toContainText("Probe Song by Sandbox Test", { timeout: 20_000 });

  // Reporting it from the fan's profile names the artist's track.
  await page.goto("/e2ecommenter");
  await fanFrame.locator(".player-song [data-topeight-report-track]").click({ timeout: 15_000 });
  await expect(dialog).toContainText('Report the song "Probe Song"?');
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The artist turns sharing off. The fan's player disappears.
  resetFixture(false);
  await page.goto("/e2ecommenter");
  await expect(page.locator("iframe[data-topeight-profile]")).toBeVisible();
  await expect(fanFrame.locator("body")).toContainText("E2E Commenter", { timeout: 15_000 });
  await expect(fanFrame.locator(".player-song")).toHaveCount(0);
  await expect(fanFrame.locator("#topeight-player-ui")).toHaveCount(0);
});

test("a signed-out visitor is told to log in", async ({ page }) => {
  await page.goto("/sandboxtest");
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  await frame.locator("[data-topeight-pick-track]").first().click({ timeout: 15_000 });
  const dialog = page.locator("dialog[data-topeight-confirm]");
  await expect(dialog).toContainText('Make "Probe Song" by Sandbox Test your profile song?');
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toContainText("Log in to pick a profile song", { timeout: 15_000 });
});

test("an artist's own page has no pick links", async ({ page }) => {
  await logIn(page, EDITOR, process.env.E2E_EDITOR_PASSWORD);
  await page.goto("/e2eeditor");
  await expect(page.locator("iframe[data-topeight-profile]")).toBeVisible();
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  await expect(frame.locator("body")).toContainText("E2E Editor", { timeout: 15_000 });
  await expect(frame.locator("[data-topeight-pick-track]")).toHaveCount(0);
});

test("an artist sees the sharing switch and usage count on Edit Profile", async ({ page }) => {
  await logIn(page, EDITOR, process.env.E2E_EDITOR_PASSWORD);
  await page.goto("/edit");
  await expect(page.getByText("No profile song yet. Find a band you like and click Add to my profile.")).toBeVisible({
    timeout: 20_000,
  });
  const toggle = page.getByLabel("Let people use my songs as profile songs");
  await expect(toggle).toBeChecked();
  await expect(page.locator("[data-song-usage]")).toHaveText("Your songs are on 0 profiles");
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("[data-song-usage]")).toHaveText("Your songs are on 0 profiles");
});
