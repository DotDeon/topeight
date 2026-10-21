import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

const EMAIL = "e2e-editor@fixture.invalid";

function reset() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetOnlineFixture"], { stdio: "inherit" });
}

test.beforeAll(reset);
test.afterAll(reset);

test("a signed-in member shows Online Now! on their profile until they turn it off", async ({ page }) => {
  const PASSWORD = process.env.E2E_EDITOR_PASSWORD;
  if (!PASSWORD) throw new Error("E2E_EDITOR_PASSWORD is set by e2e/global-setup.ts");

  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(EMAIL);
  await page.getByLabel("Password:").fill(PASSWORD);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/e2eeditor");
  const badge = page.frameLocator("iframe[data-topeight-profile]").locator(".online-now");
  await expect(badge).toContainText("Online Now!", { timeout: 20_000 });

  await page.goto("/edit");
  const box = page.getByRole("checkbox", { name: "Show when I'm online" });
  await expect(box).toBeChecked({ timeout: 20_000 });
  await box.click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(box).not.toBeChecked();

  await page.goto("/e2eeditor");
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  await expect(frame.locator(".name")).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator(".online-now")).toHaveCount(0);
});
