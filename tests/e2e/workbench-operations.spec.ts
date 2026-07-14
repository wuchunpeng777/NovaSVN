import { expect, test } from "@playwright/test";
import { backendCalls, installWorkbenchBackendMock } from "./tauri-backend-mock";

test("runs the main working-copy operations through the task workflow", async ({ page }) => {
  await page.goto("/");
  await installWorkbenchBackendMock(page);
  await page.getByPlaceholder("拖入或输入 SVN 工作副本路径").fill("C:/repo/wc");
  await page.getByRole("button", { name: "打开", exact: true }).click();

  await expect(
    page.getByRole("main", { name: "本地改动" }).getByText("C:/repo/wc", { exact: true }),
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

  await page.getByRole("button", { name: "打开提交表单" }).click();
  const commitMessage = page.getByPlaceholder("提交信息");
  await expect(commitMessage).toBeFocused();
  await commitMessage.fill("E2E commit");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await expect.poll(async () => (await backendCalls(page, "create_commit_task")).length).toBe(1);

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

  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByPlaceholder("源 URL").fill("https://example.com/svn/branches/feature");
  await page.getByPlaceholder("起始 revision").fill("10");
  await page.getByPlaceholder("结束 revision").fill("12");
  await page.getByRole("button", { name: "Dry-run", exact: true }).click();
  await expect.poll(async () => (await backendCalls(page, "create_merge_task")).length).toBe(1);
  await expect(page.getByText("Dry-run 预览")).toBeVisible();

  await page.getByRole("button", { name: "工作副本", exact: true }).click();
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
