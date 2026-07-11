import { describe, expect, it, vi } from "vitest";

import type { Task, TaskSnapshot, TaskSummary } from "../types/api";
import {
  consumePendingSvnOperationCompletion,
  createSvnOperationCreationCoordinator,
  isSameWorkingCopyRoot,
  normalizeWorkingCopyRoot,
} from "./svn-operation-completion";

function makeTaskSummary(task: Partial<TaskSummary> = {}): TaskSummary {
  return {
    task_id: "svn-1",
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

function makeSnapshot(tasks: TaskSummary[]): TaskSnapshot {
  return {
    tasks,
    running_task_id: tasks.find((task) => task.status === "running")?.task_id ?? null,
  };
}

function makeHandlers() {
  return {
    clearPending: vi.fn(),
    refreshWorkspace: vi.fn(),
    refreshStatus: vi.fn(),
  };
}

describe("consumePendingSvnOperationCompletion", () => {
  it("选中其他任务时仍消费 pending Update，且重复检查不会再次刷新", () => {
    const pendingTask = makeTaskSummary({ task_id: "svn-update", status: "success" });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    const taskState = {
      snapshot: makeSnapshot([selectedTask, pendingTask]),
      selectedTask,
    };
    let pendingTaskId: string | null = "svn-update";
    const clearPending = vi.fn(() => {
      pendingTaskId = null;
    });
    const refreshWorkspace = vi.fn();
    const refreshStatus = vi.fn();
    const consume = () =>
      consumePendingSvnOperationCompletion(
        pendingTaskId,
        "update",
        "C:/repo/wc",
        "c:\\repo\\wc\\",
        taskState,
        {
          clearPending,
          refreshWorkspace,
          refreshStatus,
        },
      );

    expect(consume()).toBe(true);
    expect(consume()).toBe(false);
    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(refreshWorkspace).toHaveBeenCalledWith("C:/repo/wc");
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  it("成功的普通 SVN 操作清理 pending 并刷新状态", () => {
    const taskState = {
      snapshot: makeSnapshot([
        makeTaskSummary({ task_id: "svn-delete", status: "success" }),
      ]),
    };
    const handlers = makeHandlers();

    expect(
      consumePendingSvnOperationCompletion(
        "svn-delete",
        "update_path",
        "/repo/wc",
        "/repo/wc/",
        taskState,
        handlers,
      ),
    ).toBe(true);
    expect(handlers.clearPending).toHaveBeenCalledTimes(1);
    expect(handlers.refreshStatus).toHaveBeenCalledWith("/repo/wc");
    expect(handlers.refreshWorkspace).not.toHaveBeenCalled();
  });

  it("当前工作副本已切换时只清理 pending，不刷新其他工作副本", () => {
    const taskState = {
      snapshot: makeSnapshot([makeTaskSummary({ status: "success" })]),
    };
    const handlers = makeHandlers();

    expect(
      consumePendingSvnOperationCompletion(
        "svn-1",
        "update",
        "C:/repo/original",
        "C:/repo/other",
        taskState,
        handlers,
      ),
    ).toBe(true);
    expect(handlers.clearPending).toHaveBeenCalledTimes(1);
    expect(handlers.refreshWorkspace).not.toHaveBeenCalled();
    expect(handlers.refreshStatus).not.toHaveBeenCalled();
  });

  it.each(["failed", "cancelled"] as const)(
    "%s 终态只要求清理 pending，不刷新工作副本",
    (status) => {
      const taskState = {
        snapshot: makeSnapshot([makeTaskSummary({ status })]),
      };
      const handlers = makeHandlers();

      expect(
        consumePendingSvnOperationCompletion(
          "svn-1",
          "cleanup",
          "C:/repo/wc",
          "C:/repo/wc",
          taskState,
          handlers,
        ),
      ).toBe(true);
      expect(handlers.clearPending).toHaveBeenCalledTimes(1);
      expect(handlers.refreshWorkspace).not.toHaveBeenCalled();
      expect(handlers.refreshStatus).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "running"] as const)("%s 状态不会提前完成操作", (status) => {
    const taskState = {
      snapshot: makeSnapshot([makeTaskSummary({ status })]),
    };
    const handlers = makeHandlers();

    expect(
      consumePendingSvnOperationCompletion(
        "svn-1",
        "cleanup",
        "C:/repo/wc",
        "C:/repo/wc",
        taskState,
        handlers,
      ),
    ).toBe(false);
    expect(handlers.clearPending).not.toHaveBeenCalled();
    expect(handlers.refreshWorkspace).not.toHaveBeenCalled();
    expect(handlers.refreshStatus).not.toHaveBeenCalled();
  });

  it("pending id 为空或不在快照时保持等待", () => {
    const taskState = {
      snapshot: makeSnapshot([makeTaskSummary({ task_id: "other-task", status: "success" })]),
    };
    const handlers = makeHandlers();

    expect(
      consumePendingSvnOperationCompletion(
        null,
        "cleanup",
        "C:/repo/wc",
        "C:/repo/wc",
        taskState,
        handlers,
      ),
    ).toBe(false);
    expect(
      consumePendingSvnOperationCompletion(
        "missing-task",
        "cleanup",
        "C:/repo/wc",
        "C:/repo/wc",
        taskState,
        handlers,
      ),
    ).toBe(false);
    expect(handlers.clearPending).not.toHaveBeenCalled();
    expect(handlers.refreshWorkspace).not.toHaveBeenCalled();
    expect(handlers.refreshStatus).not.toHaveBeenCalled();
  });
});

describe("createSvnOperationCreationCoordinator", () => {
  it("连续调用只创建一个任务，并在创建完成后绑定一次 pending", async () => {
    const coordinator = createSvnOperationCreationCoordinator();
    let finishCreate!: (task: { task_id: string }) => void;
    const createTask = vi.fn(
      () =>
        new Promise<{ task_id: string }>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const onCreated = vi.fn();

    const first = coordinator.create(() => false, createTask, onCreated);
    const second = coordinator.create(() => false, createTask, onCreated);

    expect(coordinator.isCreating()).toBe(true);
    expect(await second).toBe(false);
    expect(createTask).toHaveBeenCalledTimes(1);
    finishCreate({ task_id: "svn-1" });
    expect(await first).toBe(true);
    expect(onCreated).toHaveBeenCalledWith({ task_id: "svn-1" });
    expect(coordinator.isCreating()).toBe(false);
  });

  it("已有 pending 任务时不会创建新任务", async () => {
    const coordinator = createSvnOperationCreationCoordinator();
    const createTask = vi.fn();

    expect(await coordinator.create(() => true, createTask, vi.fn())).toBe(false);
    expect(createTask).not.toHaveBeenCalled();
    expect(coordinator.isCreating()).toBe(false);
  });
});

describe("working copy root normalization", () => {
  it.each([
    ["C:\\", "c:/"],
    ["C:\\Repo\\Working Copy\\", "c:/repo/working copy"],
    ["\\\\Server\\Share\\Working Copy\\", "//server/share/working copy"],
    ["/repo/wc/", "/repo/wc"],
    ["/", "/"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeWorkingCopyRoot(input)).toBe(expected);
  });

  it("compares Windows drive and UNC roots case-insensitively", () => {
    expect(isSameWorkingCopyRoot("C:\\Repo\\WC\\", "c:/repo/wc")).toBe(true);
    expect(
      isSameWorkingCopyRoot(
        "\\\\Server\\Share\\Project",
        "//server/share/project/",
      ),
    ).toBe(true);
  });

  it("keeps Unix roots case-sensitive and preserves literal backslashes", () => {
    expect(isSameWorkingCopyRoot("/Repo/WC", "/repo/wc")).toBe(false);
    expect(isSameWorkingCopyRoot("/repo/literal\\name", "/repo/literal/name")).toBe(false);
  });
});
