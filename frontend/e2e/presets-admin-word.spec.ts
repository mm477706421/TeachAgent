import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("superadmin creates administrator; teacher uses key-only presets and downloads Word", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires local test account",
  );
  const password = "New-admin-fixture-123";
  const username = `preset-admin-${Date.now()}`;
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号", exact: true })
    .fill(process.env.TEACHAGENT_E2E_USERNAME || "admin");
  await page.getByLabel("登录密码").fill(process.env.TEACHAGENT_E2E_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "学校管理", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "超级管理员", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "新建管理员账号", exact: true })
    .click();
  await page.getByLabel("管理员姓名").fill("预设验收管理员");
  await page.getByLabel("登录账号", { exact: true }).fill(username);
  await page.getByLabel("初始密码").fill(password);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: `预设验收管理员 ${username}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page
    .getByRole("textbox", { name: "教师账号", exact: true })
    .fill(username);
  await page.getByLabel("登录密码").fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "学校管理", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新建管理员账号", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新建教师账号", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByLabel("模型提供方式").selectOption("openai");
  await page.getByLabel("搜索提供方").fill("DeepSeek");
  await page.getByRole("button", { name: /DeepSeek.*填写/ }).click();
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("当前配置：DeepSeek", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("API Key", { exact: true })
    .fill("fixture-deepseek-key");
  await page.getByLabel("我确认允许向配置的服务发送上述课堂文本上下文").check();
  await page.getByRole("button", { name: "保存模型设置" }).click();
  await expect(page.locator(".model-result")).toContainText("设置已保存");
  const first = await (await page.request.get("/api/model-settings")).json();
  expect(first.model).toBe("deepseek-chat");
  expect(first.base_url).toBe("https://api.deepseek.com/v1");
  expect(first.api_key_configured).toBe(true);
  await page.getByLabel("搜索提供方").fill("OpenAI");
  await page.getByRole("button", { name: /OpenAI.*填写/ }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByLabel("API Key", { exact: true }).fill("fixture-openai-key");
  await page.getByLabel("我确认允许向配置的服务发送上述课堂文本上下文").check();
  await page.getByRole("button", { name: "保存模型设置" }).click();
  await expect(page.locator(".model-result")).toContainText("设置已保存");
  await page.reload();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByLabel("搜索提供方").fill("DeepSeek");
  await page.getByRole("button", { name: /DeepSeek.*已保存 Key/ }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "保存模型设置" }).click();
  await expect(page.locator(".model-result")).toContainText("设置已保存");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel("搜索提供方").fill("");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../.data/presets-desktop.png",
    fullPage: false,
  });
  // Downloads use the real API and contain an OOXML package, not renamed Markdown.
  const me = await (await page.request.get("/api/auth/me")).json();
  const lesson = await page.request.post("/api/lessons/text", {
    headers: { "X-CSRF-Token": me.csrf },
    data: {
      title: "Word 导出验收",
      text: "教师：今天学习函数。学生：为什么变化？教师：请练习。",
    },
  });
  expect(lesson.status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: "我的课堂", exact: true }).click();
  await page
    .getByRole("button", { name: "Word 导出验收", exact: true })
    .click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 Word 报告", exact: true })
    .click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  const anonymous = await request.get(
    `/api/lessons/${(await lesson.json()).id}/report`,
  );
  expect(anonymous.status()).toBe(401);
});
