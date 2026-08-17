import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeWindowMock } = vi.hoisted(() => ({
  closeWindowMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeWindowMock }),
}));

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
  createSvnBatchOperationTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  getFileContentDiff: vi.fn(),
  getFileDiff: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  launchConflictWindow: vi.fn(),
  launchUpdateWindow: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
  setWorkspaceChangelist: vi.fn(),
}));

import {
  createCommitTask,
  createSvnBatchOperationTask,
  createSvnOperationTask,
  getFileContentDiff,
  getFileDiff,
  getTask,
  inspectUpdateTarget,
  launchConflictWindow,
  launchUpdateWindow,
  scanWorkspaceStatus,
  setWorkspaceChangelist,
} from "../lib/api";
import type { ChangedFile, Task, WorkingCopyStatus } from "../types/api";
import StandaloneCommitWindow from "./StandaloneCommitWindow.svelte";

const createCommitTaskMock = vi.mocked(createCommitTask);
const createSvnBatchOperationTaskMock = vi.mocked(createSvnBatchOperationTask);
const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const getFileContentDiffMock = vi.mocked(getFileContentDiff);
const getFileDiffMock = vi.mocked(getFileDiff);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const launchConflictWindowMock = vi.mocked(launchConflictWindow);
const launchUpdateWindowMock = vi.mocked(launchUpdateWindow);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);
const setWorkspaceChangelistMock = vi.mocked(setWorkspaceChangelist);

