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

/** Clears the e2e accounts' events and their event rate limits, so reruns stay under 5 a day. */
function resetEvents() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "run", ...envFile, "testing:resetEventsFixture"], { stdio: "inherit" });
}

test("a host posts an event, a member RSVPs, the city filter narrows the list, the host cancels", async ({ browser }) => {
  resetEvents();
  const stamp = Date.now();
  const title = `e2e gig ${stamp}`;
  const city = `E2ECity${stamp}`;
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const host = await (await browser.newContext()).newPage();
  await logIn(host, ADMIN, process.env.E2E_ADMIN_PASSWORD);

  // The timezone select starts on the browser's zone.
  await host.goto("/events/new");
  const browserZone = await host.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(host.getByLabel("Timezone:")).toHaveValue(browserZone);
  expect(await host.getByLabel("Timezone:").locator("option").count()).toBeGreaterThan(100);
  await host.getByLabel("Title:").fill(title);
  await host.getByLabel("Date:").fill(soon);
  await host.getByLabel("Time", { exact: true }).fill("20:00");
  await host.getByLabel("Venue:").fill("The Bassline");
  await host.getByLabel("City:").fill(city);
  await host.getByLabel("Description:").fill("Bring friends");
  await host.getByRole("button", { name: "Post event" }).click();
  await expect(host).toHaveURL(/\/events\/(?!new$)[^/]+$/, { timeout: 20_000 });
  const eventUrl = host.url();
  await expect(host.getByRole("heading", { name: title })).toBeVisible();
  await expect(host.getByText("0 going, 0 maybe")).toBeVisible();
  await expect(host.getByText("8:00 PM")).toBeVisible();

  // It is listed, and the city filter narrows the list.
  await host.goto("/events");
  await expect(host.locator("[data-event-item]", { hasText: title })).toBeVisible();
  await host.getByLabel("City:").fill(city.toLowerCase());
  await expect(host.locator("[data-event-item]")).toHaveCount(1);
  await expect(host.locator("[data-event-item]", { hasText: title })).toBeVisible();
  await host.getByLabel("City:").fill(`nowhere${stamp}`);
  await expect(host.getByText("No upcoming events in that city.")).toBeVisible();

  // Signed-out visitors can read it but are asked to log in.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(eventUrl);
  await expect(guest.getByRole("heading", { name: title })).toBeVisible();
  await expect(guest.getByRole("link", { name: "Log in to RSVP" })).toBeVisible();

  // Another member goes, shows in the grid, and can toggle off and on.
  const member = await (await browser.newContext()).newPage();
  await logIn(member, COMMENTER, process.env.E2E_COMMENTER_PASSWORD);
  await member.goto(eventUrl);
  await expect(member.getByRole("button", { name: "Cancel event" })).toHaveCount(0);
  const going = member.getByRole("button", { name: "I'm going" });
  await going.click();
  await expect(member.getByText("1 going, 0 maybe")).toBeVisible();
  await expect(going).toHaveAttribute("aria-pressed", "true");
  await expect(member.getByRole("link", { name: /E2E Commenter/ })).toBeVisible();
  await going.click();
  await expect(member.getByText("0 going, 0 maybe")).toBeVisible();
  await member.getByRole("button", { name: "Maybe" }).click();
  await expect(member.getByText("0 going, 1 maybe")).toBeVisible();
  await going.click();
  await expect(member.getByText("1 going, 0 maybe")).toBeVisible();

  // The host sees the member in the grid, then cancels.
  await host.goto(eventUrl);
  await expect(host.getByRole("link", { name: /E2E Commenter/ })).toBeVisible();
  host.once("dialog", (d) => void d.accept());
  await host.getByRole("button", { name: "Cancel event" }).click();
  await expect(host.locator("[data-event-cancelled]")).toHaveText("Cancelled");
  await expect(host.getByRole("button", { name: "I'm going" })).toHaveCount(0);

  // The member sees it cancelled with no RSVP buttons, and can still clear their answer.
  await expect(member.locator("[data-event-cancelled]")).toHaveText("Cancelled", { timeout: 15_000 });
  await expect(member.getByRole("button", { name: "I'm going" })).toHaveCount(0);
  await member.getByRole("button", { name: "Clear my RSVP" }).click();
  await expect(member.getByText("0 going, 0 maybe")).toBeVisible();
  await expect(member.getByRole("button", { name: "Clear my RSVP" })).toHaveCount(0);

  // The list still shows it, flagged.
  await host.goto("/events");
  await expect(host.locator("[data-event-item]", { hasText: title }).getByText("Cancelled")).toBeVisible();
});
