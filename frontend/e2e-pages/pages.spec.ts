import { test, expect } from "@playwright/test";

test("Pages demo works under the repository path without classroom requests", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "你好，林老师" }),
  ).toBeVisible();
  await expect(
    page.getByText("GitHub Pages 公开演示", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "教师账号" })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "你好，林老师" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "上传新课堂", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "真实课堂请在本地处理" }),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "二次函数的图像与性质", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载报告", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("TeachAgent-example.md");
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await page
    .getByRole("button", { name: "某个环节为何互动偏少，可以怎么改？" })
    .click();
  await expect(page.getByText("合成示例回答", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重置演示" }).click();
  await expect(
    page.getByRole("heading", { name: "你好，林老师" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "我的课堂", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  const root = new URL(baseURL!);
  expect(requests.filter((url) => !url.startsWith(root.href))).toEqual([]);
  expect(requests.filter((url) => /\/api\//.test(url))).toEqual([]);
});
