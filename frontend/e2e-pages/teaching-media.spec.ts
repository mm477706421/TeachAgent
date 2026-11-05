import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { calculate } from "../src/simulationEngine";

test("physics formulas use the same time and SI units", () => {
  const pendulum = calculate(
    { kind: "pendulum", params: { length: 1, gravity: 9.8, angle: 10 } },
    0,
  );
  expect(pendulum.metrics[0].value).toBeCloseTo(10, 8);
  expect(pendulum.metrics[2].value).toBeCloseTo(
    (2 * Math.PI) / Math.sqrt(9.8),
    8,
  );
  const projectile = calculate(
    { kind: "projectile", params: { height: 20, speed: 10, gravity: 10 } },
    1,
  );
  expect(projectile.x).toBe(10);
  expect(projectile.y).toBe(15);
  expect(
    calculate(
      { kind: "projectile", params: { height: 20, speed: 10, gravity: 10 } },
      100,
    ).y,
  ).toBe(0);
  const spring = calculate(
    { kind: "spring", params: { mass: 1, stiffness: 10, amplitude: 0.3 } },
    0,
  );
  expect(spring.metrics[3].value).toBeCloseTo(0.45, 8);
  const rc = calculate(
    { kind: "rc", params: { voltage: 6, resistance: 2, capacitance: 1000 } },
    2,
  );
  expect(rc.metrics[0].value).toBeCloseTo(6 * (1 - Math.exp(-1)), 8);
});

test("science demo animates synchronized parameters and exports a functioning offline model", async ({
  page,
  browser,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.url());
  });
  await page.goto("./");
  await page.getByRole("button", { name: "理科动态模型", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "原理看得见，参数跟着动。" }),
  ).toBeVisible();
  await page.getByLabel("模型类型").selectOption("projectile");
  await page.getByLabel("重力加速度（m/s²）").fill("10");
  await page.getByLabel("时间轴").fill("1");
  await expect(page.getByTestId("simulation-time")).toHaveText("t = 1.00 s");
  await expect(page.locator(".science-values")).toContainText("15.000 m");
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await expect(page.getByTestId("simulation-time")).not.toHaveText(
    "t = 1.00 s",
  );
  await page.getByRole("button", { name: "暂停动画", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出可动模型 HTML" }).click();
  const file = await event;
  const html = await readFile((await file.path())!, "utf8");
  const offline = await browser.newPage();
  const errors: string[] = [];
  offline.on("pageerror", (e) => errors.push(e.message));
  await offline.setContent(html);
  await offline.locator("#time").fill("1");
  await expect(offline.locator("#values")).toContainText("距地高度: 15.000 m");
  expect(errors).toEqual([]);
  await offline.close();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "../docs/images/science-models.png",
    fullPage: true,
  });
  expect(requests).toEqual([]);
});

test("URL download and story/local-compute demos never submit requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.url());
  });
  await page.goto("./");
  await page.getByRole("button", { name: "网址视频下载", exact: true }).click();
  await page.getByLabel("视频名称", { exact: true }).fill("合成示例");
  await page
    .getByLabel("视频网址", { exact: true })
    .fill("https://example.com/video.mp4");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "添加网址下载" }).click();
  await expect(page.locator(".toast")).toContainText("演示不下载真实视频");
  await page.getByRole("button", { name: "教学视频生成", exact: true }).click();
  await page
    .getByText("从历史 / 语文 / 政治课程编排故事", { exact: true })
    .click();
  await page.getByLabel("故事学科").selectOption("语文");
  await page
    .getByLabel("课程内容与故事依据")
    .fill("根据守株待兔的寓言讲解勤劳和偶然收获的区别。");
  await page.getByRole("button", { name: "编排故事提示词" }).click();
  await expect(page.getByLabel("画面描述", { exact: true })).toHaveValue(
    /守株待兔/,
  );
  await page.getByLabel("视频生成算力").selectOption("comfyui");
  await expect(
    page.getByRole("heading", { name: "连接自己的本地算力" }),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(requests).toEqual([]);
});
