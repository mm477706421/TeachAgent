import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const password = "Onboarding-fixture-123";
async function teacher(request: APIRequestContext) {
  const admin = await request.post("/api/auth/login", {
    data: {
      username: process.env.TEACHAGENT_E2E_USERNAME || "admin",
      password: process.env.TEACHAGENT_E2E_PASSWORD,
    },
  });
  expect(admin.ok()).toBeTruthy();
  const username = `key-setup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": (await admin.json()).csrf },
    data: { username, password, name: "配置验收教师" },
  });
  expect(response.status()).toBe(201);
  return username;
}
async function login(page: Page, username: string) {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号", exact: true })
    .fill(username);
  await page.getByLabel("登录密码").fill(password);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "空间设置", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
}
test.beforeEach(() =>
  test.skip(!process.env.TEACHAGENT_E2E_PASSWORD, "Requires test account"),
);

test("missing keys prompt on login; smaller skip stays usable and is scoped to the login and user", async ({
  page,
  request,
}) => {
  const username = await teacher(request);
  await login(page, username);
  const dialog = page.getByRole("dialog", { name: "配置你的 API Key" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("配置用途")).toHaveValue("seedance");
  await expect(
    dialog.getByRole("link", { name: "申请 API Key" }),
  ).toHaveAttribute("href", /ark\.volcengine\.com\/region:cn-beijing\/apiKey/);
  await expect(
    dialog.getByRole("link", { name: "申请 API Key" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    dialog.getByRole("button", { name: "测试并保存 API Key" }),
  ).toBeDisabled();
  const size = await dialog.evaluate((el) => ({
    skip: parseFloat(
      getComputedStyle(el.querySelector(".api-key-skip")!).fontSize,
    ),
    save: parseFloat(
      getComputedStyle(el.querySelector(".api-key-save")!).fontSize,
    ),
  }));
  expect(size.skip).toBeLessThan(size.save);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.screenshot({
    path: "../docs/images/api-key-setup.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "稍后配置" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "上传新课堂", exact: true }).first(),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await logout(page);
  await login(page, username);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await logout(page);
  await login(page, await teacher(request));
  await expect(dialog).toBeVisible();
});

test("chat setup rejects invalid keys then verifies and saves a real compatible stream", async ({
  page,
  request,
}) => {
  const calls: { key: string; body: { messages: { content: string }[] } }[] =
    [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ key: req.headers.authorization || "", body: JSON.parse(raw) });
    if (req.headers.authorization !== "Bearer correct-fixture-key") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":"invalid key"}');
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const username = await teacher(request);
    await login(page, username);
    const dialog = page.getByRole("dialog", { name: "配置你的 API Key" });
    await dialog.getByLabel("配置用途").selectOption("chat");
    await expect(
      dialog.getByRole("link", { name: "申请 API Key" }),
    ).toHaveAttribute("href", "https://platform.deepseek.com/api_keys");
    await dialog
      .getByLabel("API Key", { exact: true })
      .fill("must-clear-on-provider-change");
    await dialog.getByLabel("服务商").selectOption("custom");
    await expect(dialog.getByLabel("API Key", { exact: true })).toHaveValue("");
    await dialog
      .getByLabel("API 服务地址")
      .fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
    await dialog.getByLabel("模型 ID", { exact: true }).fill("test-model");
    await dialog
      .getByLabel("API Key", { exact: true })
      .fill("wrong-fixture-key");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "测试并保存 API Key" }).click();
    await expect(dialog.getByRole("alert")).toContainText("认证失败");
    expect(
      (await (await page.request.get("/api/model-settings/onboarding")).json())
        .needs_api_key,
    ).toBe(true);
    await dialog
      .getByLabel("API Key", { exact: true })
      .fill("correct-fixture-key");
    await dialog.getByRole("button", { name: "测试并保存 API Key" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("验证通过");
    expect(calls).toHaveLength(2);
    expect(calls[1].body.messages).toHaveLength(1);
    expect(calls[1].body.messages[0].content).toContain("连接测试");
    const settings = await (
      await page.request.get("/api/model-settings")
    ).json();
    expect(settings.api_key_configured).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("correct-fixture-key");
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toContain("correct-fixture-key");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "上传新课堂", exact: true }).first(),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await logout(page);
    await login(page, username);
    await expect(
      page.getByRole("button", { name: "上传新课堂", exact: true }).first(),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Seedance setup submits only validation, preserves errors, and saves after success", async ({
  page,
  request,
}) => {
  const submitted: string[] = [];
  await page.route(
    "**/api/seedance/settings/verify-and-save",
    async (route) => {
      const body = route.request().postDataJSON();
      submitted.push(body.api_key);
      if (body.api_key === "invalid-video-key") {
        await route.fulfill({
          status: 502,
          json: { detail: "Seedance 认证失败" },
        });
        return;
      }
      const response = await route.fetch({
        url: new URL("/api/seedance/settings", route.request().url()).href,
        method: "PUT",
      });
      await route.fulfill({ response });
    },
  );
  const generated: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/seedance/videos"))
      generated.push(r.url());
  });
  await login(page, await teacher(request));
  const dialog = page.getByRole("dialog", { name: "配置你的 API Key" });
  await dialog.getByLabel("Seedance 模型 ID").fill("seedance-test-model");
  await dialog.getByLabel("API Key", { exact: true }).fill("invalid-video-key");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "测试并保存 API Key" }).click();
  await expect(dialog.getByRole("alert")).toContainText("配置未保存");
  await dialog
    .getByLabel("API Key", { exact: true })
    .fill("valid-video-fixture");
  await dialog.getByRole("button", { name: "测试并保存 API Key" }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toEqual(["invalid-video-key", "valid-video-fixture"]);
  expect(generated).toEqual([]);
  await page.getByRole("button", { name: "教学视频生成", exact: true }).click();
  await expect(page.getByLabel("Seedance 模型 ID")).toHaveValue(
    "seedance-test-model",
  );
  await expect(page.getByLabel("Seedance API Key")).toHaveValue("");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "上传新课堂", exact: true }).first(),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("configuration check failures can be retried or skipped", async ({
  page,
  request,
}) => {
  let fail = true;
  await page.route("**/api/model-settings/onboarding", async (route) => {
    if (fail)
      await route.fulfill({ status: 503, json: { detail: "Unavailable" } });
    else await route.continue();
  });
  await login(page, await teacher(request));
  const dialog = page.getByRole("dialog", { name: "配置你的 API Key" });
  await expect(dialog.getByRole("alert")).toContainText("暂时无法检查");
  fail = false;
  await dialog.getByRole("button", { name: "重新检查配置" }).click();
  await expect(dialog.getByLabel("配置用途")).toBeVisible();
  await dialog.getByRole("button", { name: "稍后配置" }).click();
  await expect(dialog).toHaveCount(0);
});
