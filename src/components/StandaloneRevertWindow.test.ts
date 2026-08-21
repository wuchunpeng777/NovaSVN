import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeWindowMock } = vi.hoisted(() => ({ closeWindowMock: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeWindowMock }),
}));

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  createSvnBatchOperationTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  launchConflictWindow: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

import {
  createSvnBatchOperationTask,
  createSvnOperationTask,
  getTask,
  inspectUpdateTarget,
  scanWorkspaceStatus,
} from "../lib/api";
import type { ChangedFile, Task, WorkingCopyStatus } from "../types/api";
import StandaloneRevertWindow from "./StandaloneRevertWindow.svelte";

const createSvnBatchOperationTaskMock = vi.mocked(createSvnBatchOperationTask);
const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(() => {
  localStorage.clear();
  closeWindowMock.mockReset();
  closeWindowMock.mockResolvedValue(undefined);
  createSvnBatchOperationTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  createSvnOperationTaskMock.mockResolvedValue(makeTask("pending"));

  inspectUpdateTargetMock.mockResolvedValue({
    target_path: "C:\\repo\\src",
    working_copy_root: "C:\\repo",
    relative_path: "src",
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "20",
    kind: "dir",
  });
  scanWorkspaceStatusMock.mockResolvedValue(
    makeStatus([
      makeFile("src/main.ts", "modified"),
      makeFile("src/new.ts", "added"),
      makeFile("src/untracked.ts", "unversioned"),
      makeFile("other.ts", "modified"),
    ]),
  );
  createSvnBatchOperationTaskMock.mockResolvedValue(makeTask("pending"));
  getTaskMock.mockResolvedValue(makeTask("success"));
});

