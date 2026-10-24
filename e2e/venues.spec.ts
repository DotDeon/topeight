import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const VENUE = "e2e-venue@fixture.invalid";
const BAND = "e2e-band@fixture.invalid";

async function logIn(page: Page, email: string, password: string | undefined) {
  if (!password) throw new Error("Fixture passwords are set by e2e/global-setup.ts");
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill(email);
  await page.getByLabel("Password:").fill(password);
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByRole("link", { name: "Log Out" })).toBeVisible({ timeout: 20_000 });
}

/** Puts the venue and band back as global-setup left them: no link, no gigs. */
function reset() {
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync(
    "npx",
    [
      "convex",
      "run",
      ...envFile,
      "testing:seedVenueFixture",
      JSON.stringify({ venuePassword: process.env.E2E_VENUE_PASSWORD, bandPassword: process.env.E2E_BAND_PASSWORD }),
    ],
    { stdio: "inherit" },
  );
}

test("a venue adds a band to its roster, books it on a gig, and the band can leave the gig", async ({ browser }) => {
  reset();
  try {
    const title = `e2e venue gig ${Date.now()}`;
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const venue = await (await browser.newContext()).newPage();
    await logIn(venue, VENUE, process.env.E2E_VENUE_PASSWORD);
    await venue.goto("/e2eband");
    const ask = venue.locator("[data-topeight-strip]").getByRole("button", { name: "Add to our roster" });
    await expect(ask).toBeEnabled({ timeout: 15_000 });
    await ask.click();
    await expect(venue.locator("[data-topeight-strip]").getByRole("button", { name: "Request sent" })).toBeDisabled();

    const band = await (await browser.newContext()).newPage();
    await logIn(band, BAND, process.env.E2E_BAND_PASSWORD);
    const requests = band.locator("[data-topeight-link-requests]");
    await expect(requests).toContainText("E2E Venue wants you on their roster");
    await requests.getByRole("button", { name: "Accept" }).click();
    await expect(requests).toHaveCount(0);

    await venue.goto("/events/new");
    await venue.getByLabel("Title:").fill(title);
    await venue.getByLabel("Date:").fill(soon);
    await venue.getByLabel("Time", { exact: true }).fill("21:00");
    await expect(venue.getByText("E2E Venue, Cape Town")).toBeVisible();
    await venue.locator("[data-lineup-picker]").getByLabel("E2E Band").check();
    await venue.getByRole("button", { name: "Post event" }).click();
    await expect(venue.locator("[data-event-lineup]")).toContainText("E2E Band");

    await band.goto("/e2eband");
    const frame = band.frameLocator("iframe[data-topeight-profile]");
    await expect(frame.locator(".shows")).toContainText("E2E Venue", { timeout: 15_000 });
    await expect(frame.locator('.shows [data-topeight-navigate="e2evenue"]')).toBeVisible();

    await band.goto(venue.url().replace(/^https?:\/\/[^/]+/, ""));
    band.once("dialog", (d) => void d.accept());
    await band.locator("[data-event-lineup]").getByRole("button", { name: "Take us off this lineup" }).click();
    await expect(band.locator("[data-event-lineup]")).toHaveCount(0);

    await band.goto("/e2eband");
    await expect(band.frameLocator("iframe[data-topeight-profile]").locator(".profile-right")).toBeVisible({
      timeout: 15_000,
    });
    await expect(band.frameLocator("iframe[data-topeight-profile]").locator(".shows")).toHaveCount(0);
  } finally {
    reset();
  }
});
