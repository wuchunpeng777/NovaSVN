import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/workbench/MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(),
    m: vi.fn(),
    p: vi.fn(),
    d: vi.fn(),
    ...internals,
  })),
}));

vi.mock("./lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api")>();
  return {
    ...actual,
    createRepositoryCheckoutTask: vi.fn(),
    createRepositoryFileTask: vi.fn(),
    createRevertRevisionTask: vi.fn(),
    createSvnBatchOperationTask: vi.fn(),
    createSvnOperationTask: vi.fn(),
    ignoreWorkspacePath: vi.fn(),
    getTask: vi.fn(),
    getSvnLog: vi.fn(),
    getRepositoryFileBlame: vi.fn(),
    getRepositoryFileLog: vi.fn(),
    getRepositoryFileProperties: vi.fn(),
    listTasks: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    openRepositoryTempFile: vi.fn(),
    openWorkspaceFile: vi.fn(),
    openWorkspace: vi.fn(),
    scanWorkspaceStatus: vi.fn(),
  };
});

import { get } from "svelte/store";
import {
  createRepositoryCheckoutTask,
  createRepositoryFileTask,
  createRevertRevisionTask,
  createSvnOperationTask,
  createSvnBatchOperationTask,
  ignoreWorkspacePath,
  getTask,
  getSvnLog,
  getRepositoryFileBlame,
  getRepositoryFileLog,
  getRepositoryFileProperties,
  listTasks,
  listWorkspaceFiles,
  openRepositoryTempFile,
  openWorkspaceFile,
  openWorkspace,
  scanWorkspaceStatus,
} from "./lib/api";
import { setCurrentView, taskStore, workspaceStore } from "./stores/app";
import type {
  Task,
  TaskSnapshot,
  TaskSummary,
  WorkingCopyStatus,
  WorkspaceFileTree,
  WorkspaceSummary,
} from "./types/api";
import App from "./App.svelte";

