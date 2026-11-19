import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "教师账号", exact: true })
    .fill(process.env.TEACHAGENT_E2E_USERNAME || "admin");
  await page.getByLabel("登录密码").fill(process.env.TEACHAGENT_E2E_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "教学视频生成", exact: true }).click();
}

test("Seedance settings persist without echoing keys and clear safely", async ({
  page,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires local test account",
  );
  await page.route(
    "**/api/seedance/settings/verify-and-save",
    async (route) => {
      // Browser fixture only; backend tests exercise the actual authorization check.
      const response = await route.fetch({
        url: new URL("/api/seedance/settings", route.request().url()).href,
        method: "PUT",
      });
      await route.fulfill({ response });
    },
  );
  await login(page);
  await page
    .getByLabel("Seedance 模型 ID", { exact: true })
    .fill("seedance-synthetic-test");
  await page
    .getByLabel("Seedance API Key", { exact: true })
    .fill("test-key-never-sent-to-provider");
  await page.getByRole("button", { name: "保存 Seedance 设置" }).click();
  await expect(
    page.getByText("密钥已加密保存", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Seedance API Key", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "科学 · 水循环", exact: true })
    .click();
  const consent = page.getByRole("checkbox", {
    name: /我同意将提示词发送至 Seedance/,
  });
  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAttribute("required", "");
  await page.getByRole("checkbox", { name: /清除已保存的密钥/ }).check();
  await page.getByRole("button", { name: "保存 Seedance 设置" }).click();
  await expect(page.getByText("尚未配置密钥", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成教学视频", exact: true }),
  ).toBeDisabled();
});

test("Seedance UI handles generated media, rename, download, delete and narrow screens with a simulated provider", async ({
  page,
}) => {
  test.skip(
    !process.env.TEACHAGENT_E2E_PASSWORD,
    "Requires local test account",
  );
  const media = await readFile(
    resolve("e2e-shared/fixtures/library-sample.mp4"),
  );
  let videos: Record<string, unknown>[] = [];
  let submitted = 0;
  await page.route("**/api/seedance/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/settings"))
      return route.fulfill({
        json: {
          model: "seedance-synthetic",
          api_key_configured: true,
          endpoint:
            "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
        },
      });
    if (url.pathname.endsWith("/media"))
      return route.fulfill({
        contentType: "video/mp4",
        headers: {
          "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename=teaching.mp4`,
        },
        body: media,
      });
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.allow_external).toBe(true);
      expect(body.request_id).toMatch(/^[\da-f-]{36}$/);
      submitted++;
      videos = [
        {
          ...body,
          id: "synthetic-generated-video",
          model: "seedance-synthetic",
          remote_id: "synthetic-task",
          status: "succeeded",
          size: media.length,
          created: 1793721600,
          error: "",
        },
      ];
      return route.fulfill({ status: 201, json: videos[0] });
    }
    if (request.method() === "PATCH") {
      videos[0].title = request.postDataJSON().title;
      return route.fulfill({ json: videos[0] });
    }
    if (request.method() === "DELETE") {
      videos = [];
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { items: videos, total: videos.length } });
  });
  await login(page);
  await page
    .getByRole("button", { name: "科学 · 水循环", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: /我同意将提示词发送至 Seedance/ })
    .check();
  await page.getByRole("button", { name: "生成教学视频", exact: true }).click();
  await expect(page.locator(".seedance-card")).toHaveCount(1);
  expect(submitted).toBe(1);
  await page.getByRole("button", { name: "预览成片" }).click();
  await expect(page.locator("video")).toHaveAttribute(
    "src",
    /seedance\/videos\/.*\/media/,
  );
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((node: HTMLVideoElement) => node.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  const event = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载视频" }).click();
  expect(await readFile((await (await event).path())!)).toEqual(media);
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByLabel("新作品名称").fill("我的科学短片");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的科学短片" }),
  ).toBeVisible();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "删除作品", exact: true }).click();
  await page.getByRole("button", { name: "确认删除作品" }).click();
  await expect(page.locator(".seedance-card")).toHaveCount(0);
});