beforeEach(() => {
  localStorage.clear();
  closeWindowMock.mockReset();
  closeWindowMock.mockResolvedValue(undefined);
  createCommitTaskMock.mockReset();
  createSvnBatchOperationTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  getFileContentDiffMock.mockReset();
  getFileDiffMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  launchConflictWindowMock.mockReset();
  launchUpdateWindowMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  setWorkspaceChangelistMock.mockReset();
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
  createSvnBatchOperationTaskMock.mockResolvedValue(
    makeTask("pending", [], { task_id: "batch-revert-1", title: "撤销 3 个路径" }),
  );
  launchUpdateWindowMock.mockResolvedValue({ target_path: "C:\\repo" });
  launchConflictWindowMock.mockResolvedValue({ target_path: "C:\\repo\\src\\conflict.ts" });
  getFileContentDiffMock.mockResolvedValue({
    path: "src/main.ts",
    original_text: "const value = 1;",
    modified_text: "const value = 2;",
    language: "typescript",
    binary: false,
    too_large: false,
    max_bytes: 20 * 1024 * 1024,
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
  setWorkspaceChangelistMock.mockResolvedValue({ changelist: null, file_paths: [] });
});

async function selectAllVisibleFiles() {
  const pane = await screen.findByLabelText("选择提交文件");
  await waitFor(() => {
    expect(within(pane).getByRole("button", { name: "全选" })).toBeEnabled();
  });
  await fireEvent.click(within(pane).getByRole("button", { name: "全选" }));
  return pane;
}


describe("StandaloneCommitWindow", () => {
  it("out of date 后关闭 Commit 并打开可自动返回的 Update", async () => {
    getTaskMock.mockResolvedValue(
      makeTask("failed", [], {
        error: "svn: E160028: File is out of date",
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await selectAllVisibleFiles();

    await fireEvent.input(await screen.findByRole("textbox", { name: "提交日志" }), {
      target: { value: "保留后重试" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "提交 4 个文件" }));
    const dialog = await screen.findByRole("dialog", { name: "提交失败：工作副本已过期" });
    await fireEvent.click(within(dialog).getByRole("button", { name: "更新后返回提交" }));

    expect(launchUpdateWindowMock).toHaveBeenCalledWith({
      target_path: "C:\\repo",
      return_action: "commit",
    });
    expect(localStorage.getItem("novasvn:pending-commit-message")).toBe("保留后重试");
    expect(closeWindowMock).toHaveBeenCalledOnce();
  });

  it("勾选后在提交成功时自动关闭窗口", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const autoClose = screen.getByRole("checkbox", { name: "提交完成后自动关闭" });
    expect(autoClose).not.toBeChecked();
    await fireEvent.click(autoClose);
    await selectAllVisibleFiles();
    await fireEvent.click(await screen.findByRole("button", { name: "提交 4 个文件" }));

    await waitFor(() => expect(closeWindowMock).toHaveBeenCalledOnce());
    expect(getTaskMock).toHaveBeenCalledWith("commit-1");
  });

  it("持久化自动关闭选项，但没有可提交文件时保持窗口打开", async () => {
    const first = render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const autoClose = screen.getByRole("checkbox", { name: "提交完成后自动关闭" });

    await fireEvent.click(autoClose);

    expect(autoClose).toBeChecked();
    expect(localStorage.getItem("novasvn:commit-close-after-completion")).toBe("true");
    expect(closeWindowMock).not.toHaveBeenCalled();
    first.unmount();

    scanWorkspaceStatusMock.mockResolvedValue(makeStatus({ files: [] }));
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    expect(
      screen.getByRole("checkbox", { name: "提交完成后自动关闭" }),
    ).toBeChecked();
    expect(await screen.findByRole("button", { name: "提交 0 个文件" })).toBeDisabled();
    expect(createCommitTaskMock).not.toHaveBeenCalled();
    expect(closeWindowMock).not.toHaveBeenCalled();
  });

  it("提交完成后再勾选只保存下次偏好，不追溯关闭当前窗口", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    await selectAllVisibleFiles();
    await fireEvent.click(await screen.findByRole("button", { name: "提交 4 个文件" }));
    expect(await screen.findByText("提交完成")).toBeInTheDocument();
    const autoClose = screen.getByRole("checkbox", { name: "提交完成后自动关闭" });
    await fireEvent.click(autoClose);

    expect(localStorage.getItem("novasvn:commit-close-after-completion")).toBe("true");
    expect(closeWindowMock).not.toHaveBeenCalled();
  });

  it("空闲时按 Escape 关闭 Commit 窗口", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    await screen.findByLabelText("选择提交文件");
    await fireEvent.keyDown(window, { key: "Escape" });

    expect(closeWindowMock).toHaveBeenCalledTimes(1);
  });

  it("提交过程中按 Escape 不关闭 Commit 窗口", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    await selectAllVisibleFiles();
    await fireEvent.click(await screen.findByRole("button", { name: "提交 4 个文件" }));
    await waitFor(() => expect(createCommitTaskMock).toHaveBeenCalledTimes(1));
    await fireEvent.keyDown(window, { key: "Escape" });

    expect(closeWindowMock).not.toHaveBeenCalled();
  });

  it("只显示右键目录范围内的可提交文件，打开时不自动勾选", async () => {
    inspectUpdateTargetMock.mockResolvedValue(
      makeTarget({ target_path: "C:\\repo\\src", relative_path: "src", kind: "dir" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo\\src" } });

    await waitFor(() => {
      expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        scope_path: "src",
        include_content_digests: false,
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
    expect(within(pane).getByRole("checkbox", { name: "src/main.ts" })).not.toBeChecked();
    expect(within(pane).getByRole("checkbox", { name: "src/nested.ts" })).not.toBeChecked();
    expect(within(pane).getByRole("checkbox", { name: "src/ignored.ts" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "提交 0 个文件" })).toBeDisabled();
    const metrics = screen.getByLabelText("操作指标");
    expect(metrics).toHaveTextContent("总提交量 0 B");
    expect(metrics).not.toHaveTextContent("项/秒");

    await fireEvent.click(within(pane).getByRole("checkbox", { name: "src/main.ts" }));
    expect(within(pane).getByRole("checkbox", { name: "src/main.ts" })).toBeChecked();
    expect(metrics).toHaveTextContent("总提交量 100 B");
  });

  it("展示并提交文件夹的 SVN 属性变更", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("src", "normal", {
            property_status: "modified",
            property_changed: true,
            file_size: null,
          }),
        ],
        total: 1,
        returned: 1,
        local_changes: 1,
        property_changed: 1,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const pane = await screen.findByLabelText("选择提交文件");
    expect(await within(pane).findByText("src")).toBeInTheDocument();
    expect(within(pane).getByText("M")).toBeInTheDocument();
    expect(within(pane).getByText("M")).toHaveAttribute("data-action", "M");
    expect(within(pane).getByText("M")).toHaveAttribute("title", "属性修改");
    expect(within(pane).getByRole("checkbox", { name: "src" })).not.toBeChecked();

    await fireEvent.click(within(pane).getByRole("checkbox", { name: "src" }));
    await fireEvent.click(screen.getByRole("button", { name: "提交 1 个文件" }));
    await waitFor(() => {
      expect(createCommitTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        message: "",
        files: ["src"],
        svn_executable: undefined,
      });
    });
  });

  it("展示冲突文件但不将其加入提交，并可打开冲突处理", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("src/main.ts", "modified"),
          makeFile("src/conflict.ts", "conflicted", {
            abnormal: true,
            conflict_kind: "text",
          }),
        ],
        total: 2,
        returned: 2,
        local_changes: 2,
        modified: 1,
        conflicted: 1,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const pane = await screen.findByLabelText("选择提交文件");
    expect(await within(pane).findByText("src/conflict.ts")).toBeInTheDocument();
    expect(within(pane).getByText("C")).toHaveAttribute("data-action", "C");
    expect(within(pane).getByText("C")).toHaveAttribute("title", "文本冲突");
    expect(within(pane).getByText("文本冲突")).toBeInTheDocument();
    expect(within(pane).queryByRole("checkbox", { name: "src/conflict.ts" })).not.toBeInTheDocument();
    await fireEvent.click(within(pane).getByRole("button", { name: "处理冲突 src/conflict.ts" }));

    expect(launchConflictWindowMock).toHaveBeenCalledWith({
      target_path: "C:\\repo\\src\\conflict.ts",
    });
    expect(screen.getByRole("button", { name: "提交 0 个文件" })).toBeDisabled();
  });

  it("展示树冲突并标记为不可提交", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("src/main.ts", "modified"),
          makeFile("src/tree.ts", "conflicted", {
            abnormal: true,
            conflict_kind: "tree:update",
          }),
        ],
        total: 2,
        returned: 2,
        local_changes: 2,
        modified: 1,
        conflicted: 1,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const pane = await screen.findByLabelText("选择提交文件");
    expect(await within(pane).findByText("src/tree.ts")).toBeInTheDocument();
    expect(within(pane).getByText("树冲突 (更新)")).toBeInTheDocument();
    expect(within(pane).getByText("C")).toHaveAttribute("title", "树冲突 (更新)");
    expect(within(pane).queryByRole("checkbox", { name: "src/tree.ts" })).not.toBeInTheDocument();
    expect(within(pane).getByText(/1 个冲突待处理（含树冲突）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交 0 个文件" })).toBeDisabled();
  });

  it("按 Changelist 分组文件并支持分组勾选", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("src/fix-a.ts", "modified", { changelist: "紧急修复" }),
          makeFile("src/fix-b.ts", "modified", { changelist: "紧急修复" }),
          makeFile("src/feature.ts", "added", { changelist: "新功能" }),
          makeFile("README.md", "modified"),
        ],
        total: 4,
        returned: 4,
        local_changes: 4,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const urgentGroup = await screen.findByRole("region", { name: "Changelist 紧急修复" });
    expect(screen.getByRole("region", { name: "Changelist 新功能" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Changelist 未分组" })).toBeInTheDocument();
    expect(within(urgentGroup).getByText("0 / 2 个可勾选")).toBeInTheDocument();

    await fireEvent.click(within(urgentGroup).getByRole("checkbox", { name: "选择 Changelist 紧急修复" }));
    expect(within(urgentGroup).getByRole("checkbox", { name: "src/fix-a.ts" })).toBeChecked();
    expect(within(urgentGroup).getByRole("checkbox", { name: "src/fix-b.ts" })).toBeChecked();
    expect(screen.getByRole("button", { name: "提交 2 个文件" })).toBeInTheDocument();
  });

  it("未版本控制文件可勾选，提交时一并传给 commit 任务", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const pane = await screen.findByLabelText("选择提交文件");
    const unversioned = await within(pane).findByRole("checkbox", { name: "src/ignored.ts" });

    expect(unversioned).not.toBeChecked();
    await fireEvent.click(unversioned);
    expect(unversioned).toBeChecked();
    expect(
      screen.getByText(/含 1 个未版本控制，点提交时会自动 svn add，无需手动 Add/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交 1 个文件" })).toBeEnabled();

    await fireEvent.click(screen.getByRole("button", { name: "提交 1 个文件" }));
    await waitFor(() => {
      expect(createCommitTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        message: "",
        files: ["src/ignored.ts"],
        svn_executable: undefined,
      });
      const files = createCommitTaskMock.mock.calls.at(-1)?.[0]?.files ?? [];
      expect(files).toEqual(["src/ignored.ts"]);
    });
  });

  it("范围内只有未版本控制路径时也不自动勾选，需手动选择后提交", async () => {
    inspectUpdateTargetMock.mockResolvedValue(
      makeTarget({
        target_path: "C:\\repo\\new-folder",
        relative_path: "new-folder",
        kind: "dir",
      }),
    );
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("new-folder", "unversioned", { file_size: null }),
          makeFile("other.ts", "modified"),
        ],
        total: 2,
        returned: 2,
        local_changes: 2,
        modified: 1,
        unversioned: 1,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo\\new-folder" } });

    await waitFor(() => {
      expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        scope_path: "new-folder",
        include_content_digests: false,
        svn_executable: undefined,
        offset: 0,
        limit: 5000,
        check_remote_updates: false,
      });
    });
    const pane = screen.getByLabelText("选择提交文件");
    expect(await within(pane).findByText("new-folder")).toBeInTheDocument();
    expect(within(pane).queryByText("other.ts")).not.toBeInTheDocument();
    expect(within(pane).getByRole("checkbox", { name: "new-folder" })).not.toBeChecked();
    expect(within(pane).getByRole("button", { name: "Add new-folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交 0 个文件" })).toBeDisabled();

    await fireEvent.click(within(pane).getByRole("checkbox", { name: "new-folder" }));
    expect(screen.getByRole("button", { name: "提交 1 个文件" })).toBeEnabled();
    await fireEvent.click(screen.getByRole("button", { name: "提交 1 个文件" }));
    await waitFor(() => {
      expect(createCommitTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        message: "",
        files: ["new-folder"],
        svn_executable: undefined,
      });
    });
  });

  it("全选包含未版本控制文件，Shift 可范围多选", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("a.ts", "modified"),
          makeFile("b.ts", "modified"),
          makeFile("c.ts", "unversioned"),
          makeFile("d.ts", "modified"),
        ],
        total: 4,
        returned: 4,
        local_changes: 4,
        modified: 3,
        unversioned: 1,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const pane = await screen.findByLabelText("选择提交文件");
    await within(pane).findByRole("checkbox", { name: "a.ts" });

    await fireEvent.click(within(pane).getByRole("button", { name: "全选" }));
    expect(within(pane).getByRole("checkbox", { name: "a.ts" })).toBeChecked();
    expect(within(pane).getByRole("checkbox", { name: "c.ts" })).toBeChecked();
    expect(screen.getByRole("button", { name: "提交 4 个文件" })).toBeEnabled();

    await fireEvent.click(within(pane).getByRole("button", { name: "清除" }));
    expect(within(pane).getByRole("checkbox", { name: "a.ts" })).not.toBeChecked();

    // Same as Log/Timeline: click sets anchor; Shift+click applies range to the new checked state.
    await fireEvent.click(within(pane).getByRole("checkbox", { name: "a.ts" }));
    expect(within(pane).getByRole("checkbox", { name: "a.ts" })).toBeChecked();
    await fireEvent.click(within(pane).getByRole("checkbox", { name: "c.ts" }), {
      shiftKey: true,
    });
    expect(within(pane).getByRole("checkbox", { name: "a.ts" })).toBeChecked();
    expect(within(pane).getByRole("checkbox", { name: "b.ts" })).toBeChecked();
    expect(within(pane).getByRole("checkbox", { name: "c.ts" })).toBeChecked();
    expect(within(pane).getByRole("checkbox", { name: "d.ts" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "提交 3 个文件" })).toBeEnabled();
  });

  it("为已选文件加入和移出 Changelist 后刷新并保留选择", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("待评审");
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("src/main.ts", "modified"),
          makeFile("src/review.ts", "modified", { changelist: "旧分组" }),
        ],
        total: 2,
        returned: 2,
        local_changes: 2,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await selectAllVisibleFiles();

    await screen.findByText("src/review.ts");
    await fireEvent.click(screen.getByRole("button", { name: "加入 Changelist..." }));
    await waitFor(() => {
      expect(setWorkspaceChangelistMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        file_paths: ["src/main.ts", "src/review.ts"],
        changelist: "待评审",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "提交 2 个文件" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "移出 Changelist" }));
    await waitFor(() => {
      expect(setWorkspaceChangelistMock).toHaveBeenLastCalledWith({
        working_copy_root: "C:\\repo",
        file_paths: ["src/review.ts"],
        changelist: undefined,
        svn_executable: undefined,
      });
    });
    prompt.mockRestore();
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

  it("已 Add 文件可 Unadd 且保留为工作区文件", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask("pending", [], { task_id: "unadd-1", title: "取消 Add src/nested.ts" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask("success", [], { task_id: "unadd-1", title: "取消 Add src/nested.ts" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");

    await fireEvent.click(
      await within(filePane).findByRole("button", { name: "Unadd src/nested.ts" }),
    );

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "unadd_file",
        file_path: "src/nested.ts",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Unadd src/nested.ts");
  });

  it("点击文件条目加载并展示修改内容且不改变提交选择", async () => {
    getFileContentDiffMock.mockResolvedValue({
      path: "src/main.ts",
      original_text: "const value = 1;",
      modified_text: "const value = 1;",
      language: "typescript",
      binary: false,
      too_large: false,
      max_bytes: 20 * 1024 * 1024,
    });
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    const filePane = screen.getByLabelText("选择提交文件");
    const checkbox = await within(filePane).findByRole("checkbox", { name: "src/main.ts" });
    expect(checkbox).not.toBeChecked();
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
        max_bytes: 20 * 1024 * 1024,
      });
    });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByLabelText("修改内容")).toHaveTextContent("+const value = 2;");
  });

  it("未选择文件时隐藏 Diff，打开后可以关闭", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");
    await within(filePane).findByText("src/main.ts");

    expect(screen.queryByLabelText("修改内容")).not.toBeInTheDocument();
    await fireEvent.click(
      within(filePane).getByRole("button", { name: "查看修改 src/main.ts" }),
    );
    expect(await screen.findByLabelText("修改内容")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "关闭 Diff" }));
    expect(screen.queryByLabelText("修改内容")).not.toBeInTheDocument();
  });

  it("支持调整 Diff 高度和提交信息侧栏宽度", async () => {
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.click(
      await within(filePane).findByRole("button", { name: "查看修改 src/main.ts" }),
    );

    const diffResizer = screen.getByRole("slider", { name: "调整 Diff 区域高度" });
    expect(diffResizer).toHaveAttribute("aria-valuenow", "320");
    await fireEvent.keyDown(diffResizer, { key: "ArrowUp" });
    expect(diffResizer).toHaveAttribute("aria-valuenow", "336");
    await fireEvent.mouseDown(diffResizer, { clientY: 400 });
    await fireEvent.mouseMove(window, { clientY: 360 });
    await fireEvent.mouseUp(window);
    expect(diffResizer).toHaveAttribute("aria-valuenow", "376");

    const sideResizer = screen.getByRole("slider", { name: "调整提交信息侧栏宽度" });
    expect(sideResizer).toHaveAttribute("aria-valuenow", "360");
    await fireEvent.keyDown(sideResizer, { key: "ArrowLeft" });
    expect(sideResizer).toHaveAttribute("aria-valuenow", "376");
    await fireEvent.mouseDown(sideResizer, { clientX: 500 });
    await fireEvent.mouseMove(window, { clientX: 460 });
    await fireEvent.mouseUp(window);
    expect(sideResizer).toHaveAttribute("aria-valuenow", "416");
  });

  it("目录使用 SVN 原始 Diff 展示递归修改", async () => {
    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({ files: [makeFile("src", "modified")], total: 1, returned: 1 }),
    );
    getFileDiffMock.mockResolvedValue({
      path: "src",
      node_kind: "dir",
      text: "Index: src/main.ts\n+directory change",
      binary: false,
      empty: false,
    });
    getFileContentDiffMock.mockResolvedValue({
      path: "src",
      node_kind: "dir",
      original_text: "",
      modified_text: "",
      language: "plaintext",
      binary: false,
      too_large: false,
      max_bytes: 20 * 1024 * 1024,
    });
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });

    await fireEvent.click(
      await screen.findByRole("button", { name: "查看修改 src" }),
    );
    expect(await screen.findByLabelText("修改内容")).toHaveTextContent("directory change");
  });

  it("通过按钮从本地缓存获取历史日志并提交用户选择的路径", async () => {
    localStorage.setItem(
      "novasvn:commit-message-settings",
      JSON.stringify({
        template: "默认模板",
        history: ["旧版全局日志"],
        project_histories: {
          "c:/repo": ["修复历史问题", "旧日志"],
          "c:/another-repo": ["其他项目日志"],
        },
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("other.ts");
    expect(screen.getByRole("textbox", { name: "提交日志" })).toHaveValue("默认模板");

    await fireEvent.click(screen.getByRole("button", { name: "获取历史日志" }));
    const dialog = screen.getByRole("dialog", { name: "选择历史提交日志" });
    expect(within(dialog).getByText("历史日志来自本地缓存")).toBeInTheDocument();
    expect(within(dialog).queryByText("其他项目日志")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("旧版全局日志")).not.toBeInTheDocument();
    const history = within(dialog).getByRole("listbox", { name: "历史提交日志" });
    await fireEvent.change(history, { target: { value: "修复历史问题" } });
    await fireEvent.doubleClick(history);
    expect(screen.getByRole("textbox", { name: "提交日志" })).toHaveValue("修复历史问题");
    expect(screen.queryByRole("dialog", { name: "选择历史提交日志" })).not.toBeInTheDocument();

    const filePane = screen.getByLabelText("选择提交文件");
    await fireEvent.click(within(filePane).getByLabelText("src/nested.ts"));
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
    expect(screen.getByLabelText("操作指标")).toHaveTextContent("总提交量 100 B");
    expect(JSON.parse(localStorage.getItem("novasvn:commit-message-settings") ?? "{}"))
      .toMatchObject({
        template: "默认模板",
        history: ["旧版全局日志"],
        project_histories: {
          "c:/repo": ["修复历史问题", "旧日志"],
          "c:/another-repo": ["其他项目日志"],
        },
      });
  });

  it("本地没有缓存时显示历史日志空状态", async () => {
    localStorage.setItem(
      "novasvn:commit-message-settings",
      JSON.stringify({
        template: "默认模板",
        history: ["旧版全局日志"],
        project_histories: { "c:/another-repo": ["其他项目日志"] },
      }),
    );
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

  it("对当前勾选的全部版本化项目执行批量 Revert", async () => {
    getTaskMock.mockResolvedValue(
      makeTask("success", [], { task_id: "batch-revert-1", title: "撤销 3 个路径" }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    await selectAllVisibleFiles();

    await screen.findByText("other.ts");
    await fireEvent.click(screen.getByRole("button", { name: "Revert 已选" }));
    const dialog = await screen.findByRole("dialog", { name: "确认 Revert" });
    expect(within(dialog).getByText("src/main.ts")).toBeInTheDocument();
    expect(within(dialog).getByText("src/nested.ts")).toBeInTheDocument();
    expect(within(dialog).getByText("other.ts")).toBeInTheDocument();
    expect(within(dialog).queryByText("src/ignored.ts")).not.toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Revert" }));
    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "revert_paths",
        file_paths: ["src/main.ts", "src/nested.ts", "other.ts"],
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Revert 3 个项目");
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
    expect(within(menu).getByRole("menuitem", { name: "Unadd" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Revert" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    await fireEvent.keyDown(menu, { key: "Escape" });

    await fireEvent.contextMenu(await within(filePane).findByText("src/ignored.ts"));
    menu = screen.getByRole("menu", { name: "文件菜单 src/ignored.ts" });
    expect(within(menu).getByRole("menuitem", { name: "Add" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Revert" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "加入 Changelist..." })).not.toBeInTheDocument();
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

  it("未版本控制文件行内 Delete 与 Delete 已选批量删除", async () => {
    createSvnOperationTaskMock
      .mockResolvedValueOnce(
        makeTask("pending", [], { task_id: "delete-u1", title: "删除未版本控制文件 a" }),
      )
      .mockResolvedValueOnce(
        makeTask("pending", [], { task_id: "delete-u2", title: "删除未版本控制文件 b" }),
      );
    getTaskMock
      .mockResolvedValueOnce(makeTask("success", [], { task_id: "delete-u1" }))
      .mockResolvedValueOnce(makeTask("success", [], { task_id: "delete-u2" }));

    scanWorkspaceStatusMock.mockResolvedValue(
      makeStatus({
        files: [
          makeFile("new-a.txt", "unversioned"),
          makeFile("new-b.txt", "unversioned"),
          makeFile("keep.ts", "modified"),
        ],
        total: 3,
        returned: 3,
        local_changes: 3,
        modified: 1,
        unversioned: 2,
      }),
    );
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const pane = await screen.findByLabelText("选择提交文件");
    await within(pane).findByRole("button", { name: "Delete new-a.txt" });

    await fireEvent.click(within(pane).getByRole("button", { name: "Delete new-a.txt" }));
    let dialog = screen.getByRole("dialog", { name: "确认 Delete" });
    expect(within(dialog).getByText("未版本控制文件将从磁盘永久删除，NovaSVN 无法撤销此操作。")).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await fireEvent.click(within(pane).getByRole("checkbox", { name: "new-a.txt" }));
    await fireEvent.click(within(pane).getByRole("checkbox", { name: "new-b.txt" }));
    await fireEvent.click(screen.getByRole("button", { name: "Delete 已选" }));
    dialog = screen.getByRole("dialog", { name: "确认 Delete" });
    expect(within(dialog).getByText(/2 个未版本控制文件将从磁盘永久删除/)).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Delete 2 个项目" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "delete_unversioned_file",
        file_path: "new-a.txt",
        svn_executable: undefined,
      });
    });
    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "delete_unversioned_file",
        file_path: "new-b.txt",
        svn_executable: undefined,
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已 Delete 2 个项目");
    });
  });

  it("展示丢失文件并允许 Delete 后提交删除", async () => {
    scanWorkspaceStatusMock
      .mockResolvedValueOnce(
        makeStatus({
          files: [makeFile("src/gone.ts", "missing", { abnormal: true })],
          total: 1,
          returned: 1,
          missing: 1,
          local_changes: 1,
        }),
      )
      .mockResolvedValue(
        makeStatus({
          files: [makeFile("src/gone.ts", "deleted")],
          total: 1,
          returned: 1,
          deleted: 1,
          local_changes: 1,
        }),
      );
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask("pending", [], { task_id: "delete-missing-1", title: "删除丢失文件" }),
    );
    getTaskMock.mockResolvedValue(makeTask("success", [], { task_id: "delete-missing-1" }));
    render(StandaloneCommitWindow, { props: { targetPath: "C:\\repo" } });
    const pane = screen.getByLabelText("选择提交文件");
    const row = await within(pane).findByLabelText("提交文件 src/gone.ts");

    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(row).getByText("!")).toBeInTheDocument();
    expect(within(row).getByTitle("丢失")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交 0 个文件" })).toBeDisabled();

    await fireEvent.click(within(row).getByRole("button", { name: "Delete src/gone.ts" }));
    const dialog = screen.getByRole("dialog", { name: "确认 Delete" });
    expect(within(dialog).getByText("文件将被标记为 SVN 删除，并保留为待提交变更。")).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole("button", { name: "确认 Delete" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        kind: "delete_path",
        file_path: "src/gone.ts",
        svn_executable: undefined,
      });
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("已 Delete src/gone.ts");

    const deleted = await within(pane).findByRole("checkbox", { name: "src/gone.ts" });
    expect(deleted).not.toBeChecked();
    await fireEvent.click(deleted);
    expect(deleted).toBeChecked();
    await fireEvent.click(screen.getByRole("button", { name: "提交 1 个文件" }));
    await waitFor(() => {
      expect(createCommitTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        message: "",
        files: ["src/gone.ts"],
        svn_executable: undefined,
      });
    });
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
    expect(await screen.findByText("目标范围内没有可提交、待 Add 或待处理丢失的文件")).toBeInTheDocument();
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
    await selectAllVisibleFiles();
    await screen.findByText("other.ts");
    await fireEvent.input(screen.getByRole("textbox", { name: "提交日志" }), {
      target: { value: "测试提交" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "提交 4 个文件" }));
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
    repository_root: "https://example.com/svn",
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
