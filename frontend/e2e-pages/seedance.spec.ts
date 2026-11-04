import { test, expect } from "@playwright/test";

test("Seedance Pages demo never accepts keys or contacts APIs", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.url());
  });
  await page.goto("./");
  await page.getByRole("button", { name: "教学视频生成", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "让教学灵感，成为画面。" }),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "科学 · 水循环", exact: true })
    .click();
  await page.getByRole("button", { name: "体验生成入口" }).click();
  await expect(page.locator(".toast")).toContainText("演示不提交生成任务");
  await page.getByRole("button", { name: "了解下载" }).click();
  await expect(page.locator(".toast")).toContainText("合成示例没有真实视频");
  await page.getByRole("button", { name: "关闭提示" }).click();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("heading", { name: "让教学灵感，成为画面。" }),
  ).toBeInViewport();
  await page.screenshot({
    path: "../docs/images/seedance-studio.png",
    fullPage: true,
  });
  expect(requests).toEqual([]);
});
