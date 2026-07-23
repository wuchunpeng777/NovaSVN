import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeWindowMock } = vi.hoisted(() => ({ closeWindowMock: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeWindowMock }),
}));

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  createSvnBatchOperationTask: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

import {
  createSvnBatchOperationTask,
  getTask,
  inspectUpdateTarget,
  scanWorkspaceStatus,
} from "../lib/api";
import type { ChangedFile, Task, WorkingCopyStatus } from "../types/api";
import StandaloneRevertWindow from "./StandaloneRevertWindow.svelte";

const createSvnBatchOperationTaskMock = vi.mocked(createSvnBatchOperationTask);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(() => {
  closeWindowMock.mockReset();
  closeWindowMock.mockResolvedValue(undefined);
  createSvnBatchOperationTaskMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  scanWorkspaceStatusMock.mockReset();

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
    expect(within(pane).queryByText("src/untracked.ts")).not.toBeInTheDocument();
    expect(within(pane).queryByText("other.ts")).not.toBeInTheDocument();
    expect(within(pane).getAllByRole("checkbox")).toHaveLength(2);

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

function makeFile(path: string, status: string): ChangedFile {
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
  };
}
