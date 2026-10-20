import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const FAN = "e2e-commenter@fixture.invalid";

function resetFixture() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetProfileSongFixture", "{}"], {
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

/** The fan picks Probe Song from sandboxtest through the parent dialog. */
async function pickProbeSong(page: Page) {
  await page.goto("/sandboxtest");
  const artistFrame = page.frameLocator("iframe[data-topeight-profile]");
  const row = artistFrame.locator(".player-tracks li").first();
  await expect(row.locator("[data-topeight-report-track]")).toBeVisible({ timeout: 30_000 });
  await row.locator("[data-topeight-pick-track]").click();

  const dialog = page.locator("dialog[data-topeight-confirm]");
  await expect(dialog).toContainText('Make "Probe Song" by Sandbox Test your profile song?');
  await expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Your profile song is set", { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Close" }).click();
}

// The tests share one fan, one artist and their pick state, so they cannot run in parallel workers.
test.describe.configure({ mode: "serial" });
test.beforeEach(() => resetFixture());
test.afterAll(() => resetFixture());

test("a fan picks an artist's track and sees it on their frame and in Edit Profile", async ({ page }) => {
  await logIn(page, FAN, process.env.E2E_COMMENTER_PASSWORD);
  await pickProbeSong(page);

  // The fan's own profile frame shows it, with a Report link and no pick link.
  await page.goto("/e2ecommenter");
  const fanFrame = page.frameLocator("iframe[data-topeight-profile]");
  const song = fanFrame.locator(".player-song");
  await expect(song).toContainText("Probe Song by Sandbox Test", { timeout: 30_000 });
  await expect(song.locator("[data-topeight-report-track]")).toBeVisible();
  await expect(fanFrame.locator("[data-topeight-pick-track]")).toHaveCount(0);

  // Asking to pick the profile song's own id opens no dialog: only this profile's own tracks can be picked.
  const songId = await song.locator(".player-track").getAttribute("data-track-id");
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().includes("/e2ecommenter"));
  await frame!.evaluate((id) => (window as unknown as { topeight: { pickSong(i: string): void } }).topeight.pickSong(id!), songId);
  await page.waitForTimeout(800);
  const dialog = page.locator("dialog[data-topeight-confirm]");
  await expect(dialog).toBeHidden();

  // Reporting it from the fan's profile names the artist's track.
  await song.locator("[data-topeight-report-track]").click();
  await expect(dialog).toContainText('Report the song "Probe Song"?');
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/edit");
  await expect(page.locator("[data-profile-song]")).toContainText("Probe Song by Sandbox Test", { timeout: 20_000 });
});

test("a fan removes their profile song and the frame drops it", async ({ page }) => {
  await logIn(page, FAN, process.env.E2E_COMMENTER_PASSWORD);
  await pickProbeSong(page);

  await page.goto("/edit");
  const section = page.locator("[data-profile-song]");
  await expect(section).toContainText("Probe Song by Sandbox Test", { timeout: 20_000 });
  await section.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.getByText("No profile song yet. Find a band you like and click Add to my profile."),
  ).toBeVisible();

  await page.goto("/e2ecommenter");
  const fanFrame = page.frameLocator("iframe[data-topeight-profile]");
  await expect(fanFrame.locator("body")).toContainText("E2E Commenter", { timeout: 30_000 });
  await expect(fanFrame.locator(".player-song")).toHaveCount(0);
  await expect(fanFrame.locator("#topeight-player-ui")).toHaveCount(0);
});

test("a signed-out visitor is told to log in", async ({ page }) => {
  await page.goto("/sandboxtest");
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  await frame.locator("[data-topeight-pick-track]").first().click({ timeout: 30_000 });
  const dialog = page.locator("dialog[data-topeight-confirm]");
  await expect(dialog).toContainText('Make "Probe Song" by Sandbox Test your profile song?');
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toContainText("Log in to pick a profile song", { timeout: 15_000 });
});
