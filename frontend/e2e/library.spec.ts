import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("shared library uploads, previews, downloads original bytes and deletes", async ({
  page,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires local test account",
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号", exact: true })
    .fill(process.env.TEACHAGENT_E2E_USERNAME || "admin");
  await page.getByLabel("登录密码").fill(process.env.TEACHAGENT_E2E_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "共享视频库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "共享视频库", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "上传共享视频", exact: true }).click();
  const title = `课堂片段 · 合成示例 ${Date.now()}`;
  await page.getByLabel("视频名称", { exact: true }).fill(title);
  await page.getByLabel("学科", { exact: true }).fill("数学");
  await page
    .getByLabel("借鉴要点")
    .fill("用于验证视频共享、浏览和下载的合成素材。未包含真实课堂。 ");
  const fixture = resolve("e2e-shared/fixtures/library-sample.mp4");
  await page.getByLabel("选择共享视频").setInputFiles(fixture);
  const consent = page.getByRole("checkbox", { name: /我确认有权共享此视频/ });
  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAttribute("required", "");
  await consent.check();
  await page.getByRole("button", { name: "确认共享上传", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索共享视频").fill(title);
  const card = page
    .locator(".library-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const downloadEvent = page.waitForEvent("download");
  await card.getByRole("link", { name: "下载视频", exact: true }).click();
  const downloaded = await downloadEvent;
  expect(await readFile((await downloaded.path())!)).toEqual(
    await readFile(fixture),
  );
  await card.getByRole("button", { name: "预览", exact: true }).click();
  await expect
    .poll(async () =>
      page
        .locator("video")
        .evaluate((node: HTMLVideoElement) => node.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.locator("video").evaluate((node: HTMLVideoElement) => node.play());
  await expect
    .poll(() =>
      page.locator("video").evaluate((node: HTMLVideoElement) => node.ended),
    )
    .toBe(true);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole("region", { name: "视频预览" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "../docs/images/shared-video-library.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "关闭视频预览" }).click();
  await card
    .getByRole("button", { name: `删除共享视频：${title}`, exact: true })
    .click();
  await card
    .getByRole("button", { name: "确认删除共享视频", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的视频" }),
  ).toBeVisible();
});
