import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Both tests change fixture state (a friendship, a block) and put it back
 * through the same fixture mutations global-setup uses, so a re-run starts
 * from the same place.
 */
function reseed(fn: "seedCommenterFriendship" | "seedEditorBlock") {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  // Never throws: this runs in finally blocks, and a reseed failure must not mask the test's own error.
  try {
    execFileSync("npx", ["convex", "run", ...envFile, `testing:${fn}`], { stdio: "inherit" });
  } catch (e) {
    console.error(`reseed ${fn} failed`, e);
  }
}

async function login(page: Page, email: string, password: string | undefined, envName: string) {
  if (!password) throw new Error(`${envName} is set by e2e/global-setup.ts`);
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

test("a friend removes a friend from the trusted strip", async ({ page }) => {
  try {
    await login(page, "e2e-commenter@fixture.invalid", process.env.E2E_COMMENTER_PASSWORD, "E2E_COMMENTER_PASSWORD");
    await page.goto("/sandboxtest");
    const strip = page.locator("[data-openspace-strip]");
    const remove = strip.getByRole("button", { name: "Remove from Friends" });
    await expect(remove).toBeVisible({ timeout: 15_000 });
    await expect(strip.getByRole("button", { name: "Add to Friends" })).toHaveCount(0);
    await remove.click();

    const dialog = page.locator("dialog[data-openspace-confirm]");
    await expect(dialog).toContainText("Remove Sandbox Test from your friends?");
    const confirm = dialog.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByRole("status")).toHaveText("Removed from your friends");
    await dialog.getByRole("button", { name: "Close" }).click();

    await expect(strip.getByRole("button", { name: "Add to Friends" })).toBeVisible();
    await expect(strip.getByRole("button", { name: "Remove from Friends" })).toHaveCount(0);
  } finally {
    reseed("seedCommenterFriendship");
  }
});

test("a signed-in user sees no friend actions on their own profile", async ({ page }) => {
  await login(page, "e2e-commenter@fixture.invalid", process.env.E2E_COMMENTER_PASSWORD, "E2E_COMMENTER_PASSWORD");
  await page.goto("/e2ecommenter");
  const strip = page.locator("[data-openspace-strip]");
  await expect(strip.getByRole("button", { name: "Add Comment" })).toBeVisible();
  // Friend and block slots fill in once the relationship loads, so a missing button needs a loaded signal.
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible();
  await expect.poll(() => strip.getByRole("button").count()).toBe(2);
  await expect(strip.getByRole("button", { name: "Add to Friends" })).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Block" })).toHaveCount(0);
});

test("unblocking from Edit Profile empties the blocked list", async ({ page }) => {
  try {
    await login(page, "e2e-editor@fixture.invalid", process.env.E2E_EDITOR_PASSWORD, "E2E_EDITOR_PASSWORD");
    await page.goto("/edit");
    await expect(page.getByRole("heading", { name: "Friends and blocking" })).toBeVisible({ timeout: 20_000 });
    const blocked = page.getByRole("group", { name: "Blocked" });
    await expect(blocked).toContainText("Sandbox Fan");
    await expect(page.getByRole("group", { name: "Friends" })).toContainText("No friends yet");
    await blocked.getByRole("button", { name: "Unblock" }).click();
    await expect(blocked).toContainText("You haven't blocked anyone");
  } finally {
    reseed("seedEditorBlock");
  }
});
