import { expect, test } from "@playwright/test";

test("logged-out homepage shows login, sign up and the cool boxes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Member Login")).toBeVisible();
  await expect(page.getByRole("link", { name: "SIGN UP!" })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/reset");
  await expect(page.getByText("Remember Me")).toBeVisible();
  await expect(page.getByText("Cool New People")).toBeVisible();
  await expect(page.getByText("Cool New Music")).toBeVisible();
  await expect(page.getByText("OpenSpace Announcements")).toBeVisible();
  await expect(page.getByText("Upcoming Shows")).toBeVisible();
  await expect(page.getByText("Welcome to OpenSpace.")).toBeVisible();
  // Empty database shows an empty state, a seeded one shows profile links.
  const people = page.locator("section", { has: page.getByRole("heading", { name: "Cool New People" }) });
  await expect(
    people.getByText("No new people yet").or(people.locator('a[href^="/"]').first()),
  ).toBeVisible();
});

test("a wrong password shows an error on the homepage", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("E-Mail:").fill("nobody@example.com");
  await page.getByLabel("Password:").fill("wrong-password");
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page.getByText("Invalid e-mail or password.")).toBeVisible();
});
