import { expect, test } from "@playwright/test";

test("loads the current NovaSVN workbench shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("NovaSVN", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "工作副本" })).toBeVisible();
  await expect(page.getByRole("button", { name: "时间线" })).toBeVisible();
  await expect(page.getByRole("button", { name: "仓库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "更多" })).toBeVisible();
  await expect(page.getByRole("button", { name: "更新" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清理" })).toBeVisible();
});

test("uses SVN commit targets without a staging view", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "全部文件" })).toBeVisible();
  await expect(page.getByRole("button", { name: "变化文件" })).toBeVisible();
  await expect(page.getByRole("button", { name: "未管理文件" })).toBeVisible();
  await expect(page.getByText("提交目标", { exact: true })).toBeVisible();
  await expect(page.getByText("本次将提交 0 个文件", { exact: true })).toBeVisible();
  await expect(page.getByText("暂存", { exact: false })).toHaveCount(0);
});