const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const createRepositoryCheckoutTaskMock = vi.mocked(createRepositoryCheckoutTask);
const createRepositoryFileTaskMock = vi.mocked(createRepositoryFileTask);
const createRevertRevisionTaskMock = vi.mocked(createRevertRevisionTask);
const createSvnBatchOperationTaskMock = vi.mocked(createSvnBatchOperationTask);
const ignoreWorkspacePathMock = vi.mocked(ignoreWorkspacePath);
const getTaskMock = vi.mocked(getTask);
const getSvnLogMock = vi.mocked(getSvnLog);
const getRepositoryFileBlameMock = vi.mocked(getRepositoryFileBlame);
const getRepositoryFileLogMock = vi.mocked(getRepositoryFileLog);
const getRepositoryFilePropertiesMock = vi.mocked(getRepositoryFileProperties);
const listTasksMock = vi.mocked(listTasks);
const listWorkspaceFilesMock = vi.mocked(listWorkspaceFiles);
const openRepositoryTempFileMock = vi.mocked(openRepositoryTempFile);
const openWorkspaceFileMock = vi.mocked(openWorkspaceFile);
const openWorkspaceMock = vi.mocked(openWorkspace);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(async () => {
  createSvnOperationTaskMock.mockReset();
  createRepositoryCheckoutTaskMock.mockReset();
  createRepositoryFileTaskMock.mockReset();
  createRevertRevisionTaskMock.mockReset();
  createSvnBatchOperationTaskMock.mockReset();
  ignoreWorkspacePathMock.mockReset();
  getTaskMock.mockReset();
  getSvnLogMock.mockReset();
  getRepositoryFileBlameMock.mockReset();
  getRepositoryFileLogMock.mockReset();
  getRepositoryFilePropertiesMock.mockReset();
  listTasksMock.mockReset();
  listWorkspaceFilesMock.mockReset();
  openRepositoryTempFileMock.mockReset();
  openWorkspaceFileMock.mockReset();
  openWorkspaceMock.mockReset();
  scanWorkspaceStatusMock.mockReset();

  listTasksMock.mockResolvedValue(makeTaskSnapshot([]));
  await taskStore.refresh();
  workspaceStore.markSvnOperationTask(null, null, null);
  setCurrentView("changes");

  openWorkspaceMock.mockResolvedValue(makeWorkspace());
  scanWorkspaceStatusMock.mockResolvedValue(makeStatus());
  listWorkspaceFilesMock.mockResolvedValue(makeFileTree());
  await workspaceStore.openPath(undefined, "C:/repo/wc");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App SVN operation completion", () => {
  it("连续点击更新只创建并绑定一个任务", async () => {
    const creation = deferred<Task>();
    const createdTask = makeTask({ task_id: "svn-update", status: "pending" });
    createSvnOperationTaskMock.mockReturnValueOnce(creation.promise);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "svn-update", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(createdTask);
    render(App);

    const updateButton = screen.getByRole("button", { name: "更新工作副本" });
    await fireEvent.click(updateButton);
    await fireEvent.click(updateButton);

    expect(createSvnOperationTaskMock).toHaveBeenCalledOnce();
    creation.resolve(createdTask);

    await waitFor(() => {
      expect(get(workspaceStore).pendingSvnOperationTaskId).toBe("svn-update");
    });
    expect(
      screen.getByRole("button", { name: "正在更新工作副本" }),
    ).toBeDisabled();
    expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      kind: "update",
      svn_executable: undefined,
    });
  });

  it("远端变化文件使用真实文件级 Update 任务", async () => {
    await showRemoteUpdateSource();
    const updateTask = makeTask({ task_id: "update-path", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(updateTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "update-path", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(updateTask);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Update remote.txt" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "update_path",
        file_path: "remote.txt",
        svn_executable: undefined,
      });
    });
  });

  it("本地与远端同时变化时确认后才执行文件级 Update", async () => {
    await showRemoteUpdateSource("both");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Update remote.txt" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("可能产生合并或冲突"));
    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
  });

  it("确认后创建 Revert-to-Revision 任务并绑定普通 SVN 完成刷新", async () => {
    getSvnLogMock.mockResolvedValue({
      target: "https://example.com/svn/trunk",
      entries: [
        {
          revision: "10",
          author: "alice",
          date: "2026-07-11T10:00:00Z",
          message: "target",
          changed_paths: [],
        },
      ],
      has_more: false,
      next_start_revision: null,
    });
    await workspaceStore.refreshSvnLog(undefined);
    setCurrentView("history");
    const task = makeTask({ task_id: "revert-revision-10", status: "pending" });
    createRevertRevisionTaskMock.mockResolvedValue(task);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    const revertButton = screen.getByRole("button", { name: "Revert 工作副本到 r10" });
    await fireEvent.click(revertButton);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("反向 Merge"));
    expect(createRevertRevisionTaskMock).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await fireEvent.click(revertButton);
    await waitFor(() => {
      expect(createRevertRevisionTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        target_revision: "10",
        svn_executable: undefined,
      });
    });
    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: "revert-revision-10",
      pendingSvnOperationKind: "revert_to_revision",
      pendingSvnOperationWorkingCopyRoot: "C:/repo/wc",
    });
  });

  it("多选路径确认后创建单个批量 Revert 任务", async () => {
    await showBatchOperationSource();
    const task = makeTask({ task_id: "batch-revert", status: "pending" });
    createSvnBatchOperationTaskMock.mockResolvedValue(task);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "revert_paths",
        file_paths: ["alpha.txt", "beta.txt"],
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("alpha.txt"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("beta.txt"));
  });

  it("取消批量 Delete 确认时不创建任务", async () => {
    await showBatchOperationSource();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(createSvnBatchOperationTaskMock).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("删除 2 个路径"));
  });

  it("多选 Move 使用目标目录创建单个批量任务", async () => {
    await showBatchOperationSource();
    const task = makeTask({ task_id: "batch-move", status: "pending" });
    createSvnBatchOperationTaskMock.mockResolvedValue(task);
    vi.spyOn(window, "prompt").mockReturnValue("archive");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "move_paths",
        file_paths: ["alpha.txt", "beta.txt"],
        target_path: "archive",
        svn_executable: undefined,
      });
    });
  });

  it("双击文件时通过安全后端入口打开系统默认应用", async () => {
    await showMoveableSource();
    openWorkspaceFileMock.mockResolvedValue({
      target_path: "C:/repo/wc/source.txt",
    });
    render(App);

    await fireEvent.dblClick(screen.getByRole("button", { name: "选择文件 source.txt" }));

    await waitFor(() => {
      expect(openWorkspaceFileMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        file_path: "source.txt",
      });
    });
    expect(screen.getByText("已打开文件：C:/repo/wc/source.txt")).toBeInTheDocument();
  });

  it("选中其他任务时仍按 pending id 消费成功操作", async () => {
    const pendingTask = makeTaskSummary({ task_id: "svn-update", status: "success" });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(makeTaskSnapshot([selectedTask, pendingTask], "other-task"));
    getTaskMock.mockResolvedValue(selectedTask);
    await taskStore.select("other-task");
    scanWorkspaceStatusMock.mockClear();
    render(App);

    workspaceStore.markSvnOperationTask("svn-update", "update", "C:\\repo\\wc\\");

    await waitFor(() => {
      expect(get(workspaceStore).pendingSvnOperationTaskId).toBeNull();
    });
    expect(get(taskStore).selectedTask?.task_id).toBe("other-task");
    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenLastCalledWith({
        path: "C:\\repo\\wc\\",
        svn_executable: undefined,
      });
    });
  });

  it("后端确认 pending 任务消失后解除操作锁定并提示刷新", async () => {
    getTaskMock.mockRejectedValueOnce({ code: "TASK_NOT_FOUND" });
    render(App);

    workspaceStore.markSvnOperationTask("missing-task", "cleanup", "C:/repo/wc");

    await waitFor(() => {
      expect(get(workspaceStore).pendingSvnOperationTaskId).toBeNull();
    });
    expect(get(workspaceStore).statusError).toMatchObject({
      code: "SVN_OPERATION_TASK_MISSING",
      recoverable: true,
    });
    expect(screen.getByText(/运行中的 SVN 操作已从任务队列中消失/)).toBeInTheDocument();
  });

  it("pending 任务查询瞬时失败时保持操作锁定", async () => {
    getTaskMock.mockRejectedValueOnce({ code: "IPC_ERROR" });
    render(App);

    workspaceStore.markSvnOperationTask("temporarily-unavailable", "cleanup", "C:/repo/wc");

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledWith("temporarily-unavailable");
    });
    expect(get(workspaceStore).pendingSvnOperationTaskId).toBe(
      "temporarily-unavailable",
    );
    expect(get(workspaceStore).statusError?.code).not.toBe(
      "SVN_OPERATION_TASK_MISSING",
    );
  });

  it("选中其他任务时仍按 pending id 完成 Commit", async () => {
    const pendingSummary = makeTaskSummary({
      task_id: "pending-commit",
      status: "success",
    });
    const pendingTask = makeTask({ task_id: "pending-commit", status: "success" });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([selectedTask, pendingSummary], "other-task"),
    );
    getTaskMock.mockImplementation(async (taskId) =>
      taskId === "pending-commit" ? pendingTask : selectedTask,
    );
    await taskStore.select("other-task");
    render(App);

    workspaceStore.markCommitTask("pending-commit");

    await waitFor(() => {
      expect(get(workspaceStore).pendingCommitTaskId).toBeNull();
    });
    expect(get(taskStore).selectedTask?.task_id).toBe("other-task");
    expect(getTaskMock).toHaveBeenCalledWith("pending-commit");
  });

  it("选中其他任务时仍应用 Repository List 完整结果", async () => {
    const pendingSummary = makeTaskSummary({
      task_id: "repository-list",
      status: "success",
    });
    const pendingTask = makeTask({
      task_id: "repository-list",
      status: "success",
      result: {
        repository_list: {
          url: "https://example.com/svn/trunk/src",
          revision: null,
          entries: [],
        },
        repository_file: null,
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([selectedTask, pendingSummary], "other-task"),
    );
    getTaskMock.mockImplementation(async (taskId) =>
      taskId === "repository-list" ? pendingTask : selectedTask,
    );
    await taskStore.select("other-task");
    render(App);

    workspaceStore.markRepositoryListTask(
      "repository-list",
      "https://example.com/svn/trunk/src",
    );

    await waitFor(() => {
      expect(get(workspaceStore).pendingRepositoryListTaskId).toBeNull();
    });
    expect(get(workspaceStore).repositoryList?.url).toBe(
      "https://example.com/svn/trunk/src",
    );
  });

  it("仓库文件任务完成后按 pending id 打开临时副本", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [
        {
          name: "README space.md",
          kind: "file",
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
        },
      ],
    });
    const pendingTask = makeTask({ task_id: "repository-file", status: "pending" });
    createRepositoryFileTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-file", status: "pending" }),
      ]),
    );
    openRepositoryTempFileMock.mockResolvedValue({ target_path: "C:/data/README space.md" });
    render(App);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "打开仓库文件 README space.md 的临时副本",
      }),
    );

    await waitFor(() => {
      expect(createRepositoryFileTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryFileTaskId).toBe("repository-file");
    });

    const completedTask = makeTask({
      task_id: "repository-file",
      status: "success",
      result: {
        repository_list: null,
        repository_file: {
          url: "https://example.com/svn/trunk/README%20space.md",
          revision: "10",
          file_path: "C:/data/README space.md",
          file_name: "README space.md",
          bytes: 12,
        },
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-file", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(completedTask);
    await taskStore.refresh();

    await waitFor(() => {
      expect(openRepositoryTempFileMock).toHaveBeenCalledWith({
        path: "C:/data/README space.md",
      });
      expect(get(workspaceStore).pendingRepositoryFileTaskId).toBeNull();
      expect(get(workspaceStore).repositoryFileError).toBeNull();
    });
  });

  it("仓库临时副本打开失败时解除 pending 并显示错误", async () => {
    const failedTask = makeTask({
      task_id: "repository-open-failed",
      status: "success",
      result: {
        repository_list: null,
        repository_file: {
          url: "https://example.com/svn/trunk/file.txt",
          revision: null,
          file_path: "C:/data/file.txt",
          file_name: "file.txt",
          bytes: 4,
        },
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-open-failed", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(failedTask);
    openRepositoryTempFileMock.mockRejectedValue({ message: "没有可用的默认应用" });
    render(App);

    workspaceStore.markRepositoryFileTask("repository-open-failed");
    await taskStore.refresh();

    await waitFor(() => {
      expect(get(workspaceStore).pendingRepositoryFileTaskId).toBeNull();
      expect(get(workspaceStore).repositoryFileError).toBe("没有可用的默认应用");
    });
  });

  it("仓库 Checkout 完成后按 pending 本地路径打开工作副本", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryCheckoutForm("url", "https://example.com/svn/trunk");
    workspaceStore.setRepositoryCheckoutForm("localPath", "C:/checkouts/trunk");
    workspaceStore.setRepositoryCheckoutForm("revision", "10");

    const pendingTask = makeTask({ task_id: "repository-checkout", status: "pending" });
    createRepositoryCheckoutTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-checkout", status: "pending" }),
      ]),
    );
    openWorkspaceMock.mockResolvedValue({
      local_path: "C:/checkouts/trunk",
      working_copy_root: "C:/checkouts/trunk",
      repository_url: "https://example.com/svn/trunk",
      repository_root: "https://example.com/svn",
      revision: "10",
    });
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(createRepositoryCheckoutTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        local_path: "C:/checkouts/trunk",
        revision: "10",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryCheckoutTaskId).toBe("repository-checkout");
      expect(get(workspaceStore).pendingRepositoryCheckoutLocalPath).toBe("C:/checkouts/trunk");
    });

    const completedTask = makeTask({
      task_id: "repository-checkout",
      status: "success",
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-checkout", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(completedTask);
    openWorkspaceMock.mockClear();
    await taskStore.refresh();

    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenCalledWith({
        path: "C:/checkouts/trunk",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryCheckoutTaskId).toBeNull();
      expect(get(workspaceStore).repositoryCheckoutError).toBeNull();
    });
  });

  it("仓库文件 Log、Blame 和 Properties 使用当前 Revision 与编码后的文件 URL", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [
        {
          name: "README space.md",
          kind: "file",
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
        },
      ],
    });
    getRepositoryFileLogMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README%20space.md",
      entries: [
        {
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
          message: "Update README",
          changed_paths: [],
        },
      ],
      has_more: false,
      next_start_revision: null,
    });
    getRepositoryFileBlameMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README%20space.md",
      total_lines: 1,
      truncated: false,
      lines: [
        {
          line_number: 1,
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
          content: "README title",
        },
      ],
    });
    getRepositoryFilePropertiesMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README%20space.md",
      properties: [{ name: "svn:mime-type", value: "text/plain" }],
      externals: null,
    });
    render(App);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看仓库文件 README space.md 的 Log",
      }),
    );

    await waitFor(() => {
      expect(getRepositoryFileLogMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
        limit: 50,
      });
      expect(screen.getByLabelText("仓库文件日志")).toHaveTextContent("Update README");
    });

    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看仓库文件 README space.md 的 Blame",
      }),
    );

    await waitFor(() => {
      expect(getRepositoryFileBlameMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
        max_lines: 5000,
      });
      expect(screen.queryByLabelText("仓库文件日志")).not.toBeInTheDocument();
      expect(screen.getByLabelText("仓库文件 Blame")).toHaveTextContent("README title");
    });

    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看仓库文件 README space.md 的 Properties",
      }),
    );

    await waitFor(() => {
      expect(getRepositoryFilePropertiesMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
      });
      expect(screen.queryByLabelText("仓库文件 Blame")).not.toBeInTheDocument();
      expect(screen.getByLabelText("仓库文件 Properties")).toHaveTextContent("text/plain");
    });
  });

  it("按 pending id 处理取消的 Merge", async () => {
    const pendingSummary = makeTaskSummary({
      task_id: "merge-task",
      status: "cancelled",
    });
    const pendingTask = makeTask({
      task_id: "merge-task",
      status: "cancelled",
      error: "用户取消 Merge",
    });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([selectedTask, pendingSummary], "other-task"),
    );
    getTaskMock.mockImplementation(async (taskId) =>
      taskId === "merge-task" ? pendingTask : selectedTask,
    );
    await taskStore.select("other-task");
    render(App);

    workspaceStore.markMergeTask("merge-task");

    await waitFor(() => {
      expect(get(workspaceStore).pendingMergeTaskId).toBeNull();
    });
    expect(get(workspaceStore).mergeError).toBe("用户取消 Merge");
  });

  it("确认源和目标后创建工作副本 Move 任务", async () => {
    await showMoveableSource();
    vi.spyOn(window, "prompt").mockReturnValue("renamed.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const moveTask = makeTask({ task_id: "move-task", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(moveTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "move-task", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(moveTask);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "移动文件 source.txt" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "move_path",
        file_path: "source.txt",
        target_path: "renamed.txt",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("源：source.txt\n目标：renamed.txt"),
    );
  });

  it("取消 Move 影响确认时不创建任务", async () => {
    await showMoveableSource();
    vi.spyOn(window, "prompt").mockReturnValue("renamed.txt");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "移动文件 source.txt" }));

    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
  });

  it("确认源和目标后创建工作副本 Copy 任务", async () => {
    await showMoveableSource();
    vi.spyOn(window, "prompt").mockReturnValue("copied.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const copyTask = makeTask({ task_id: "copy-task", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(copyTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "copy-task", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(copyTask);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "复制文件 source.txt" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "copy_path",
        file_path: "source.txt",
        target_path: "copied.txt",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("源：source.txt\n目标：copied.txt"),
    );
  });

  it("确认目标和作用目录后写入 Ignore 并刷新工作副本", async () => {
    await showIgnorableSource();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ignoreWorkspacePathMock.mockResolvedValueOnce({
      target: "assets",
      properties: [{ name: "svn:ignore", value: "cache.tmp" }],
      externals: null,
    });
    scanWorkspaceStatusMock.mockClear();
    listWorkspaceFilesMock.mockClear();
    render(App);

    await fireEvent.click(
      screen.getByRole("button", { name: "在工作副本中 Ignore assets/cache.tmp" }),
    );

    await waitFor(() => {
      expect(ignoreWorkspacePathMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        file_path: "assets/cache.tmp",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("目标：assets/cache.tmp\n规则作用目录：assets"),
    );
    await waitFor(() => {
      expect(scanWorkspaceStatusMock).toHaveBeenCalledOnce();
      expect(listWorkspaceFilesMock).toHaveBeenCalledOnce();
    });
    expect(get(workspaceStore)).toMatchObject({
      svnProperties: { target: "assets" },
      propertyEditForm: { name: "svn:ignore", value: "cache.tmp" },
    });
  });
});

