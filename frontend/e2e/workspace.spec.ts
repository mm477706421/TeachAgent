import { test, expect } from "@playwright/test";

test("demo workspace, evidence, conversation, upload dialog and mobile navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:8000") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "体验示例工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "你好，林老师" }),
  ).toBeVisible();
  await expect(page.getByText("正在体验合成课堂示例")).toBeVisible();
  await page.waitForTimeout(1800); // Let chart entry interpolation settle for the reference capture.
  await page.screenshot({
    path: "../docs/images/dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "二次函数的图像与性质", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "这堂课的教学观察" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "可优化点", exact: false }).click();
  await page
    .getByRole("button", { name: "查看片段", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "转写原文", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await page
    .getByRole("button", { name: "某个环节为何互动偏少，可以怎么改？" })
    .click();
  await expect(page.getByText("合成示例回答")).toBeVisible();
  await page.screenshot({
    path: "../docs/images/analysis-chat.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.getByRole("button", { name: "上传新课堂", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "添加一堂新课" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "导入转写文本", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "课堂转写", exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "我的课堂", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的课堂", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "../docs/images/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("real login, text import, report download, local chat, admin and logout", async ({
  page,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires a locally provisioned test admin",
  );
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号" })
    .fill(process.env.TEACHAGENT_E2E_USERNAME || "e2e-admin");
  await page.getByLabel("登录密码").fill(process.env.TEACHAGENT_E2E_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "你好，", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "上传新课堂", exact: true }).click();
  await page.getByRole("button", { name: "导入转写文本", exact: true }).click();
  await page.getByRole("textbox", { name: "课堂名称" }).fill("浏览器验收课堂");
  await page.getByRole("textbox", { name: "授课班级" }).fill("验收班级");
  await page
    .getByRole("textbox", { name: "课堂转写", exact: false })
    .fill(
      "教师：今天我们学习图形。\n教师：为什么图像会对称？\n学生：我观察到两边相同。\n教师：那么，请完成练习。",
    );
  await page.getByRole("button", { name: "开始文本分析", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "浏览器验收课堂", exact: true }),
  ).toBeVisible();
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载报告", exact: true }).click();
  expect((await d).suggestedFilename()).toMatch(/\.md$/);
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await page
    .getByRole("textbox", { name: "向教研助手提问" })
    .fill("如何改善互动？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.locator(".message.assistant")).toBeVisible({
    timeout: 100000,
  });
  await page.getByRole("button", { name: "学校管理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "学校数据管理" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建教师账号", exact: true }).click();
  await page.getByRole("textbox", { name: "教师姓名" }).fill("验收教师");
  await page
    .getByRole("textbox", { name: "登录账号", exact: true })
    .fill("e2e-teacher-" + Date.now());
  await page.getByLabel("初始密码").fill("Local-test-password-123");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByText("教师账号已创建", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎回到教研工作台" }),
  ).toBeVisible();
});
