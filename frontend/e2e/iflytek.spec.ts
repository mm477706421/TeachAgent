import { test, expect } from "@playwright/test";

test("cloud ASR requires explicit consent and remains a separate upload choice", async ({
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
  await page
    .getByRole("button", { name: "上传新课堂", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("语音转写服务")).toHaveValue("local");
  await page.getByLabel("语音转写服务").selectOption("iflytek");
  const consent = page.getByRole("checkbox", { name: /我已获得授权/ });
  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAttribute("required", "");
  await expect(page.getByText(/按 8 秒分段发送音频/)).toBeVisible();
  await page.getByLabel("课堂名称").fill("三角形内角和 · 合成教学示例");
  await page.screenshot({
    path: "../docs/images/iflytek-upload.png",
    fullPage: true,
  });
  await page.getByLabel("语音转写服务").selectOption("local");
  await expect(consent).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await expect(page.getByText("讯飞语音听写", { exact: true })).toBeVisible();
});