async function showMoveableSource() {
  const tree = makeFileTree();
  tree.total_files = 1;
  tree.returned_files = 1;
  tree.nodes = [
    {
      path: "source.txt",
      name: "source.txt",
      kind: "file",
      status: "modified",
      revision: "12",
      ...makeNodeMetadata("12", "local"),
      file_size: 10,
      changed: true,
      versioned: true,
      children: [],
    },
  ];
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshFileTree();
}

async function showBatchOperationSource() {
  const status = makeStatus();
  status.total = 2;
  status.returned = 2;
  status.local_changes = 2;
  status.files = ["alpha.txt", "beta.txt"].map((path) => ({
    path,
    status: "modified",
    revision: "12",
    property_status: null,
    property_changed: false,
    remote_status: null,
    remote_property_status: null,
    change_scope: "local" as const,
    abnormal: false,
    lock_state: "none" as const,
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 10,
    content_digest: `${path}-digest`,
  }));
  const tree = makeFileTree();
  tree.total_files = 2;
  tree.returned_files = 2;
  tree.nodes = ["alpha.txt", "beta.txt"].map((path) => ({
    path,
    name: path,
    kind: "file" as const,
    status: "modified",
    revision: "12",
    ...makeNodeMetadata("12", "local"),
    file_size: 10,
    changed: true,
    versioned: true,
    children: [],
  }));
  scanWorkspaceStatusMock.mockResolvedValueOnce(status);
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshStatus();
}