describe("StandaloneRevertWindow", () => {
  it("列出目标范围内的版本化修改并批量 Revert", async () => {
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });

    const pane = await screen.findByLabelText("选择 Revert 项目");
    expect(await within(pane).findByText("src/main.ts")).toBeInTheDocument();
    expect(within(pane).getByText("src/new.ts")).toBeInTheDocument();
    expect(within(pane).getByTitle("新增")).toHaveTextContent("A");
    expect(within(pane).queryByText("src/untracked.ts")).not.toBeInTheDocument();
    expect(within(pane).queryByText("other.ts")).not.toBeInTheDocument();
    expect(within(pane).getAllByRole("checkbox")).toHaveLength(2);
    expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\repo",
      scope_path: "src",
      include_content_digests: false,
      include_revision_summary: false,
      include_unversioned: false,
      svn_executable: undefined,
      offset: 0,
      limit: 5000,
      check_remote_updates: false,
    });

    await fireEvent.click(screen.getByRole("button", { name: "Revert 2 个项目" }));
    const dialog = screen.getByRole("dialog", { name: "确认 Revert" });
    expect(within(dialog).getByText("src/main.ts")).toBeInTheDocument();
    expect(within(dialog).getByText("src/new.ts")).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Revert" }));

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "revert_paths",
        file_paths: ["src/main.ts", "src/new.ts"],
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Revert 2 个项目");
  });

  it("只对当前勾选项目执行 Revert", async () => {
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });
    const pane = await screen.findByLabelText("选择 Revert 项目");
    await within(pane).findByText("src/main.ts");
    await fireEvent.click(within(pane).getByRole("checkbox", { name: "src/new.ts" }));

    await fireEvent.click(screen.getByRole("button", { name: "Revert 1 个项目" }));
    const dialog = screen.getByRole("dialog", { name: "确认 Revert" });
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Revert" }));

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ file_paths: ["src/main.ts"] }),
      );
    });
  });

  it("展示树冲突原因与解决操作，并允许纳入 Revert 选择", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus([
        makeFile("src/main.ts", "modified"),
        // Tree conflicts often keep a normal item; backend now maps normal+tree to conflicted,
        // but the UI must also accept conflict_kind even when status is still normal.
        makeFile("src/tree.ts", "normal", {
          abnormal: true,
          conflict_kind: "tree:update|delete|edit",
        }),
      ]),
    );
    getTaskMock.mockResolvedValue(makeTask("success"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });

    const pane = await screen.findByLabelText("选择 Revert 项目");
    expect(await within(pane).findByText("src/tree.ts")).toBeInTheDocument();
    expect(within(pane).getByText("树冲突 (更新)")).toBeInTheDocument();
    expect(within(pane).getByText("C")).toHaveAttribute("data-action", "C");
    expect(within(pane).getByText(/本地已删除/)).toBeInTheDocument();
    expect(within(pane).getByText(/1 个冲突（含树冲突）/)).toBeInTheDocument();
    expect(within(pane).getByRole("checkbox", { name: "src/tree.ts" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Revert 2 个项目" })).toBeEnabled();
    expect(within(pane).getByRole("button", { name: "保持删除 src/tree.ts" })).toBeEnabled();
    expect(within(pane).getByRole("button", { name: "恢复仓库版本 src/tree.ts" })).toBeEnabled();

    await fireEvent.click(within(pane).getByRole("button", { name: "恢复仓库版本 src/tree.ts" }));
    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "resolve_theirs_full",
        file_path: "src/tree.ts",
        svn_executable: undefined,
      });
    });
  });

  it("展示并 Revert 文件夹的 SVN 属性变更", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus([
        makeFile("src", "normal", {
          property_status: "modified",
          property_changed: true,
          file_size: null,
        }),
      ]),
    );
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });

    const pane = await screen.findByLabelText("选择 Revert 项目");
    expect(await within(pane).findByText("src")).toBeInTheDocument();
    expect(within(pane).getByTitle("属性修改")).toHaveTextContent("M");
    expect(within(pane).getByRole("checkbox", { name: "src" })).toBeChecked();

    await fireEvent.click(screen.getByRole("button", { name: "Revert 1 个项目" }));
    await fireEvent.click(
      within(screen.getByRole("dialog", { name: "确认 Revert" })).getByRole("button", {
        name: "确认 Revert",
      }),
    );

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "revert_paths",
        file_paths: ["src"],
        svn_executable: undefined,
      });
    });
  });

  it("空闲时 Escape 关闭窗口，确认框打开时只关闭确认框", async () => {
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });
    const pane = await screen.findByLabelText("选择 Revert 项目");
    await within(pane).findByText("src/main.ts");

    await fireEvent.click(screen.getByRole("button", { name: "Revert 2 个项目" }));
    expect(screen.getByRole("dialog", { name: "确认 Revert" })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "确认 Revert" })).not.toBeInTheDocument();
    expect(closeWindowMock).not.toHaveBeenCalled();

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(closeWindowMock).toHaveBeenCalledOnce();
  });

  it("勾选后在 Revert 成功且刷新完成后自动关闭窗口", async () => {
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });
    await screen.findByText("src/main.ts");

    const autoClose = screen.getByRole("checkbox", { name: "Revert 完成后自动关闭" });
    expect(autoClose).not.toBeChecked();
    await fireEvent.click(autoClose);
    await fireEvent.click(screen.getByRole("button", { name: "Revert 2 个项目" }));
    await fireEvent.click(
      within(screen.getByRole("dialog", { name: "确认 Revert" })).getByRole("button", {
        name: "确认 Revert",
      }),
    );

    await waitFor(() => expect(closeWindowMock).toHaveBeenCalledOnce());
    expect(getTaskMock).toHaveBeenCalledWith("revert-1");
    expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2);
  });

  it("持久化自动关闭选项，但没有可 Revert 文件时保持窗口打开", async () => {
    const first = render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });
    const autoClose = screen.getByRole("checkbox", { name: "Revert 完成后自动关闭" });

    await fireEvent.click(autoClose);

    expect(autoClose).toBeChecked();
    expect(localStorage.getItem("novasvn:revert-close-after-completion")).toBe("true");
    expect(closeWindowMock).not.toHaveBeenCalled();
    first.unmount();

    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });

    expect(screen.getByRole("checkbox", { name: "Revert 完成后自动关闭" })).toBeChecked();
    expect(await screen.findByRole("button", { name: "Revert 0 个项目" })).toBeDisabled();
    expect(createSvnBatchOperationTaskMock).not.toHaveBeenCalled();
    expect(closeWindowMock).not.toHaveBeenCalled();
  });

  it("Revert 完成后再勾选只保存下次偏好，不追溯关闭当前窗口", async () => {
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });
    await screen.findByText("src/main.ts");

    await fireEvent.click(screen.getByRole("button", { name: "Revert 2 个项目" }));
    await fireEvent.click(
      within(screen.getByRole("dialog", { name: "确认 Revert" })).getByRole("button", {
        name: "确认 Revert",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已 Revert 2 个项目");
    const autoClose = screen.getByRole("checkbox", { name: "Revert 完成后自动关闭" });
    await fireEvent.click(autoClose);

    expect(localStorage.getItem("novasvn:revert-close-after-completion")).toBe("true");
    expect(closeWindowMock).not.toHaveBeenCalled();
  });

  it("Revert 失败时即使勾选了自动关闭也不关窗口", async () => {
    getTaskMock.mockResolvedValue(makeTask("failed"));
    render(StandaloneRevertWindow, { props: { targetPath: "C:\\repo\\src" } });
    await screen.findByText("src/main.ts");

    await fireEvent.click(screen.getByRole("checkbox", { name: "Revert 完成后自动关闭" }));
    await fireEvent.click(screen.getByRole("button", { name: "Revert 2 个项目" }));
    await fireEvent.click(
      within(screen.getByRole("dialog", { name: "确认 Revert" })).getByRole("button", {
        name: "确认 Revert",
      }),
    );

    await waitFor(() => expect(getTaskMock).toHaveBeenCalledWith("revert-1"));
    expect(closeWindowMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/已 Revert/)).not.toBeInTheDocument();
  });
});

function makeTask(status: Task["status"]): Task {
  return {
    task_id: "revert-1",
    title: "撤销 2 个路径",
    status,
    error: null,
    logs: [{ message: "SVN 操作", created_at: 1 }],
    result: null,
    created_at: 1,
    updated_at: 2,
  };
}

function makeStatus(files: ChangedFile[]): WorkingCopyStatus {
  return {
    working_copy_root: "C:\\repo",
    total: files.length,
    returned: files.length,
    offset: 0,
    limit: 5000,
    revision_range: "20",
    mixed_revision: false,
    remote_updates_checked: false,
    repository_revision: null,
    local_changes: files.length,
    remote_changes: 0,
    combined_changes: files.length,
    modified: 2,
    added: 1,
    deleted: 0,
    missing: 0,
    unversioned: 1,
    conflicted: 0,
    obstructed: 0,
    property_changed: 0,
    files,
  };
}

function makeFile(path: string, status: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    status,
    revision: "20",
    property_status: null,
    property_changed: false,
    remote_status: null,
    remote_property_status: null,
    change_scope: "local",
    abnormal: false,
    lock_state: "none",
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 100,
    content_digest: `${path}-digest`,
    ...overrides,
  };
}
