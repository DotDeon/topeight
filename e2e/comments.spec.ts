import { expect, test } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
const USERCONTENT = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN ?? `http://127.0.0.1:${port}`;
const EMAIL = "e2e-commenter@fixture.invalid";

test("a signed-in user comments from the trusted strip, then deletes it on the comments page", async ({ page }) => {
  const PASSWORD = process.env.E2E_COMMENTER_PASSWORD;
  if (!PASSWORD) throw new Error("E2E_COMMENTER_PASSWORD is set by e2e/global-setup.ts");
  const body = `e2e hello ${Date.now()}`;

  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(EMAIL);
  await page.getByLabel("Password:").fill(PASSWORD);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/sandboxtest");
  await page.getByRole("button", { name: "Add Comment" }).click();
  const dialog = page.locator("dialog[data-openspace-confirm]");
  const confirm = dialog.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeDisabled();
  await dialog.locator("textarea").fill(body);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByRole("status")).toHaveText("Comment posted");
  await dialog.getByRole("button", { name: "Close" }).click();

  // The iframe reloads and the new comment shows in the profile document.
  const frame = page.frameLocator("iframe[data-openspace-profile]");
  await expect(frame.getByText(body)).toBeVisible({ timeout: 15_000 });
  expect(page.frames().some((f) => f.url().startsWith(`${USERCONTENT}/sandboxtest`))).toBe(true);

  await page.goto("/sandboxtest/comments");
  const row = page.locator("[data-comment]", { hasText: body });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(body)).toHaveCount(0);
});