async function selectBatchOperationFiles() {
  await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 alpha.txt" }));
  await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 beta.txt" }));
}

async function showRemoteUpdateSource(changeScope: "remote" | "both" = "remote") {
  const status = makeStatus();
  status.total = 1;
  status.returned = 1;
  status.local_changes = changeScope === "both" ? 1 : 0;
  status.remote_changes = 1;
  status.combined_changes = changeScope === "both" ? 1 : 0;
  status.files = [
    {
      path: "remote.txt",
      status: changeScope === "both" ? "modified" : "normal",
      revision: "12",
      property_status: null,
      property_changed: false,
      remote_status: "modified",
      remote_property_status: null,
      change_scope: changeScope,
      abnormal: false,
      lock_state: "none",
      lock_owner: null,
      lock_comment: null,
      conflict_kind: null,
      file_size: 10,
      content_digest: "remote-digest",
    },
  ];
  const tree = makeFileTree();
  tree.total_files = 1;
  tree.returned_files = 1;
  tree.nodes = [
    {
      path: "remote.txt",
      name: "remote.txt",
      kind: "file",
      status: changeScope === "both" ? "modified" : "normal",
      revision: "12",
      ...makeNodeMetadata("12", changeScope),
      remote_status: "modified",
      file_size: 10,
      changed: true,
      versioned: true,
      children: [],
    },
  ];
  scanWorkspaceStatusMock.mockResolvedValueOnce(status);
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshStatus();
}

