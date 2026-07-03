import { expect, test } from "@playwright/test";

test("loads the NovaSVN workbench shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "NovaSVN" })).toBeVisible();
  await expect(page.getByRole("button", { name: /工作区/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /设置/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "连接后端" })).toBeVisible();
  await expect(page.getByText("提交区")).toBeVisible();
  await expect(page.getByText("任务队列")).toBeVisible();
});
