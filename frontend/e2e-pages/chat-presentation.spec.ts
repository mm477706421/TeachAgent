import { test, expect } from "@playwright/test";

test("published demo types and renders Markdown without model requests", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");
  await page
    .getByRole("button", { name: "二次函数的图像与性质", exact: true })
    .click();
  await page.getByRole("button", { name: "AI 追问", exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page
    .getByRole("button", { name: "某个环节为何互动偏少，可以怎么改？" })
    .click();
  const answer = page.locator(".assistant-reply");
  await expect(answer).toHaveAttribute("data-typing", "true");
  await page.clock.runFor(600);
  await expect(answer.getByRole("heading", { name: "课堂观察" })).toBeVisible();
  await expect(answer).not.toContainText("本地部署登录后");
  await page.getByRole("button", { name: "立即显示全文" }).click();
  await expect(answer).toHaveAttribute("data-typing", "false");
  await expect(answer.locator("ol > li")).toHaveCount(2);
  await expect(answer.locator("blockquote")).toBeVisible();
  await expect(answer).toContainText("本地部署登录后");
  expect(requests.filter((url) => url.includes("/api/"))).toEqual([]);
});