async function showIgnorableSource() {
  const status = makeStatus();
  status.total = 1;
  status.returned = 1;
  status.unversioned = 1;
  status.files = [
    {
      path: "assets/cache.tmp",
      status: "unversioned",
      revision: null,
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
      file_size: 10,
      content_digest: "cache-digest",
    },
  ];
  const tree = makeFileTree();
  tree.total_files = 1;
  tree.returned_files = 1;
  tree.nodes = [
    {
      path: "assets/cache.tmp",
      name: "cache.tmp",
      kind: "file",
      status: "unversioned",
      revision: null,
      ...makeNodeMetadata(null, "local"),
      file_size: 10,
      changed: true,
      versioned: false,
      children: [],
    },
  ];
  scanWorkspaceStatusMock.mockResolvedValueOnce(status);
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshStatus();
}

function makeWorkspace(): WorkspaceSummary {
  return {
    local_path: "C:/repo/wc",
    working_copy_root: "C:/repo/wc",
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "12",
  };
}

function makeStatus(): WorkingCopyStatus {
  return {
    working_copy_root: "C:/repo/wc",
    total: 0,
    returned: 0,
    offset: 0,
    limit: 500,
    revision_range: "12",
    mixed_revision: false,
    remote_updates_checked: true,
    repository_revision: "12",
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
}

function makeFileTree(): WorkspaceFileTree {
  return {
    working_copy_root: "C:/repo/wc",
    total_files: 0,
    returned_files: 0,
    truncated: false,
    nodes: [],
  };
}

function makeNodeMetadata(
  revision: string | null,
  changeScope: "none" | "local" | "remote" | "both" = "none",
) {
  return {
    remote_status: null,
    remote_property_status: null,
    change_scope: changeScope,
    base_revision: revision,
    last_revision: revision,
    last_changed_date: revision ? "2026-07-11T01:02:03Z" : null,
    last_changed_author: revision ? "dev" : null,
  };
}

function makeTaskSummary(task: Partial<TaskSummary> = {}): TaskSummary {
  return {
    task_id: "task-1",
    title: "SVN 操作",
    status: "pending",
    error: null,
    created_at: 1,
    updated_at: 1,
    ...task,
  };
}

function makeTask(task: Partial<Task> = {}): Task {
  return {
    ...makeTaskSummary(task),
    logs: [],
    result: null,
    ...task,
  };
}

function makeTaskSnapshot(
  tasks: TaskSummary[],
  runningTaskId: string | null = null,
): TaskSnapshot {
  return {
    tasks,
    running_task_id: runningTaskId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
