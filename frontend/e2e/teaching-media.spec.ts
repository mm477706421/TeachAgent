import { test, expect } from "@playwright/test";
test("teachers save private science models and use only Seedance video generation", async ({
  page,
}) => {
  test.skip(!process.env.TEACHAGENT_E2E_PASSWORD, "Requires test account");
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号", exact: true })
    .fill(process.env.TEACHAGENT_E2E_USERNAME || "admin");
  await page.getByLabel("登录密码").fill(process.env.TEACHAGENT_E2E_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "理科动态模型", exact: true }).click();
  const name = "单摆验证 " + Date.now();
  await page.getByLabel("模型名称", { exact: true }).fill(name);
  await page
    .getByLabel("课程内容或原理")
    .fill("单摆，摆长为 2，初始角度为 12。");
  await page.getByRole("button", { name: "根据描述生成模型" }).click();
  await expect(page.getByLabel("摆长（m）")).toHaveValue("2");
  await page.getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const card = page
    .locator(".seedance-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.getByRole("button", { name: "删除模型", exact: true }).click();
  await card.getByRole("button", { name: "确认删除模型" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "教学视频生成", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "连接 Seedance" }),
  ).toBeVisible();
  await expect(page.getByLabel("视频生成算力")).toHaveCount(0);
  await expect(page.getByText(/ComfyUI/)).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", {
      name: /我同意将提示词发送至 Seedance/,
    }),
  ).not.toBeChecked();
});
