import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

const port = process.env.PORT ?? "3000";
const USERCONTENT = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN ?? `http://127.0.0.1:${port}`;
const NOTE = "This profile is set to private. Add E2E Private as a friend to see more.";
// Only this spec uses these two fans (convex/testing.ts resetPrivateFixture).
const PASSWORD = randomBytes(18).toString("base64url");

function reset() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  // Two calls, one password hash each (see convex/testing.ts).
  for (const fn of ["testing:seedPrivatePalFixture", "testing:resetPrivateFixture"]) {
    execFileSync("npx", ["convex", "run", ...envFile, fn, JSON.stringify({ password: PASSWORD })], { stdio: "inherit" });
  }
}

test.beforeAll(reset);
test.afterAll(reset);

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

async function asUser(browser: Browser, email?: string, password = PASSWORD): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  if (email) await login(page, email, password);
  return page;
}

async function setPrivate(page: Page, on: boolean) {
  await page.goto("/edit");
  const box = page.getByRole("checkbox", { name: "Private profile: only my friends see my full page" });
  await expect(box).toBeVisible({ timeout: 20_000 });
  await expect(box).toBeChecked({ checked: !on });
  await box.click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(box).toBeChecked({ checked: on });
}

async function expectPrivateCard(page: Page) {
  await page.goto("/e2eprivate");
  const card = page.locator("[data-topeight-private]");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("E2E Private");
  await expect(card).toContainText("Pretoria, South Africa");
  await expect(card).toContainText(NOTE);
  await expect(card).toContainText("Mood:");
  await expect(card).toContainText("keeping it private");
  await expect(card.locator("svg[data-mood-icon='happy']")).toBeVisible();
  await expect(card).toContainText("Online Now!");
  await expect(page.locator("iframe[data-topeight-profile]")).toHaveCount(0);
  const strip = page.locator("[data-topeight-strip]");
  await expect(strip.getByRole("button", { name: "Add to Friends" })).toBeVisible({ timeout: 15_000 });
  await expect(strip.getByRole("button", { name: "Send Message" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Report" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Add Comment" })).toHaveCount(0);

  for (const sub of ["comments", "friends", "blog"]) {
    await page.goto(`/e2eprivate/${sub}`);
    await expect(page.getByText(NOTE)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("has 0 friends")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Add a comment" })).toHaveCount(0);
    await expect(page.getByText("Log in to leave a comment")).toHaveCount(0);
  }
}

test("a private fan's page shows only the card to strangers, and everything to friends", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const editorPassword = process.env.E2E_EDITOR_PASSWORD;
  if (!editorPassword) throw new Error("E2E_EDITOR_PASSWORD is set by e2e/global-setup.ts");

  const owner = await asUser(browser, "e2e-private@fixture.invalid");
  await setPrivate(owner, true);

  // Signed out, then a signed-in member who isn't a friend.
  await expectPrivateCard(await asUser(browser));
  await expectPrivateCard(await asUser(browser, "e2e-editor@fixture.invalid", editorPassword));

  // The frame address refuses a private profile without a pass.
  expect((await request.get(`${USERCONTENT}/e2eprivate`)).status()).toBe(404);
  expect((await request.get(`${USERCONTENT}/e2eprivate?format=tracks`)).status()).toBe(404);
  expect((await request.get(`${USERCONTENT}/e2eprivate?pass=1.${"A".repeat(43)}`)).status()).toBe(404);

  // A friend gets the full frame, through a pass, and the sub pages.
  const pal = await asUser(browser, "e2e-pal@fixture.invalid");
  await pal.goto("/e2eprivate");
  const iframe = pal.locator("iframe[data-topeight-profile]");
  await expect(iframe).toHaveAttribute("src", new RegExp(`^${USERCONTENT.replace(/[.]/g, "\\.")}/e2eprivate\\?pass=`), {
    timeout: 20_000,
  });
  await expect(pal.frameLocator("iframe[data-topeight-profile]").locator(".name")).toContainText("E2E Private", {
    timeout: 20_000,
  });
  await expect(pal.locator("[data-topeight-private]")).toHaveCount(0);
  await expect(pal.locator("[data-topeight-strip]").getByRole("button", { name: "Add Comment" })).toBeVisible();
  await pal.goto("/e2eprivate/friends");
  await expect(pal.locator("[data-friends-total]")).toHaveText("1", { timeout: 20_000 });
  await pal.goto("/e2eprivate/comments");
  await expect(pal.getByRole("textbox", { name: "Add a comment" })).toBeVisible({ timeout: 20_000 });
  await expect(pal.getByText(NOTE)).toHaveCount(0);

  // The owner sees their own page in full.
  await owner.goto("/e2eprivate");
  await expect(owner.frameLocator("iframe[data-topeight-profile]").locator(".name")).toContainText("E2E Private", {
    timeout: 20_000,
  });

  // Turning it off gives strangers the frame again, with no pass.
  await setPrivate(owner, false);
  const stranger = await asUser(browser);
  await stranger.goto("/e2eprivate");
  await expect(stranger.locator("iframe[data-topeight-profile]")).toHaveAttribute("src", `${USERCONTENT}/e2eprivate`, {
    timeout: 20_000,
  });
  await expect(stranger.frameLocator("iframe[data-topeight-profile]").locator(".name")).toContainText("E2E Private");
  await expect(stranger.locator("[data-topeight-private]")).toHaveCount(0);
  expect((await request.get(`${USERCONTENT}/e2eprivate`)).status()).toBe(200);
});
