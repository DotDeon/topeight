import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("MP3 only, up to 5 MB, 10 tracks max")).toBeVisible();
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
  const frame = page.frameLocator("iframe[data-openspace-profile]");
  await expect(frame.locator("marquee")).toHaveText("hi", { timeout: 15_000 });
});
