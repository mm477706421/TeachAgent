import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("per-account model settings, draft connection, saved key, online chat and rules", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires test administrator",
  );
  const calls: {
    path: string;
    authorization?: string;
    body: { model: string; messages: { role: string; content: string }[] };
  }[] = [];
  let status = 200;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push({
      path: req.url!,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        status === 200
          ? {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content:
                      "### 协议验收回答\n\n增加**学生讨论**，再结合课堂证据追问。",
                  },
                },
              ],
            }
          : { error: "provider error" },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const admin = await request.post("/api/auth/login", {
      data: {
        username: process.env.TEACHAGENT_E2E_USERNAME || "e2e-admin",
        password: process.env.TEACHAGENT_E2E_PASSWORD,
      },
    });
    expect(admin.ok()).toBeTruthy();
    const username = `model-e2e-${Date.now()}`;
    const created = await request.post("/api/admin/users", {
      headers: { "X-CSRF-Token": (await admin.json()).csrf },
      data: {
        username,
        name: "模型验收教师",
        password: "Model-test-password-123",
      },
    });
    expect(created.status()).toBe(201);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("textbox", { name: "教师账号" }).fill(username);
    await page.getByLabel("登录密码").fill("Model-test-password-123");
    await page.getByRole("button", { name: "进入工作台" }).click();
    await page.getByRole("button", { name: "空间设置", exact: true }).click();
    await expect(page.getByLabel("模型提供方式")).toHaveValue("local");
    await page.getByLabel("模型提供方式").selectOption("openai");
    await page.getByLabel("Base URL", { exact: true }).fill(base);
    await page.getByLabel("模型 ID", { exact: true }).fill("validation-model");
    await page.getByLabel("API Key", { exact: true }).fill("test-only-key");
    await page
      .getByLabel("我确认允许向配置的服务发送上述课堂文本上下文")
      .check();
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(
      page.locator(".model-settings").getByRole("status"),
    ).toContainText("连接成功");
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/chat/completions");
    expect(calls[0].authorization).toBe("Bearer test-only-key");
    expect(calls[0].body.messages).toHaveLength(1);
    expect(
      (await (await page.request.get("/api/model-settings")).json()).provider,
    ).toBe("local");
    await page.getByRole("button", { name: "保存模型设置" }).click();
    await expect(
      page.locator(".model-settings").getByRole("status"),
    ).toContainText("设置已保存");
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
    await page.reload();
    await page.getByRole("button", { name: "空间设置", exact: true }).click();
    await expect(page.getByLabel("模型提供方式")).toHaveValue("openai");
    await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
      base,
    );
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
    status = 401;
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("认证失败");
    status = 200;
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(
      page.locator(".model-settings").getByRole("status"),
    ).toContainText("连接成功");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({
      path: "../docs/images/model-settings.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "我的课堂", exact: true }).click();
    await page.getByRole("button", { name: "上传新课堂", exact: true }).click();
    await page
      .getByRole("button", { name: "导入转写文本", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "课堂名称" })
      .fill("在线模型验收课堂");
    await page
      .getByRole("textbox", { name: "课堂转写", exact: false })
      .fill(
        "教师：今天学习图形。\n教师：为什么图形对称？\n学生：两边相同。\n教师：请练习并总结。",
      );
    await page
      .getByRole("button", { name: "开始文本分析", exact: true })
      .click();
    await page.getByRole("button", { name: "AI 追问", exact: true }).click();
    await page
      .getByRole("textbox", { name: "向教研助手提问" })
      .fill("如何改善互动？");
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.locator(".message.assistant")).toContainText(
      "协议验收回答",
    );
    await expect(page.locator(".message.assistant h3")).toHaveText(
      "协议验收回答",
    );
    await expect(page.locator(".message.assistant strong")).toHaveText(
      "学生讨论",
    );
    await expect(
      page.getByText("OpenAI 兼容模型 · validation-model", { exact: true }),
    ).toBeVisible();
    expect(
      calls.at(-1)!.body.messages.some((m) => m.content.includes("图形")),
    ).toBeTruthy();
    await page
      .getByRole("textbox", { name: "向教研助手提问" })
      .fill("再给一个例子");
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.locator(".message.assistant")).toHaveCount(2);
    expect(
      calls.at(-1)!.body.messages.some((m) => m.role === "assistant"),
    ).toBeTruthy();
    await page.getByRole("button", { name: "空间设置", exact: true }).click();
    await page.getByLabel("清除已保存的 API Key").check();
    await page.getByRole("button", { name: "保存模型设置" }).click();
    await expect(
      page.locator(".model-settings").getByRole("status"),
    ).toContainText("设置已保存");
    await expect(page.getByLabel("清除已保存的 API Key")).toHaveCount(0);
    await page.getByLabel("模型提供方式").selectOption("rules");
    await page.getByRole("button", { name: "保存模型设置" }).click();
    await expect(
      page.locator(".model-settings").getByRole("status"),
    ).toContainText("设置已保存");
    const count = calls.length;
    await page.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(
      page.locator(".model-settings").getByRole("status"),
    ).toContainText("无需网络");
    await page.getByRole("button", { name: "我的课堂", exact: true }).click();
    await page
      .getByRole("button", { name: "在线模型验收课堂", exact: true })
      .click();
    await page.getByRole("button", { name: "AI 追问", exact: true }).click();
    await expect(page.locator(".message.assistant")).toHaveCount(2);
    await page
      .getByRole("textbox", { name: "向教研助手提问" })
      .fill("如何改善互动？");
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.locator(".message.assistant")).toHaveCount(3);
    await expect(page.getByText("本地规则建议", { exact: true })).toBeVisible();
    expect(calls).toHaveLength(count);
    expect(errors).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
