import { expect, test } from "@playwright/test";

test("loads the current NovaSVN workbench shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("NovaSVN", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "工作副本", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "时间线", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "仓库", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更多", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更新工作副本" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清理工作副本" })).toBeVisible();
});

test("provides hover tooltips for every button", async ({ page }) => {
  await page.goto("/");

  const tooltipTargets = page.locator('button, [role="button"]');
  expect(await tooltipTargets.count()).toBeGreaterThan(0);
  await expect(page.locator('button:not([title]), [role="button"]:not([title])')).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "工作副本", exact: true })).toHaveAttribute(
    "title",
    "工作副本",
  );
  await expect(page.getByRole("button", { name: "更新工作副本" })).toHaveAttribute(
    "title",
    "更新工作副本",
  );
});

test("uses SVN commit targets without a staging view", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "全部文件" })).toBeVisible();
  await expect(page.getByRole("button", { name: "本地改动" })).toBeVisible();
  await expect(page.getByRole("button", { name: "远端更新" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "未管理文件" })).toBeVisible();
  await expect(page.getByRole("region", { name: "工作副本摘要" })).toContainText("提交目标");
  await page.getByRole("tab", { name: "Commit" }).click();
  await expect(page.getByText("本次将提交 0 个文件", { exact: true })).toBeVisible();
  await expect(page.getByText("暂存", { exact: false })).toHaveCount(0);
});
