import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    createSvnOperationTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    openWorkspace: vi.fn(),
    scanWorkspaceStatus: vi.fn(),
  };
});

import { get } from "svelte/store";
import {
  createSvnOperationTask,
  getTask,
  listTasks,
  listWorkspaceFiles,
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
const getTaskMock = vi.mocked(getTask);
const listTasksMock = vi.mocked(listTasks);
const listWorkspaceFilesMock = vi.mocked(listWorkspaceFiles);
const openWorkspaceMock = vi.mocked(openWorkspace);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(async () => {
  createSvnOperationTaskMock.mockReset();
  getTaskMock.mockReset();
  listTasksMock.mockReset();
  listWorkspaceFilesMock.mockReset();
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

    const updateButton = screen.getByRole("button", { name: "更新" });
    await fireEvent.click(updateButton);
    await fireEvent.click(updateButton);

    expect(createSvnOperationTaskMock).toHaveBeenCalledOnce();
    creation.resolve(createdTask);

    await waitFor(() => {
      expect(get(workspaceStore).pendingSvnOperationTaskId).toBe("svn-update");
    });
    expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      kind: "update",
      svn_executable: undefined,
    });
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
});

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
