import { test, expect } from "@playwright/test";

test("shared library demo explains access without accepting uploads or downloading data", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.url());
  });
  await page.goto("./");
  await page.getByRole("button", { name: "共享视频库", exact: true }).click();
  await expect(page.locator(".library-card")).toHaveCount(2);
  await page.getByRole("button", { name: "上传共享视频", exact: true }).click();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByLabel("搜索共享视频").fill("数学");
  await expect(page.locator(".library-card")).toHaveCount(1);
  await page.getByRole("button", { name: "下载视频", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "请在学校工作台下载真实共享视频",
  );
  await page.getByLabel("只看我上传的").check();
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的视频" }),
  ).toBeVisible();
  expect(requests).toEqual([]);
});
