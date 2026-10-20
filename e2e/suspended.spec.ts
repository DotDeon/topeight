import { expect, test } from "@playwright/test";

const BANNED = "e2e-banned@fixture.invalid";

// e2ebanned is a dedicated fixture (convex/testing.ts seedBannedLoginFixture), never a shared one.
test("a suspended member sees the suspension notice on the home page and the editor", async ({ page }) => {
  const password = process.env.E2E_BANNED_PASSWORD;
  if (!password) throw new Error("Fixture passwords are set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(BANNED);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/");
  await expect(page.getByText("Your account has been suspended")).toBeVisible({ timeout: 15_000 });
  await page.goto("/edit");
  await expect(page.getByText("Your account has been suspended")).toBeVisible({ timeout: 15_000 });
});
