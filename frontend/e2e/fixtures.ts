import { test as base, expect } from "@playwright/test";

// Existing feature suites dismiss the new login guide. Dedicated onboarding tests
// use Playwright directly so the guide itself is exercised without this helper.
export const test = base.extend<{ dismissApiSetup: void }>({
  dismissApiSetup: [
    async ({ page }, use) => {
      await page.addLocatorHandler(
        page.getByRole("dialog", { name: "配置你的 API Key" }),
        async (dialog) => {
          await dialog
            .getByRole("button", { name: "稍后配置", exact: true })
            .click();
        },
      );
      await use();
    },
    { auto: true },
  ],
});
export { expect };
export type { Page } from "@playwright/test";
