import { expect, test } from "@playwright/test";

test("home renders from the real server with file storage", async ({ page, request }) => {
  expect((await request.get("/healthz")).ok()).toBe(true);
  await page.goto("/");
  await expect(page).toHaveTitle(/CodeOtter/);
  // the sidebar brand reads "Code Otter"; titles and copy elsewhere say "CodeOtter"
  await expect(page.getByText(/Code ?Otter/).first()).toBeVisible();
});

test("settings pages come from server JSON and render through the generic form", async ({ page }) => {
  await page.goto("/settings/model");
  await expect(page.getByText("Review engines")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test" }).first()).toBeVisible();
});
