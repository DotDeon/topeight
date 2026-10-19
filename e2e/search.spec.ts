import { expect, test } from "@playwright/test";

test("searching for a seeded name finds the profile", async ({ page }) => {
  await page.goto("/search?q=Sandbox&type=music");
  await expect(page.getByRole("heading", { name: 'Search results for "Sandbox"' })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sandbox Test/ })).toHaveAttribute("href", "/sandboxtest");
  await expect(page.getByText("Sandbox Fan")).toHaveCount(0);
});

test("browse lists users and the filter form works", async ({ page }) => {
  await page.goto("/browse?kind=artist");
  await expect(page.getByRole("heading", { name: "Browse Users" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sandbox Test/ })).toBeVisible();
});
