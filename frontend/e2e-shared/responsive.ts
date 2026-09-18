import { test, expect, type Page } from "@playwright/test";

async function fitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
}

async function navigate(page: Page, name: string) {
  if (page.viewportSize()!.width < 768) {
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
  await fitsViewport(page);
}

async function enter(page: Page, staticDemo: boolean) {
  await page.goto(staticDemo ? "./" : "/");
  await fitsViewport(page);
  if (!staticDemo)
    await page.getByRole("button", { name: "体验示例工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "你好，林老师" }),
  ).toBeVisible();
}

export function responsiveSuite(staticDemo: boolean) {
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 600],
    [844, 390],
    [1024, 600],
    [1440, 720],
    [1920, 1080],
  ]) {
    test(`responsive workspace ${width}x${height}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height });
      await enter(page, staticDemo);
      await fitsViewport(page);
      if (width >= 768) {
        await expect(page.locator(".sidebar")).toHaveCSS(
          "width",
          width < 1200 ? "80px" : "232px",
        );
        await page
          .getByRole("button", {
            name: width < 1200 ? "展开侧栏" : "收起侧栏",
            exact: true,
          })
          .click();
        await expect(page.locator(".sidebar")).toHaveCSS(
          "width",
          width < 1200 ? "232px" : "80px",
        );
        await fitsViewport(page);
        await page
          .getByRole("button", {
            name: width < 1200 ? "收起侧栏" : "展开侧栏",
            exact: true,
          })
          .click();
      }
      for (const name of [
        "我的课堂",
        "教学洞察",
        "分析报告",
        "教研助手",
        "空间设置",
      ]) {
        await navigate(page, name);
      }
      await page.getByLabel("模型提供方式").selectOption("openai");
      await page
        .getByLabel("Base URL", { exact: true })
        .fill("https://example.com/a-very-long-but-valid-service-prefix/v1");
      await fitsViewport(page);
      await page
        .getByRole("button", { name: "保存模型设置" })
        .scrollIntoViewIfNeeded();
      await fitsViewport(page);
      await navigate(page, "我的课堂");
      for (const header of await page.locator(".lesson-table th").all()) {
        await expect(header).toBeVisible();
      }
      // Search remains available on phones and tablets.
      await page
        .getByRole("textbox", { name: "搜索课堂", exact: true })
        .fill("不存在的课堂");
      await expect(
        page.getByRole("heading", { name: "没有找到匹配课堂" }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "搜索课堂", exact: true })
        .fill("");
      await page
        .getByRole("button", { name: "二次函数的图像与性质", exact: true })
        .click();
      for (const name of [
        "授课方式画像",
        "转写与环节",
        "可优化点",
        "AI 追问",
      ]) {
        await page
          .locator(".detail-tabs")
          .getByRole("button", { name, exact: name !== "可优化点" })
          .click();
        await fitsViewport(page);
      }
      await page
        .getByRole("textbox", { name: "向教研助手提问" })
        .fill("如何改善互动？");
      await page.getByRole("button", { name: "发送问题" }).click();
      await expect(page.locator(".message.assistant")).toBeVisible();
      await fitsViewport(page);
      await navigate(page, "我的课堂");
      await page
        .getByRole("button", { name: "上传新课堂", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      if (!staticDemo) {
        await page
          .getByRole("button", { name: "导入转写文本", exact: true })
          .click();
        await page
          .getByRole("textbox", { name: "课堂名称" })
          .fill("响应式验收课堂");
      }
      const dialog = await page.getByRole("dialog").boundingBox();
      expect(dialog!.x).toBeGreaterThanOrEqual(0);
      expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width);
      expect(dialog!.height).toBeLessThanOrEqual(height);
      await page.keyboard.press("Escape");
      await fitsViewport(page);
      expect(errors).toEqual([]);
    });
  }

  test("drawer keyboard, scroll, backdrop and live breakpoint transitions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await enter(page, staticDemo);
    const menu = page.getByRole("button", { name: "打开导航", exact: true });
    await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", { name: "收起导航", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", {
        name: staticDemo ? "重置演示" : "退出登录",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "收起导航", exact: true }),
    ).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await page
      .getByRole("button", { name: "关闭导航", exact: true })
      .click({ position: { x: 380, y: 200 } });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await navigate(page, "空间设置");
    await expect(
      page.getByRole("heading", { name: "模型服务设置" }),
    ).toBeVisible();
    await menu.click();
    await page.setViewportSize({ width: 1024, height: 600 });
    await expect(page.locator(".sidebar")).toHaveCSS("width", "80px");
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await expect(page.locator(".main-shell")).not.toHaveAttribute("inert", "");
    await page.setViewportSize({ width: 1440, height: 720 });
    await expect(page.locator(".sidebar")).toHaveCSS("width", "232px");
    await page.setViewportSize({ width: 390, height: 480 });
    await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
    await fitsViewport(page);
  });
}
