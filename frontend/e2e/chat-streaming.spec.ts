import { test, expect } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

test("real streamed tokens, stop before/after first token, retry, failure and navigation cleanup", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires test administrator",
  );
  let mode: "partial" | "silent" | "complete" | "broken" = "partial";
  const calls: {
    stream: boolean;
    messages: { role: string; content: string }[];
  }[] = [];
  const responses: ServerResponse[] = [];
  const closed = new Set<number>();
  const frame = (text: string, finish = false) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish ? "stop" : null }] })}\n\n`;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const index = calls.length;
    calls.push(JSON.parse(raw));
    responses.push(res);
    res.on("close", () => closed.add(index));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders();
    if (mode === "silent") return;
    res.write(frame("### 实时课堂观察\n\n第一段已经到达👩‍🏫。\n\n"));
    if (mode === "complete")
      res.end(frame("**回答完成**，请结合课堂证据。", true));
    if (mode === "broken") res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const admin = await request.post("/api/auth/login", {
      data: {
        username: process.env.TEACHAGENT_E2E_USERNAME || "e2e-admin",
        password: process.env.TEACHAGENT_E2E_PASSWORD,
      },
    });
    expect(admin.ok()).toBeTruthy();
    const username = `stream-e2e-${Date.now()}`;
    expect(
      (
        await request.post("/api/admin/users", {
          headers: { "X-CSRF-Token": (await admin.json()).csrf },
          data: {
            username,
            password: "Stream-test-password-123",
            name: "流式验收教师",
          },
        })
      ).status(),
    ).toBe(201);
    const login = await page.request.post("/api/auth/login", {
      data: { username, password: "Stream-test-password-123" },
    });
    const headers = { "X-CSRF-Token": (await login.json()).csrf };
    await page.request.put("/api/model-settings", {
      headers,
      data: {
        provider: "openai",
        base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        model: "stream-test",
        allow_external: true,
      },
    });
    const lesson = await (
      await page.request.post("/api/lessons/text", {
        headers,
        data: {
          title: "流式浏览器验收课堂",
          text: "教师：今天学习图形。为什么？请同学们讨论后回答。",
        },
      })
    ).json();
    const history = async () =>
      (await page.request.get(`/api/lessons/${lesson.id}/chat`)).json();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("button", { name: lesson.title, exact: true }).click();
    await page.getByRole("button", { name: "AI 追问", exact: true }).click();
    const ask = async (text: string) => {
      await page.getByRole("textbox", { name: "向教研助手提问" }).fill(text);
      await page.getByRole("button", { name: "发送问题" }).click();
    };
    await expect(
      page.getByRole("button", { name: "某个环节为何互动偏少，可以怎么改？" }),
    ).toBeEnabled();
    await ask("怎样改善互动？");
    const reply = page.locator(".assistant-reply").last();
    await expect(reply).toContainText("第一段已经到达👩‍🏫");
    await expect(reply).toHaveAttribute("data-typing", "true");
    expect(responses[0].writableEnded).toBe(false); // The provider has NOT finished.
    expect(calls[0].stream).toBe(true);
    await expect(
      page.getByRole("textbox", { name: "向教研助手提问" }),
    ).toBeDisabled();
    // Stream a tall answer, then verify scrolling up is respected during further deltas.
    responses[0].write(frame("课堂证据需要逐项核实。\n\n".repeat(70)));
    const area = page.locator(".chat-messages");
    await expect
      .poll(() => area.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(0);
    await area.evaluate((e) => {
      e.scrollTop = 0;
      e.dispatchEvent(new Event("scroll"));
    });
    responses[0].write(frame("滚动核验的新内容。\n\n"));
    await expect(reply).toContainText("滚动核验的新内容");
    expect(await area.evaluate((e) => e.scrollTop)).toBe(0);
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "重试", exact: true }),
    ).toBeEnabled();
    await expect.poll(() => closed.has(0)).toBe(true);
    expect((await history()).at(-1).status).toBe("stopped");
    mode = "complete";
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(reply).toContainText("回答完成");
    await expect(
      page.getByRole("button", { name: "重新生成", exact: true }),
    ).toBeEnabled();
    expect(await history()).toHaveLength(2);
    expect(calls[1].messages.filter((m) => m.role === "user")).toHaveLength(1);
    // Stop while waiting for the very first content token.
    mode = "silent";
    await ask("等待首字也能停止吗？");
    await expect.poll(() => calls.length).toBe(3);
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "重试", exact: true }),
    ).toBeEnabled();
    await expect.poll(() => closed.has(2)).toBe(true);
    expect((await history()).at(-1).content).toBe("");
    // An incomplete provider response is visibly failed, then replaced on retry.
    mode = "broken";
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.locator(".reply-error")).toContainText("提前中断");
    await expect(reply).toContainText("第一段已经到达");
    mode = "complete";
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(reply).toContainText("回答完成");
    await expect(page.locator(".reply-error")).toHaveCount(0);
    expect(await history()).toHaveLength(4);
    // Leaving chat cancels the upstream request and history keeps the partial answer.
    mode = "partial";
    await ask("离开页面时停止");
    await expect(reply).toContainText("第一段已经到达");
    await page
      .getByRole("button", { name: "授课方式画像", exact: true })
      .click();
    await expect.poll(() => closed.has(5)).toBe(true);
    await expect
      .poll(async () => (await history()).at(-1).status)
      .toBe("stopped");
    await page.getByRole("button", { name: "AI 追问", exact: true }).click();
    await expect(reply).toHaveAttribute("data-typing", "false");
    await expect(
      page.getByRole("button", { name: "重试", exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally {
    responses.forEach((res) => res.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
