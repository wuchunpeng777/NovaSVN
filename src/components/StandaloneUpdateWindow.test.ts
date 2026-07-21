import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  getFileContentDiff: vi.fn(),
  getFileDiff: vi.fn(),
  getSvnLog: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  openWorkspaceFile: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

import {
  createSvnOperationTask,
  getFileContentDiff,
  getFileDiff,
  getSvnLog,
  getTask,
  inspectUpdateTarget,
  openWorkspaceFile,
  scanWorkspaceStatus,
} from "../lib/api";
import type { ChangedFile, Task, WorkingCopyStatus } from "../types/api";
import StandaloneUpdateWindow from "./StandaloneUpdateWindow.svelte";

const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const getFileContentDiffMock = vi.mocked(getFileContentDiff);
const getFileDiffMock = vi.mocked(getFileDiff);
const getSvnLogMock = vi.mocked(getSvnLog);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const openWorkspaceFileMock = vi.mocked(openWorkspaceFile);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(() => {
  createSvnOperationTaskMock.mockReset();
  getFileContentDiffMock.mockReset();
  getFileDiffMock.mockReset();
  getSvnLogMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  openWorkspaceFileMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  inspectUpdateTargetMock.mockResolvedValue(makeTarget());
  createSvnOperationTaskMock.mockResolvedValue(makeTask("pending"));
  getTaskMock.mockResolvedValue(
    makeTask("success", ["SVN 操作开始执行", "U    src/main.ts", "Updated to revision 21."]),
  );
  scanWorkspaceStatusMock.mockResolvedValue(makeStatus());
  getFileContentDiffMock.mockResolvedValue({
    path: "src/main.ts",
    original_text: "const value = 1;",
    modified_text: "const value = 1;",
    language: "typescript",
    binary: false,
    too_large: false,
    max_bytes: 512 * 1024,
  });
  getFileDiffMock.mockResolvedValue({
    path: "src/main.ts",
    text: "@@ -1 +1 @@\n-const value = 1;\n+const value = 2;",
    binary: false,
    empty: false,
  });
  getSvnLogMock.mockResolvedValue({
    target: "src/main.ts",
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
  });
});

