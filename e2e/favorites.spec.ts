import { expect, test } from "@playwright/test";

test("signed out visitors are asked to log in to see Favorites", async ({ page }) => {
  await page.goto("/favorites");
  await expect(page.getByText("Log in to see your Favorites")).toBeVisible();
});

test("favorite a profile from its Contacting box, see it, remove it", async ({ page }) => {
  const password = process.env.E2E_COMMENTER_PASSWORD;
  if (!password) throw new Error("E2E_COMMENTER_PASSWORD is set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill("e2e-commenter@fixture.invalid");
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/sandboxtest");
  const dialog = page.locator("dialog[data-topeight-confirm]");
  const frame = page.frameLocator("iframe[data-topeight-profile]");
  await frame.getByRole("link", { name: "Add to Favorites" }).click();
  await expect(dialog).toContainText("Add Sandbox Test to your Favorites?");
  const confirm = dialog.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByRole("status")).toHaveText("Saved to Favorites");

  await page.goto("/favorites");
  const card = page.locator("[data-favorite]", { hasText: "Sandbox Test" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card).toHaveCount(0);
});
