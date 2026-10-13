import { expect, test } from "@playwright/test";

const MODEL_BUTTON_REGEX = /Taylor 1\.0/i;

test.describe("Model Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("opens the selector from the model button", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await expect(modelButton).toBeVisible();
    await modelButton.click();

    await expect(page.getByPlaceholder("Search models...")).toBeVisible();
  });

  test("can search for models", async ({ page }) => {
    const modelButton = page
      .locator("button")
      .filter({ hasText: MODEL_BUTTON_REGEX })
      .first();
    await modelButton.click();

    await page.getByPlaceholder("Search models...").fill("Taylor");

    await expect(page.getByText("Taylor 1.0").first()).toBeVisible();
  });
});
