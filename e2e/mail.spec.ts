import { execFileSync } from "node:child_process";
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

/** Friends again, with no mail between them. Never throws: it also runs in finally. */
function reseed() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  try {
    execFileSync("npx", ["convex", "run", ...envFile, "testing:seedMailFixture"], { stdio: "inherit" });
  } catch (e) {
    console.error("reseed seedMailFixture failed", e);
  }
}

test("friends mail each other, reply, and delete from one side only", async ({ browser }) => {
  reseed();
  const subject = `hello ${Date.now()}`;
  const reply = `Re: ${subject}`;
  try {
    const commenter = await (await browser.newContext()).newPage();
    await logIn(commenter, COMMENTER, process.env.E2E_COMMENTER_PASSWORD);

    // Send Message on the trusted strip goes straight to compose, no dialog.
    await commenter.goto("/e2eadmin");
    await commenter.locator("[data-topeight-strip]").getByRole("button", { name: "Send Message" }).click();
    await expect(commenter).toHaveURL(/\/mail\/compose\?to=e2eadmin$/);
    await expect(commenter.locator("dialog[data-topeight-confirm][open]")).toHaveCount(0);
    await expect(commenter.getByLabel("To:")).toHaveValue("e2eadmin");
    await expect(commenter.locator("[data-compose-refusal]")).toHaveCount(0);
    await commenter.getByLabel("Subject:").fill(subject);
    await commenter.getByLabel("Message:").fill("first line\nsecond line");
    await commenter.getByRole("button", { name: "Send", exact: true }).click();
    await expect(commenter).toHaveURL(/\/mail\/sent$/);
    await expect(commenter.getByRole("link", { name: subject })).toBeVisible();

    // The recipient sees the blinking link and an unread (bold) row.
    const admin = await (await browser.newContext()).newPage();
    await logIn(admin, ADMIN, process.env.E2E_ADMIN_PASSWORD);
    const flag = admin.getByRole("link", { name: "New Messages!" });
    await expect(flag).toBeVisible({ timeout: 15_000 });
    await flag.click();
    await expect(admin).toHaveURL(/\/mail$/);
    const row = admin.locator("[data-mail-row]", { hasText: subject });
    await expect(row).toHaveAttribute("data-unread", "true");
    await row.getByRole("link", { name: subject }).click();
    await expect(admin.locator("[data-mail-body]")).toContainText("second line");
    await expect(admin.getByRole("link", { name: "New Messages!" })).toHaveCount(0);

    // Reply: subject prefixed once, original quoted under a line of dashes.
    await admin.getByRole("link", { name: "Reply" }).click();
    await expect(admin.getByLabel("Subject:")).toHaveValue(reply);
    await expect(admin.getByLabel("Message:")).toHaveValue(/\n-+\n> first line\n> second line$/);
    await admin.getByLabel("Message:").fill("thanks\n\n--------------------\n> first line");
    await admin.getByRole("button", { name: "Send", exact: true }).click();
    await expect(admin).toHaveURL(/\/mail\/sent$/);
    await expect(admin.getByRole("link", { name: reply })).toBeVisible();

    // The original sender gets the reply in the inbox, and the original is still in Sent.
    await commenter.goto("/mail");
    const back = commenter.locator("[data-mail-row]", { hasText: reply });
    await expect(back).toBeVisible({ timeout: 15_000 });
    await expect(back).toHaveAttribute("data-unread", "true");
    await commenter.goto("/mail/sent");
    await expect(commenter.getByRole("link", { name: subject, exact: true })).toBeVisible();

    // Deleting the reply removes it for the commenter only.
    await commenter.goto("/mail");
    await commenter.getByRole("link", { name: reply }).click();
    commenter.once("dialog", (d) => void d.accept());
    await commenter.getByRole("button", { name: "Delete" }).click();
    await expect(commenter).toHaveURL(/\/mail$/);
    await expect(commenter.getByText("Your inbox is empty.")).toBeVisible();
    await admin.goto("/mail/sent");
    await expect(admin.getByRole("link", { name: reply })).toBeVisible();
  } finally {
    reseed();
  }
});
