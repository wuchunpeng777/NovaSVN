import { expect, test } from "@playwright/test";
import { backendCalls, installWorkbenchBackendMock } from "./tauri-backend-mock";

test("prompts for credentials and retries a failed status refresh", async ({ page }) => {
  await page.goto("/");
  await installWorkbenchBackendMock(page);
  await page.getByPlaceholder("拖入或输入 SVN 工作副本路径").fill("C:/repo/wc");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect(
    page.getByRole("main", { name: "本地改动" }).locator(".pane-header").getByText("C:/repo/wc", { exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    const runtime = window as typeof window & {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    const originalInvoke = runtime.__TAURI_INTERNALS__.invoke;
    let rejectNextStatus = true;
    runtime.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "scan_workspace_status" && rejectNextStatus) {
        rejectNextStatus = false;
        throw {
          code: "SVN_STATUS_COMMAND_FAILED",
          message: "SVN 状态读取失败",
          detail:
            "svn: E170013: Unable to connect to a repository at URL 'https://alice%40example.com@svn.example.test/repo' svn: E215004: No more credentials or we tried too many times. Authentication failed",
          recoverable: true,
        };
      }
      return originalInvoke(command, args);
    };
  });

  await page.getByRole("button", { name: "刷新工作副本状态" }).click();
  const dialog = page.getByRole("dialog", { name: "登录 SVN" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("用户名")).toHaveValue("alice@example.com");
  await dialog.getByLabel("密码").fill("current-secret");
  await dialog.getByRole("button", { name: "登录并重试" }).click();

  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () => (await backendCalls(page, "configure_svn_authentication")).length)
    .toBe(1);
  await expect.poll(async () => (await backendCalls(page, "scan_workspace_status")).length).toBe(2);
});
