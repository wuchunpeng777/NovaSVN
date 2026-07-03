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

test("exposes partial commit and shadow workspace workflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "提交选中 Hunk" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "影子工作副本" })).toBeVisible();
  await expect(page.getByRole("button", { name: "检查" })).toBeVisible();
  await expect(page.getByRole("button", { name: "准备" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重建" })).toBeVisible();
});
