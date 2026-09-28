import { test, expect } from "@playwright/test";

test("Pages previews optional cloud ASR without accepting consent or uploading", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page.goto("./");
  await page
    .getByRole("button", { name: "上传新课堂", exact: true })
    .first()
    .click();
  await expect(page.getByText(/1.3.0 支持可选科大讯飞语音听写/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});
