import { expect, test } from "@playwright/test";
import { backendCalls, installWorkbenchBackendMock } from "./tauri-backend-mock";

test("runs the main working-copy operations through the task workflow", async ({ page }) => {
  await page.goto("/");
  await installWorkbenchBackendMock(page);
  await page.getByPlaceholder("拖入或输入 SVN 工作副本路径").fill("C:/repo/wc");
  await page.getByRole("button", { name: "打开", exact: true }).click();

  await expect(
    page.getByRole("main", { name: "本地改动" }).locator(".pane-header").getByText("C:/repo/wc", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add draft.txt" })).toBeVisible();

  await page.getByRole("button", { name: "Add draft.txt" }).click();
  await expect
    .poll(async () => (await backendCalls(page, "create_svn_operation_task")).length)
    .toBe(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "更多操作 文件 src/delete.txt" }).click();
  await page.getByRole("menuitem", { name: "删除文件 src/delete.txt" }).click();
  await expect
    .poll(async () => (await backendCalls(page, "create_svn_operation_task")).length)
    .toBe(2);

  await page.getByRole("button", { name: "打开提交窗口" }).click();
  await expect.poll(async () => (await backendCalls(page, "launch_commit_window")).length).toBe(1);
  expect((await backendCalls(page, "launch_commit_window"))[0]?.args.request).toMatchObject({
    target_path: "C:/repo/wc",
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "更多操作 文件 src/revert.txt" }).click();
  await page.getByRole("menuitem", { name: "撤销文件 src/revert.txt" }).click();
  await expect
    .poll(async () => (await backendCalls(page, "create_svn_operation_task")).length)
    .toBe(3);

  await page.getByRole("button", { name: "Update src/remote.txt" }).click();
  await expect
    .poll(async () => (await backendCalls(page, "create_svn_operation_task")).length)
    .toBe(4);

  await page.getByRole("button", { name: "应用 Patch" }).click();
  const patchDialog = page.getByRole("dialog", { name: "应用 Patch" });
  await expect(patchDialog.getByText("预检通过")).toBeVisible();
  await patchDialog.getByRole("button", { name: "应用 Patch" }).click();
  await expect
    .poll(async () => (await backendCalls(page, "create_apply_patch_task")).length)
    .toBe(2);
  await expect(patchDialog.getByText("Patch 已应用")).toBeVisible();

  const operationCalls = await backendCalls(page, "create_svn_operation_task");
  expect(operationCalls.map((call) => call.args.request)).toMatchObject([
    { kind: "add_file", file_path: "draft.txt" },
    { kind: "delete_path", file_path: "src/delete.txt" },
    { kind: "revert_file", file_path: "src/revert.txt" },
    { kind: "update_path", file_path: "src/remote.txt" },
  ]);
});

test("scopes the file list and commit selection to the selected folder", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await installWorkbenchBackendMock(page);
  await page.getByPlaceholder("拖入或输入 SVN 工作副本路径").fill("C:/repo/wc");
  await page.getByRole("button", { name: "打开", exact: true }).click();

  await page.getByRole("button", { name: "选择文件夹 src" }).click();
  await expect(page.getByRole("treegrid", { name: "工作副本文件列表" })).not.toContainText(
    "draft.txt",
  );
  await expect(page.getByRole("button", { name: "Update src", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加入 Commit 文件夹 src" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "移出 Commit 文件夹 src" })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "提交目标 src/modified.txt" }).click();
  await page.getByRole("checkbox", { name: "提交目标 src/revert.txt" }).click();
  await page.getByRole("button", { name: "打开提交窗口" }).click();

  const commitCalls = await backendCalls(page, "launch_commit_window");
  expect(commitCalls[0]?.args.request).toMatchObject({
    target_path: "C:/repo/wc",
  });
});
