import type { Page } from "@playwright/test";

export interface BackendCall {
  command: string;
  args: Record<string, unknown>;
}

export async function installWorkbenchBackendMock(page: Page) {
  await page.evaluate(() => {
    const calls: BackendCall[] = [];
    const tasks: Array<Record<string, unknown>> = [];
    let nextTaskId = 1;
    const now = 1_725_000_000_000;
    const changedFiles = [
      changedFile("src/modified.txt", "modified", "local"),
      changedFile("src/revert.txt", "modified", "local"),
      changedFile("draft.txt", "unversioned", "local", null),
      changedFile("src/remote.txt", "normal", "remote"),
    ];
    const status = {
      working_copy_root: "C:/repo/wc",
      total: changedFiles.length,
      returned: changedFiles.length,
      offset: 0,
      limit: 500,
      revision_range: "12",
      mixed_revision: false,
      remote_updates_checked: true,
      repository_revision: "13",
      local_changes: 3,
      remote_changes: 1,
      combined_changes: 0,
      modified: 2,
      added: 0,
      deleted: 0,
      missing: 0,
      unversioned: 1,
      conflicted: 0,
      obstructed: 0,
      property_changed: 0,
      files: changedFiles,
    };
    const tree = {
      working_copy_root: "C:/repo/wc",
      total_files: 6,
      returned_files: 6,
      truncated: false,
      nodes: [
        treeNode("src", "src", "dir", "normal", "local", null, [
          treeNode("src/modified.txt", "modified.txt", "file", "modified", "local"),
          treeNode("src/revert.txt", "revert.txt", "file", "modified", "local"),
          treeNode("src/remote.txt", "remote.txt", "file", "normal", "remote", "modified"),
          treeNode("src/delete.txt", "delete.txt", "file", "normal", "none"),
        ]),
        treeNode("draft.txt", "draft.txt", "file", "unversioned", "local", null, [], false),
      ],
    };

    function changedFile(
      path: string,
      itemStatus: string,
      changeScope: string,
      revision: string | null = "12",
    ) {
      return {
        path,
        status: itemStatus,
        revision,
        property_status: null,
        property_changed: false,
        remote_status: changeScope === "remote" ? "modified" : null,
        remote_property_status: null,
        change_scope: changeScope,
        abnormal: false,
        lock_state: "none",
        lock_owner: null,
        lock_comment: null,
        conflict_kind: null,
        file_size: 32,
        content_digest: `${path}-digest`,
      };
    }

    function treeNode(
      path: string,
      name: string,
      kind: "file" | "dir",
      itemStatus: string,
      changeScope: string,
      remoteStatus: string | null = null,
      children: Array<Record<string, unknown>> = [],
      versioned = true,
    ) {
      return {
        path,
        name,
        kind,
        status: itemStatus,
        revision: versioned ? "12" : null,
        base_revision: versioned ? "12" : null,
        last_revision: versioned ? "12" : null,
        last_changed_date: versioned ? "2026-07-11T01:02:03Z" : null,
        last_changed_author: versioned ? "dev" : null,
        remote_status: remoteStatus,
        remote_property_status: null,
        change_scope: changeScope,
        file_size: kind === "file" ? 32 : null,
        changed: changeScope !== "none",
        versioned,
        children,
      };
    }

    function taskResult(overrides: Record<string, unknown> = {}) {
      return {
        repository_list: null,
        repository_file: null,
        repository_export: null,
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
        ...overrides,
      };
    }

    function createTask(command: string, args: Record<string, unknown>) {
      const request = (args.request ?? {}) as Record<string, unknown>;
      const taskId = `e2e-task-${nextTaskId++}`;
      let result: Record<string, unknown> | null = null;
      if (command === "create_merge_task") {
        result = taskResult({
          merge_result: {
            dry_run: request.dry_run,
            source_url: request.source_url,
            revision_range: `${request.start_revision}:${request.end_revision}`,
            record_only: request.record_only,
            ignore_ancestry: request.ignore_ancestry,
            force: request.force,
            output_text: "U    src/modified.txt",
            output_truncated: false,
            max_output_bytes: 256 * 1024,
            file_count: 1,
            line_count: 1,
            added: 0,
            deleted: 0,
            updated: 1,
            conflicted: 0,
          },
        });
      } else if (command === "create_apply_patch_task") {
        result = taskResult({
          apply_patch_result: {
            dry_run: request.dry_run,
            patch_file_path: request.patch_file_path,
            patch_digest: "a".repeat(64),
            output_text: "U    src/modified.txt",
            output_truncated: false,
            max_output_bytes: 256 * 1024,
            applied: 1,
            offset_hunks: 0,
            rejected: 0,
            skipped: 0,
            conflicted: 0,
          },
        });
      }
      const task = {
        task_id: taskId,
        title: command,
        status: "success",
        logs: [{ message: `${command} completed`, created_at: now }],
        error: null,
        result,
        created_at: now,
        updated_at: now,
      };
      tasks.unshift(task);
      return task;
    }

    async function invoke(command: string, args: Record<string, unknown> = {}) {
      calls.push({ command, args });
      if (command === "plugin:dialog|open") {
        return "C:/patches/change.patch";
      }

      let data: unknown;
      switch (command) {
        case "open_workspace":
          data = {
            local_path: "C:/repo/wc",
            working_copy_root: "C:/repo/wc",
            repository_url: "https://example.com/svn/trunk",
            repository_root: "https://example.com/svn",
            revision: "12",
          };
          break;
        case "scan_workspace_status":
          data = status;
          break;
        case "list_workspace_files":
          data = tree;
          break;
        case "get_file_diff":
          data = {
            path: ((args.request as Record<string, unknown>)?.file_path as string) ?? "",
            text: "--- before\n+++ after",
            binary: false,
            empty: false,
          };
          break;
        case "get_file_content_diff":
          data = {
            path: ((args.request as Record<string, unknown>)?.file_path as string) ?? "",
            language: "plaintext",
            base_text: "before\n",
            working_text: "after\n",
            binary: false,
            too_large: false,
            max_bytes: 512 * 1024,
          };
          break;
        case "parse_unified_diff":
          data = { files: [] };
          break;
        case "sync_app_menu_state":
          data = null;
          break;
        case "list_tasks":
          data = {
            tasks: tasks.map(({ logs: _logs, result: _result, ...summary }) => summary),
            running_task_id: null,
          };
          break;
        case "get_task":
          data = tasks.find((task) => task.task_id === args.taskId);
          break;
        case "create_svn_operation_task":
        case "create_commit_task":
        case "create_merge_task":
        case "create_apply_patch_task":
          data = createTask(command, args);
          break;
        default:
          throw {
            code: "E2E_COMMAND_UNHANDLED",
            message: `E2E mock 未处理命令：${command}`,
            detail: null,
            recoverable: false,
          };
      }
      return { ok: true, data };
    }

    Object.assign(window, {
      __NOVASVN_E2E_CALLS__: calls,
      __TAURI_INTERNALS__: { invoke },
    });
  });
}

export async function backendCalls(page: Page, command?: string): Promise<BackendCall[]> {
  return page.evaluate((targetCommand) => {
    const calls = (window as typeof window & { __NOVASVN_E2E_CALLS__?: BackendCall[] })
      .__NOVASVN_E2E_CALLS__ ?? [];
    return targetCommand ? calls.filter((call) => call.command === targetCommand) : calls;
  }, command);
}
