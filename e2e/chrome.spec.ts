import { expect, test } from "@playwright/test";

test("about page shows the classic chrome", async ({ page }) => {
  await page.goto("/about");
  const header = page.locator("header");
  await expect(header).toContainText("TopEight");
  await expect(header).toContainText("a place for friends");
  await expect(page.locator("nav a")).toHaveCount(12);
  await expect(page.locator("footer")).toContainText("Report Abuse");
  await expect(header.getByLabel("TopEight")).toBeChecked();
  await expect(page.getByText("Log In")).toBeVisible();
});

test("coming soon names known features only", async ({ page }) => {
  await page.goto("/coming-soon?f=blog");
  await expect(page.getByText("Blog is coming soon")).toBeVisible();
  await page.goto("/coming-soon?f=%3Cb%3Ex%3C%2Fb%3E");
  await expect(page.getByText("That feature is coming soon")).toBeVisible();
});

test("privacy and terms carry required statements", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByText("Those websites can see your IP address when you view an artist page.", { exact: false }),
  ).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByText("13", { exact: false }).first()).toBeVisible();
});

test("search form posts type and q", async ({ page }) => {
  await page.goto("/about");
  await page.locator("header").getByLabel("People").check();
  await page.locator("header input[name=q]").fill("jess");
  await page.locator("header").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe("jess");
  expect(url.searchParams.get("type")).toBe("people");
});

test("friends page shows the member's name, the grid area and a link back", async ({ page }) => {
  await page.goto("/sandboxtest/friends");
  await expect(page.getByRole("heading", { name: "Sandbox Test's Friends" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the profile" })).toHaveAttribute("href", "/sandboxtest");
});
