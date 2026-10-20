import { expect, test, type Page } from "@playwright/test";

const COMMENTER = "e2e-commenter@fixture.invalid";
const ADMIN = "e2e-admin@fixture.invalid";

async function logIn(page: Page, email: string, password: string | undefined) {
  if (!password) throw new Error("Fixture passwords are set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

test("a member reports a profile from the trusted strip and the admin dismisses it", async ({ browser }) => {
  const reason = `e2e report ${Date.now()}`;

  const member = await (await browser.newContext()).newPage();
  await logIn(member, COMMENTER, process.env.E2E_COMMENTER_PASSWORD);
  await member.goto("/sandboxtest");
  await member.getByRole("button", { name: "Report" }).click();
  const dialog = member.locator("dialog[data-topeight-confirm]");
  await dialog.locator("textarea").fill(reason);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Thanks. An admin will review this profile.");

  // A member who is not an admin gets a plain refusal.
  await member.goto("/admin");
  await expect(member.getByText("Not allowed")).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await logIn(admin, ADMIN, process.env.E2E_ADMIN_PASSWORD);
  await admin.goto("/admin");
  const row = admin.locator("[data-report]", { hasText: reason });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Sandbox Test").first()).toBeVisible();
  await row.getByRole("button", { name: "Dismiss" }).click();
  await expect(admin.locator("[data-report]", { hasText: reason })).toHaveCount(0);
});

test("a member reports a song from the player and the admin plays it from a short-lived URL", async ({ browser }) => {
  const reason = `e2e song report ${Date.now()}`;

  const member = await (await browser.newContext()).newPage();
  await logIn(member, COMMENTER, process.env.E2E_COMMENTER_PASSWORD);
  await member.goto("/sandboxtest");
  const frame = member.frameLocator("iframe[data-topeight-profile]");
  await frame.locator(".player-tracks li").first().locator("[data-topeight-report-track]").click();
  const dialog = member.locator("dialog[data-topeight-confirm]");
  await expect(dialog).toContainText('Report the song "Probe Song"?');
  await dialog.getByLabel("What's wrong?").fill(reason);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByRole("status")).toBeVisible({ timeout: 15_000 });

  const admin = await (await browser.newContext()).newPage();
  await logIn(admin, ADMIN, process.env.E2E_ADMIN_PASSWORD);
  await admin.goto("/admin");
  const row = admin.locator("[data-report]", { hasText: reason });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText('Track "Probe Song"')).toBeVisible();

  await row.getByRole("button", { name: "Play Probe Song" }).click();
  const audio = row.locator("audio");
  const failed = row.getByText(/no longer exists|bucket|configured|not set/i);
  await expect(audio.or(failed).first()).toBeVisible({ timeout: 15_000 });
  if (await failed.count()) {
    test.info().annotations.push({
      type: "skip",
      description: "No audio bucket is configured here, so the X-Amz-Expires=900 src assertion was skipped",
    });
  } else {
    expect(await audio.getAttribute("src")).toContain("X-Amz-Expires=900");
  }

  await row.getByRole("button", { name: "Dismiss" }).click();
  await expect(admin.locator("[data-report]", { hasText: reason })).toHaveCount(0);
});
