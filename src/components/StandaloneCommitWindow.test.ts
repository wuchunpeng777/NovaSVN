import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./workbench/MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(),
    m: vi.fn(),
    p: vi.fn(),
    d: vi.fn(),
    ...internals,
  })),
}));

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  createCommitTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  getFileContentDiff: vi.fn(),
  getFileDiff: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

import {
  createCommitTask,
  createSvnOperationTask,
  getFileContentDiff,
  getFileDiff,
  getTask,
  inspectUpdateTarget,
  scanWorkspaceStatus,
} from "../lib/api";
import type { ChangedFile, Task, WorkingCopyStatus } from "../types/api";
import StandaloneCommitWindow from "./StandaloneCommitWindow.svelte";

const createCommitTaskMock = vi.mocked(createCommitTask);
const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const getFileContentDiffMock = vi.mocked(getFileContentDiff);
const getFileDiffMock = vi.mocked(getFileDiff);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(() => {
  localStorage.clear();
  createCommitTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  getFileContentDiffMock.mockReset();
  getFileDiffMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  inspectUpdateTargetMock.mockResolvedValue(makeTarget());
  scanWorkspaceStatusMock.mockResolvedValue(
    makeStatus({
      files: [
        makeFile("src/main.ts", "modified"),
        makeFile("src/nested.ts", "added"),
        makeFile("other.ts", "modified"),
        makeFile("src/ignored.ts", "unversioned"),
      ],
      total: 4,
      returned: 4,
      local_changes: 4,
      modified: 2,
      added: 1,
      unversioned: 1,
    }),
  );
  createCommitTaskMock.mockResolvedValue(makeTask("pending"));
  getFileContentDiffMock.mockResolvedValue({
    path: "src/main.ts",
    original_text: "const value = 1;",
    modified_text: "const value = 2;",
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
  createSvnOperationTaskMock.mockResolvedValue(
    makeTask("pending", [], { task_id: "revert-1", title: "撤销文件 other.ts" }),
  );
  getTaskMock.mockResolvedValue(makeTask("success", ["Committed revision 21."]));
});

describe("StandaloneCommitWindow", () => {
  it("只显示右键目录范围内的可提交文件并默认全选", async () => {
    inspectUpdateTargetMock.mockResolvedValue(
      makeTarget({ target_path: "C:\\repo\\src", relative_path: "src", kind: "dir" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo\\src" } });

    await waitFor(() => {
      expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        svn_executable: undefined,
        offset: 0,
        limit: 5000,
        check_remote_updates: false,
      });
    });
    const pane = screen.getByLabelText("选择提交文件");
    expect(within(pane).getByText("src/main.ts")).toBeInTheDocument();
    expect(within(pane).getByText("src/nested.ts")).toBeInTheDocument();
    expect(within(pane).queryByText("other.ts")).not.toBeInTheDocument();
    expect(within(pane).getByText("src/ignored.ts")).toBeInTheDocument();
    expect(within(pane).getByRole("button", { name: "Add src/ignored.ts" })).toBeInTheDocument();
    expect(within(pane).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(pane).getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked)).toBe(true);
  });

  it("显示未版本控制文件并可 Add 后刷新列表", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask("pending", [], { task_id: "add-1", title: "Add 文件 src/ignored.ts" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.click(
      await within(filePane).findByRole("button", { name: "Add src/ignored.ts" }),
    );

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "add_file",
        file_path: "src/ignored.ts",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Add src/ignored.ts");
  });

  it("点击文件条目加载并展示修改内容且不改变提交选择", async () => {
    getFileContentDiffMock.mockResolvedValue({
      path: "src/main.ts",
      original_text: "const value = 1;",
      modified_text: "const value = 1;",
      language: "typescript",
      binary: false,
      too_large: false,
      max_bytes: 512 * 1024,
    });
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const filePane = screen.getByLabelText("选择提交文件");
    const checkbox = await within(filePane).findByRole("checkbox", { name: "src/main.ts" });
    expect(checkbox).toBeChecked();
    await fireEvent.click(
      within(filePane).getByRole("button", { name: "查看修改 src/main.ts" }),
    );

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
    expect(checkbox).toBeChecked();
    expect(screen.getByLabelText("修改内容")).toHaveTextContent("+const value = 2;");
  });

  it("通过按钮从本地缓存获取历史日志并提交用户选择的路径", async () => {
    localStorage.setItem(
      "novasvn:commit-message-settings",
      JSON.stringify({ template: "默认模板", history: ["修复历史问题", "旧日志"] }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("other.ts");

    await fireEvent.click(screen.getByRole("button", { name: "获取历史日志" }));
    const dialog = screen.getByRole("dialog", { name: "选择历史提交日志" });
    expect(within(dialog).getByText("历史日志来自本地缓存")).toBeInTheDocument();
    const history = within(dialog).getByRole("listbox", { name: "历史提交日志" });
    await fireEvent.change(history, { target: { value: "修复历史问题" } });
    await fireEvent.click(within(dialog).getByRole("button", { name: "填充提交日志" }));
    expect(screen.getByRole("textbox", { name: "提交日志" })).toHaveValue("修复历史问题");

    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.click(within(filePane).getByLabelText("src/main.ts"));
    await fireEvent.click(within(filePane).getByLabelText("other.ts"));
    await fireEvent.click(screen.getByRole("button", { name: "提交 1 个文件" }));

    await waitFor(() => {
      expect(createCommitTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        message: "修复历史问题",
        files: ["src/nested.ts"],
        svn_executable: undefined,
      });
    });
    expect(await screen.findByText("提交完成")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("novasvn:commit-message-settings") ?? "{}")).toMatchObject({
      history: ["修复历史问题", "旧日志"],
    });
  });

  it("本地没有缓存时显示历史日志空状态", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("other.ts");

    await fireEvent.click(screen.getByRole("button", { name: "获取历史日志" }));
    const dialog = screen.getByRole("dialog", { name: "选择历史提交日志" });
    expect(within(dialog).getByText("本地暂无缓存的提交日志")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "填充提交日志" })).toBeDisabled();
  });

  it("启动时读取 Log 窗口选择的提交日志", async () => {
    localStorage.setItem("novasvn:pending-commit-message", "从 Log 窗口选择的日志");
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "提交日志" })).toHaveValue(
        "从 Log 窗口选择的日志",
      );
    });
    expect(localStorage.getItem("novasvn:pending-commit-message")).toBeNull();
  });

  it("右键文件确认后执行 Revert 并刷新列表", async () => {
    getTaskMock.mockResolvedValue(
      makeTask("success", [], { task_id: "revert-1", title: "撤销文件 other.ts" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePath = await screen.findByText("other.ts");

    await fireEvent.contextMenu(filePath, { clientX: 220, clientY: 180 });
    const menu = screen.getByRole("menu", { name: "文件菜单 other.ts" });
    await fireEvent.click(within(menu).getByRole("menuitem", { name: "Revert" }));

    const dialog = screen.getByRole("dialog", { name: "确认 Revert" });
    expect(within(dialog).getByText("other.ts")).toBeInTheDocument();
    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Revert" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "revert_file",
        file_path: "other.ts",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Revert other.ts");
  });

  it("根据文件状态显示 Revert、Add 和 Delete 菜单项", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");

    await fireEvent.contextMenu(await within(filePane).findByText("other.ts"));
    let menu = screen.getByRole("menu", { name: "文件菜单 other.ts" });
    expect(within(menu).getByRole("menuitem", { name: "Revert" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    await fireEvent.keyDown(menu, { key: "Escape" });

    await fireEvent.contextMenu(await within(filePane).findByText("src/nested.ts"));
    menu = screen.getByRole("menu", { name: "文件菜单 src/nested.ts" });
    expect(within(menu).queryByRole("menuitem", { name: "Revert" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    await fireEvent.keyDown(menu, { key: "Escape" });

    await fireEvent.contextMenu(await within(filePane).findByText("src/ignored.ts"));
    menu = screen.getByRole("menu", { name: "文件菜单 src/ignored.ts" });
    expect(within(menu).getByRole("menuitem", { name: "Add" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Revert" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("右键版本化文件确认后执行 Delete 并刷新列表", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask("pending", [], { task_id: "delete-1", title: "删除文件 src/nested.ts" }),
    );
    getTaskMock.mockResolvedValue(makeTask("success", [], { task_id: "delete-1" }));
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.contextMenu(await within(filePane).findByText("src/nested.ts"));
    const menu = screen.getByRole("menu", { name: "文件菜单 src/nested.ts" });
    await fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "确认 Delete" });
    expect(within(dialog).getByText("文件将被标记为 SVN 删除，并保留为待提交变更。")).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Delete" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "delete_path",
        file_path: "src/nested.ts",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Delete src/nested.ts");
  });

  it("右键未版本控制文件确认后执行磁盘 Delete", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask("pending", [], { task_id: "delete-unversioned-1", title: "删除未版本控制文件" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask("success", [], { task_id: "delete-unversioned-1" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.contextMenu(await within(filePane).findByText("src/ignored.ts"));
    const menu = screen.getByRole("menu", { name: "文件菜单 src/ignored.ts" });
    await fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "确认 Delete" });
    expect(within(dialog).getByText("未版本控制文件将从磁盘永久删除，NovaSVN 无法撤销此操作。")).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Delete" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "delete_unversioned_file",
        file_path: "src/ignored.ts",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Delete src/ignored.ts");
  });

  it("已删除文件的 Delete 菜单项不可用", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({ files: [makeFile("src/removed.ts", "deleted")], total: 1, returned: 1, local_changes: 1, deleted: 1 }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.contextMenu(await within(filePane).findByText("src/removed.ts"));
    const menu = screen.getByRole("menu", { name: "文件菜单 src/removed.ts" });
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeDisabled();
  });

  it("没有日志或文件选择时禁用提交", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus({ files: [] }));
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const submit = await screen.findByRole("button", { name: "提交 0 个文件" });
    expect(submit).toBeDisabled();
    expect(createCommitTaskMock).not.toHaveBeenCalled();
  });

  it("展示提交任务错误", async () => {
    createCommitTaskMock.mockRejectedValue({
      code: "COMMIT_MESSAGE_MISSING",
      message: "提交信息不能为空",
      detail: "请输入提交日志",
      recoverable: true,
    });
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("other.ts");
    await fireEvent.input(screen.getByRole("textbox", { name: "提交日志" }), {
      target: { value: "测试提交" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "提交 3 个文件" }));
    const alert = await screen.findByRole("alert", { name: "命令错误" });
    expect(alert).toHaveTextContent("提交信息不能为空");
  });
});

function makeTarget(overrides = {}) {
  return {
    target_path: "C:\\repo",
    working_copy_root: "C:\\repo",
    relative_path: null,
    repository_url: "https://example.com/svn/trunk",
    revision: "20",
    kind: "dir",
    ...overrides,
  };
}

function makeTask(
  status: Task["status"],
  messages: string[] = [],
  overrides: Partial<Task> = {},
): Task {
  return {
    task_id: "commit-1",
    title: "提交工作副本",
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
    revision_range: "20",
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
