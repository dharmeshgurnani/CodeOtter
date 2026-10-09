import { expect, test } from "@playwright/test";

test("home renders from the real server with file storage", async ({ page, request }) => {
  expect((await request.get("/healthz")).ok()).toBe(true);
  await page.goto("/");
  await expect(page).toHaveTitle(/CodeOtter/);
  await expect(page.getByText(/CodeOtter/).first()).toBeVisible();
});

test("settings pages come from server JSON and render through the generic form", async ({ page }) => {
  await page.goto("/settings/model");
  await expect(page.getByText("Auto-review")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});
