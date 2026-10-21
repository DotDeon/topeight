import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const EMAIL = "e2e-editor@fixture.invalid";

test("signed-out visitors are sent to /login", async ({ page }) => {
  await page.goto("/edit");
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
});

test("an artist pastes custom HTML, saves, and the profile frame shows it", async ({ page }) => {
  const PASSWORD = process.env.E2E_EDITOR_PASSWORD;
  if (!PASSWORD) throw new Error("E2E_EDITOR_PASSWORD is set by e2e/global-setup.ts");

  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(EMAIL);
  await page.getByLabel("Password:").fill(PASSWORD);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/edit");
  await expect(page.getByRole("heading", { name: "Custom Code" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Artist Pro is coming soon. $5 a month.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go Pro (coming soon)" })).toBeDisabled();
  await expect(page.getByText("MP3 only, up to 5 MB, 5 tracks max")).toBeVisible();
  await expect(page.getByText("No upcoming shows.")).toBeVisible();
  await expect(page.getByText("No tracks yet.")).toBeVisible();
  await expect(page.getByText("Add some friends first")).toBeVisible();
  await page.screenshot({ path: process.env.E2E_EDIT_SCREENSHOT ?? "test-results/task-11-edit.png", fullPage: true });

  await page.getByLabel("HTML").fill("<marquee>hi</marquee>");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.frameLocator("iframe[title='Profile preview']").locator("marquee")).toHaveText("hi");

  const code = page.getByRole("form", { name: "Custom code" });
  await code.getByRole("button", { name: "Save Code" }).click();
  await expect(code.getByRole("status")).toHaveText("Saved");

  await page.goto("/e2eeditor");
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  await expect(frame.locator("marquee")).toHaveText("hi", { timeout: 15_000 });
});

// The song tests below give the editor a track and change its sharing, so they run after
// the tests above (which expect no tracks) and never in parallel with them.
test.describe.configure({ mode: "serial" });

function resetEditor(editor: "plain" | "withTrack") {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetProfileSongFixture", JSON.stringify({ editor })], {
    stdio: "inherit",
  });
}

async function logInEditor(page: Page, email = EMAIL, password = process.env.E2E_EDITOR_PASSWORD) {
  const PASSWORD = password;
  if (!PASSWORD) throw new Error("Fixture passwords are set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(PASSWORD);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

test.describe("profile songs for artists", () => {
  test.afterAll(() => resetEditor("plain"));

  test("an artist's own page has no pick links, but their Report links stay", async ({ page }) => {
    resetEditor("withTrack");
    await logInEditor(page);
    await page.goto("/e2eeditor");
    const frame = page.frameLocator("iframe[data-topeight-profile]");
    // The track really shows (so the missing link is not just a missing player).
    await expect(frame.locator(".player-tracks li [data-topeight-report-track]")).toHaveCount(1, { timeout: 30_000 });
    await expect(frame.locator("[data-topeight-pick-track]")).toHaveCount(0);

    // The same page for someone else does offer the link.
    const other = await page.context().browser()!.newPage();
    await other.goto(`http://localhost:${process.env.PORT ?? 3000}/e2eeditor`);
    await expect(
      other.frameLocator("iframe[data-topeight-profile]").locator("[data-topeight-pick-track]"),
    ).toHaveCount(1, { timeout: 30_000 });
    await other.close();
  });

  test("an artist turns sharing off and the picker's player disappears", async ({ page, browser }) => {
    resetEditor("withTrack");

    // The admin fixture (a fan) picks the editor's track.
    const picker = await (await browser.newContext()).newPage();
    await logInEditor(picker, "e2e-admin@fixture.invalid", process.env.E2E_ADMIN_PASSWORD);
    await picker.goto("/e2eeditor");
    await picker
      .frameLocator("iframe[data-topeight-profile]")
      .locator("[data-topeight-pick-track]")
      .click({ timeout: 30_000 });
    const dialog = picker.locator("dialog[data-topeight-confirm]");
    await expect(dialog).toContainText('Make "Editor Song" by E2E Editor your profile song?');
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Your profile song is set", { timeout: 15_000 });
    await picker.goto("/e2eadmin");
    const pickerFrame = picker.frameLocator("iframe[data-topeight-profile]");
    await expect(pickerFrame.locator(".player-song")).toContainText("Editor Song by E2E Editor", { timeout: 30_000 });

    // The artist sees one profile using their songs, then turns sharing off.
    await logInEditor(page);
    await page.goto("/edit");
    const toggle = page.getByLabel("Let people use my songs as profile songs");
    await expect(toggle).toBeChecked({ timeout: 20_000 });
    await expect(page.locator("[data-song-usage]")).toHaveText("Your songs are on 1 profile");
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator("[data-song-usage]")).toHaveText("Your songs are on 0 profiles");

    await picker.goto("/e2eadmin");
    await expect(pickerFrame.locator("body")).toContainText("E2E Admin", { timeout: 30_000 });
    await expect(pickerFrame.locator(".player-song")).toHaveCount(0);
    // And the artist's own track no longer offers the pick link to others.
    await picker.goto("/e2eeditor");
    await expect(pickerFrame.locator(".player-tracks li [data-topeight-report-track]")).toHaveCount(1, { timeout: 30_000 });
    await expect(pickerFrame.locator("[data-topeight-pick-track]")).toHaveCount(0);
  });
});
