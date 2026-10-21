import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const EMAIL = "e2e-editor@fixture.invalid";

test.beforeAll(() => {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetMoodFixture"], { stdio: "inherit" });
});

test("a member sets a mood from the homepage box and sees it on the profile frame", async ({ page }) => {
  const PASSWORD = process.env.E2E_EDITOR_PASSWORD;
  if (!PASSWORD) throw new Error("E2E_EDITOR_PASSWORD is set by e2e/global-setup.ts");

  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(EMAIL);
  await page.getByLabel("Password:").fill(PASSWORD);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });

  const box = page.getByRole("form", { name: "Update your mood" });
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.getByLabel("Mood icon").selectOption("excited");
  await box.getByLabel("Mood text").fill("<i>so ready</i>");
  await box.getByRole("button", { name: "Update" }).click();
  await expect(box.getByRole("status")).toHaveText("Mood updated");

  await page.goto("/e2eeditor");
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  const mood = frame.locator(".mood");
  await expect(mood).toContainText("Mood:", { timeout: 15_000 });
  await expect(mood).toContainText("<i>so ready</i>");
  await expect(mood.locator("svg[data-mood-icon='excited']")).toBeVisible();
});