describe("StandaloneUpdateWindow", () => {
  it("打开后自动更新右键选中的文件并展示更新内容", async () => {
    render(StandaloneUpdateWindow, {
      props: {
        targetPath: "C:\\repo\\src\\main.ts",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(inspectUpdateTargetMock).toHaveBeenCalledWith({
        path: "C:\\repo\\src\\main.ts",
        svn_executable: "C:\\Tools\\svn.exe",
      });
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "update_path",
        file_path: "src/main.ts",
        svn_executable: "C:\\Tools\\svn.exe",
      });
    });
    const output = screen.getByLabelText("更新内容");
    expect(await within(output).findByText("src/main.ts")).toBeInTheDocument();
    expect(screen.queryByText("SVN 操作开始执行")).not.toBeInTheDocument();
    expect(screen.queryByText("Updated to revision 21.")).not.toBeInTheDocument();
    expect(screen.getByText("更新完成")).toBeInTheDocument();
    expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\repo",
      svn_executable: "C:\\Tools\\svn.exe",
      offset: 0,
      limit: 5000,
      check_remote_updates: false,
    });
  });

  it("工作副本根目录使用完整 Update", async () => {
    inspectUpdateTargetMock.mockResolvedValue(makeTarget({ relative_path: null }));
    render(StandaloneUpdateWindow, { props: { targetPath: "C:\\repo" } });

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "update",
        file_path: undefined,
        svn_executable: undefined,
      });
    });
  });

  it("点击更新文件查看修改内容", async () => {
    render(StandaloneUpdateWindow, { props: { targetPath: "C:\\repo" } });

    await fireEvent.click(await screen.findByRole("button", { name: "查看修改 src/main.ts" }));

    await waitFor(() => {
      expect(getFileDiffMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        file_path: "src/main.ts",
        svn_executable: undefined,
      });
      expect(getFileContentDiffMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        file_path: "src/main.ts",
        svn_executable: undefined,
        max_bytes: 512 * 1024,
      });
    });
    expect(screen.getByLabelText("修改内容")).toHaveTextContent("@@ -1 +1 @@");
  });

  it("右键更新文件后可打开该文件 Log", async () => {
    render(StandaloneUpdateWindow, { props: { targetPath: "C:\\repo" } });
    const file = await screen.findByRole("button", { name: "查看修改 src/main.ts" });

    await fireEvent.contextMenu(file, { clientX: 220, clientY: 180 });
    const menu = screen.getByRole("menu", { name: "文件菜单 src/main.ts" });
    const updateWindow = screen.getByLabelText("NovaSVN Update");
    expect(updateWindow).toContainElement(menu);
    await fireEvent.click(within(menu).getByRole("menuitem", { name: "显示 Log" }));

    await waitFor(() => {
      expect(getSvnLogMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        file_path: "src/main.ts",
        svn_executable: undefined,
        limit: 50,
      });
    });
    const dialog = await screen.findByRole("dialog", { name: "文件 Log src/main.ts" });
    expect(updateWindow).toContainElement(dialog);
    expect(within(dialog).getByText("r20")).toBeInTheDocument();
    expect(within(dialog).getByText("修改 main.ts")).toBeInTheDocument();
  });

  it("展示冲突并完成手动编辑和仓库版本处理", async () => {
    const conflict = makeConflict();
    const unrelatedConflict = makeConflict({ path: "other/conflict.ts" });
    inspectUpdateTargetMock.mockResolvedValue(
      makeTarget({
        target_path: "C:\\repo\\src",
        relative_path: "src",
        repository_url: "https://example.com/svn/trunk/src",
        kind: "dir",
      }),
    );
    createSvnOperationTaskMock
      .mockResolvedValueOnce(makeTask("pending"))
      .mockResolvedValueOnce(
        makeTask("pending", [], { task_id: "resolve-1", title: "使用 theirs 解决 src/conflict.ts" }),
      );
    getTaskMock
      .mockResolvedValueOnce(makeTask("success", ["C    src/conflict.ts"]))
      .mockResolvedValueOnce(
        makeTask("success", ["Resolved conflicted state of 'src/conflict.ts'"], {
          task_id: "resolve-1",
          title: "使用 theirs 解决 src/conflict.ts",
        }),
      );
    scanWorkspaceStatusMock
      .mockResolvedValueOnce(
        makeStatus({
          conflicted: 2,
          total: 2,
          returned: 2,
          files: [conflict, unrelatedConflict],
        }),
      )
      .mockResolvedValueOnce(makeStatus());
    openWorkspaceFileMock.mockResolvedValue({ target_path: "C:\\repo\\src\\conflict.ts" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(StandaloneUpdateWindow, { props: { targetPath: "C:\\repo\\src" } });

    const pane = await screen.findByLabelText("冲突处理");
    expect(await within(pane).findByText("src/conflict.ts")).toBeInTheDocument();
    expect(within(pane).getByText("文本冲突")).toBeInTheDocument();
    expect(within(pane).queryByText("other/conflict.ts")).not.toBeInTheDocument();

    await fireEvent.click(within(pane).getByRole("button", { name: "打开" }));
    expect(openWorkspaceFileMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\repo",
      file_path: "src/conflict.ts",
    });

    await fireEvent.click(within(pane).getByRole("button", { name: "采用仓库版本" }));
    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenLastCalledWith({
        working_copy_root: "C:\\repo",
        kind: "resolve_theirs_full",
        file_path: "src/conflict.ts",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      "采用仓库完整版本处理冲突吗？\nsrc/conflict.ts",
    );
    expect(await screen.findByText("工作副本没有未解决冲突")).toBeInTheDocument();
    expect(screen.getByLabelText("冲突处理记录")).toHaveTextContent("完成");
  });

  it("目标检查失败时显示后端错误", async () => {
    inspectUpdateTargetMock.mockRejectedValue({
      code: "WORKSPACE_NOT_SVN",
      message: "该目录不是可用的 SVN 工作副本",
      detail: "svn info 失败",
      recoverable: true,
    });
    render(StandaloneUpdateWindow, { props: { targetPath: "C:\\plain" } });

    const alert = await screen.findByRole("alert", { name: "命令错误" });
    expect(alert).toHaveTextContent("该目录不是可用的 SVN 工作副本");
    expect(alert).toHaveTextContent("svn info 失败");
    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
  });
});

function makeTarget(overrides = {}) {
  return {
    target_path: "C:\\repo\\src\\main.ts",
    working_copy_root: "C:\\repo",
    relative_path: "src/main.ts",
    repository_url: "https://example.com/svn/trunk/src/main.ts",
    revision: "20",
    kind: "file",
    ...overrides,
  };
}

function makeTask(
  status: Task["status"],
  messages: string[] = [],
  overrides: Partial<Task> = {},
): Task {
  return {
    task_id: "update-1",
    title: "更新路径 src/main.ts",
    status,
    error: null,
    logs: messages.map((message, index) => ({ message, created_at: index + 1 })),
    result: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function makeStatus(overrides: Partial<WorkingCopyStatus> = {}): WorkingCopyStatus {
  return {
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
    ...overrides,
  };
}

function makeConflict(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: "src/conflict.ts",
    status: "conflicted",
    revision: "20",
    property_status: null,
    property_changed: false,
    remote_status: null,
    remote_property_status: null,
    change_scope: "local",
    abnormal: true,
    lock_state: "none",
    lock_owner: null,
    lock_comment: null,
    conflict_kind: "text",
    file_size: 100,
    content_digest: "conflict-digest",
    ...overrides,
  };
}
