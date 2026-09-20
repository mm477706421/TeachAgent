import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const demo = JSON.parse(
  readFileSync(new URL("../src/demo.json", import.meta.url), "utf8"),
);

const answer = [
  "## 课堂观察",
  "本课的**互动机会**可以增加，先观察，再提出建议。",
  "### 建议步骤",
  "1. 提出开放问题\n2. 留出等待时间\n   - 请学生说明理由\n   - 邀请同伴补充",
  "> 依据片段 #1，不能仅凭转写推断参与程度。",
  "| 环节 | 教师行动 | 学生行动 | 时间 | 观察证据 |\n| --- | --- | --- | --- | --- |\n| 探究 | 开放提问 | 小组讨论 | 3 分钟 | 原文片段 #1 |",
  "使用 `wait_time` 记录等待时间。",
  '```python\nquestion = "请结合函数图像的对称性、顶点位置、开口方向以及实际问题的含义，说明你的观察，并给出支持判断的证据。"\nprint(question)\n```',
  "- [x] 回看原文\n- [ ] 尝试调整",
  "~~直接下结论~~，先核实证据。",
  "[参考资料](https://example.com/teaching)",
  '![不应加载的图片](https://example.com/should-not-load.png)\n<script>window.markdownExecuted = true</script>\n<img src="https://example.com/raw.png" onerror="window.markdownExecuted=true">\n[危险链接](javascript:alert(1))',
  "👩‍🏫 教学建议结束。",
].join("\n\n");

async function mockChat(page: Page, content = answer) {
  const history: { role: string; content: string; engine?: string }[] = [];
  const lesson = {
    ...demo,
    id: "markdown-test",
    title: "Markdown 验收课堂",
    example: 0,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/auth/me")
      body = {
        user: { id: "test", name: "验收教师", role: "teacher" },
        csrf: "test-csrf",
      };
    else if (path === "/api/lessons") body = [lesson];
    else if (path === "/api/lessons/markdown-test") body = lesson;
    else if (path === "/api/model-settings") body = { provider: "rules" };
    else if (path === "/api/lessons/markdown-test/chat/stream") {
      const input = route.request().postDataJSON();
      const reply = {
        role: "assistant",
        content,
        engine: "local-rules",
        status: "completed",
        request_id: input.request_id,
        attempt: input.retry ? 2 : 1,
      };
      if (input.retry) history.splice(-1, 1, reply);
      else history.push({ role: "user", content: input.message }, reply);
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          {
            type: "start",
            request_id: input.request_id,
            attempt: reply.attempt,
          },
          { type: "delta", content, engine: "local-rules" },
          { type: "done", ...reply },
        ]
          .map((e) => `data: ${JSON.stringify(e)}\n\n`)
          .join(""),
      });
      return;
    } else if (path === "/api/lessons/markdown-test/chat") {
      body = history;
    } else throw new Error(`Unexpected UI test API: ${path}`);
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: lesson.title, exact: true }).click();
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "某个环节为何互动偏少，可以怎么改？" }),
  ).toBeEnabled();
  return history;
}

async function ask(page: Page, question = "如何改善互动？") {
  await page.getByRole("textbox", { name: "向教研助手提问" }).fill(question);
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.locator(".message.assistant").last()).toBeVisible();
}

test("received replies render immediately, regenerate without duplicates and reload", async ({
  page,
}) => {
  const history = await mockChat(page);
  await ask(page, "**用户文字保持原样**");
  await expect(page.locator(".markdown-body")).toContainText("教学建议结束");
  await expect(page.locator(".message.user strong")).toHaveCount(0);
  await expect(page.locator(".message.user")).toContainText(
    "**用户文字保持原样**",
  );
  await expect(page.locator(".assistant-reply")).toHaveAttribute(
    "data-typing",
    "false",
  );
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.locator(".markdown-body")).toContainText("教学建议结束");
  expect(history).toHaveLength(2);
  await page.getByRole("button", { name: "授课方式画像", exact: true }).click();
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await expect(page.locator(".assistant-reply")).toHaveCount(1);
  await expect(page.locator(".assistant-reply")).toHaveAttribute(
    "data-typing",
    "false",
  );
});

test("Markdown renders safely with responsive tables and code blocks", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.com"))
      external.push(request.url());
  });
  await mockChat(page);
  await ask(page);
  const body = page.locator(".markdown-body");
  await expect(
    body.getByRole("heading", { name: "课堂观察", level: 2 }),
  ).toBeVisible();
  await expect(body.locator("strong")).toHaveText("互动机会");
  await expect(body.locator("ol > li")).toHaveCount(2);
  await expect(body.locator("ol ul > li")).toHaveCount(2);
  await expect(body.locator("blockquote")).toContainText("依据片段 #1");
  await expect(body.locator("table tbody tr")).toHaveCount(1);
  await expect(body.locator("pre code")).toContainText("print(question)");
  await expect(body.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(body.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(body.locator('input[type="checkbox"]').first()).toBeDisabled();
  await expect(body.locator("del")).toHaveText("直接下结论");
  await expect(body.getByRole("link", { name: "参考资料" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await expect(body.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(body.locator("img,script,iframe")).toHaveCount(0);
  expect(await page.evaluate(() => "markdownExecuted" in window)).toBe(false);
  expect(external).toEqual([]);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() => body.evaluate((e) => e.scrollWidth - e.clientWidth))
      .toBeLessThanOrEqual(1);
  }
  expect(
    await body
      .locator(".markdown-table")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
  ).toBe(true);
  expect(
    await body.locator("pre").evaluate((e) => e.scrollWidth > e.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".chat-messages").evaluate((e) => {
    e.scrollTop = 0;
  });
  await page
    .locator(".chat-panel")
    .screenshot({ path: "../docs/images/chat-markdown.png" });
});

test("long Markdown respects reduced motion and stays readable after navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockChat(
    page,
    "### 课堂建议\n\n" + "这是需要结合证据逐步核实的教学观察。\n\n".repeat(100),
  );
  await ask(page);
  await expect(page.locator(".assistant-reply")).toHaveAttribute(
    "data-typing",
    "false",
  );
  const area = page.locator(".chat-messages");
  expect(await area.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await area.evaluate((e) => {
    e.scrollTop = 0;
    e.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: "授课方式画像", exact: true }).click();
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await expect(page.locator(".assistant-reply")).toHaveCount(1);
  expect(errors).toEqual([]);
});
