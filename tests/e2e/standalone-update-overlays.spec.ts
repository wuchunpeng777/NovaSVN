import { expect, test, type Locator } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const now = 1_725_000_000_000;
    const updateTask = {
      task_id: "update-overlay-e2e",
      title: "更新工作副本",
      status: "success",
      error: null,
      logs: [
        { message: "SVN 操作开始执行", created_at: now },
        { message: "U    src/main.ts", created_at: now + 1 },
        { message: "Updated to revision 21.", created_at: now + 2 },
      ],
      result: null,
      created_at: now,
      updated_at: now + 2,
    };

    async function invoke(command: string, args: Record<string, unknown> = {}) {
      const request = (args.request ?? {}) as Record<string, unknown>;
      let data: unknown;
      switch (command) {
        case "get_startup_intent":
          data = { action: "update", path: "C:\\repo" };
          break;
        case "configure_svn_authentication":
          data = null;
          break;
        case "inspect_update_target":
          data = {
            target_path: "C:\\repo",
            working_copy_root: "C:\\repo",
            relative_path: null,
            repository_url: "https://example.com/svn/trunk",
            revision: "20",
            kind: "dir",
          };
          break;
        case "create_svn_operation_task":
        case "get_task":
          data = updateTask;
          break;
        case "scan_workspace_status":
          data = {
            working_copy_root: "C:\\repo",
            total: 0,
            returned: 0,
            offset: 0,
            limit: 5000,
            revision_range: "21",
            mixed_revision: false,
            remote_updates_checked: false,
            repository_revision: null,
            local_changes: 0,
            remote_changes: 0,
            combined_changes: 0,
            modified: 0,
            added: 0,
            deleted: 0,
            missing: 0,
            unversioned: 0,
            conflicted: 0,
            obstructed: 0,
            property_changed: 0,
            files: [],
          };
          break;
        case "get_file_diff":
          data = {
            path: request.file_path,
            text: "@@ -1 +1 @@\n-const value = 1;\n+const value = 2;",
            binary: false,
            empty: false,
          };
          break;
        case "get_file_content_diff":
          data = {
            path: request.file_path,
            original_text: "const value = 1;",
            modified_text: "const value = 2;",
            language: "typescript",
            binary: false,
            too_large: false,
            max_bytes: 512 * 1024,
          };
          break;
        case "get_svn_log":
          data = {
            target: request.file_path,
            has_more: false,
            next_start_revision: null,
            entries: [
              {
                revision: "20",
                author: "dev",
                date: "2026-01-01T00:00:00Z",
                message: "修改 main.ts",
                changed_paths: [],
              },
            ],
          };
          break;
        default:
          throw new Error(`未处理的 E2E 命令：${command}`);
      }
      return { ok: true, data };
    }

    Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
  });
});

test("keeps the file menu and Log dialog above the Monaco diff", async ({ page }) => {
  await page.goto("/");

  const updatedFile = page.getByRole("button", { name: "查看修改 src/main.ts" });
  await expect(updatedFile).toBeVisible();
  await updatedFile.click();
  await expect(page.locator(".monaco-diff-viewer")).toBeVisible();

  await updatedFile.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 360,
      clientY: 470,
      view: window,
    }));
  });
  const menu = page.getByRole("menu", { name: "文件菜单 src/main.ts" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("z-index", "3000");
  await expect(menu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await topElementBelongsTo(menu)).toBe(true);
  await page.screenshot({ path: "test-results/standalone-update-context-menu.png" });

  await menu.getByRole("menuitem", { name: "显示 Log" }).click();
  const dialog = page.getByRole("dialog", { name: "文件 Log src/main.ts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".file-log-backdrop")).toHaveCSS("z-index", "3100");
  expect(await topElementBelongsTo(dialog)).toBe(true);

  await page.screenshot({ path: "test-results/standalone-update-overlays.png" });
});

async function topElementBelongsTo(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + Math.min(box.height / 2, 18),
    );
    return Boolean(top && (element === top || element.contains(top)));
  });
}
