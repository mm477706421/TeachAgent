import { responsiveSuite } from "../e2e-shared/responsive";
import { test, expect } from "@playwright/test";

responsiveSuite(false);

test("responsive teacher settings and school management", async ({ page }) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires isolated test admin",
  );
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号" })
    .fill(process.env.TEACHAGENT_E2E_USERNAME || "e2e-admin");
  await page.getByLabel("登录密码").fill(process.env.TEACHAGENT_E2E_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "你好，", exact: false }),
  ).toBeVisible();
  for (const [width, height] of [
    [320, 640],
    [768, 600],
    [1440, 600],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ["空间设置", "学校管理"]) {
      if (width < 768)
        await page
          .getByRole("button", { name: "打开导航", exact: true })
          .click();
      await page
        .locator(".sidebar")
        .getByRole("button", { name, exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      if (name === "空间设置") {
        await expect(page.getByLabel("模型提供方式")).toBeVisible();
        await page.getByLabel("模型提供方式").selectOption("openai");
        await page
          .getByLabel("API Key", { exact: true })
          .scrollIntoViewIfNeeded();
      } else {
        await expect(
          page.getByRole("heading", { name: "学校数据管理" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "新建教师账号", exact: true })
          .click();
        await page.getByLabel("初始密码").scrollIntoViewIfNeeded();
        const rect = await page.getByRole("dialog").boundingBox();
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
        expect(rect!.height).toBeLessThanOrEqual(height);
        await page.keyboard.press("Escape");
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
    }
  }
});
