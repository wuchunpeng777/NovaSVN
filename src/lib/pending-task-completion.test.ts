import { describe, expect, it, vi } from "vitest";

import type { Task, TaskSnapshot, TaskSummary } from "../types/api";
import { createPendingTaskCompletionCoordinator } from "./pending-task-completion";

describe("createPendingTaskCompletionCoordinator", () => {
  it("按 pending id 获取完整终态任务，不依赖当前选中任务", async () => {
    const coordinator = createPendingTaskCompletionCoordinator();
    const pending = makeTask({ task_id: "pending", status: "success" });
    const snapshot = makeSnapshot([
      makeSummary({ task_id: "selected", status: "running" }),
      pending,
    ]);
    const loadTask = vi.fn().mockResolvedValue(pending);
    const handleTask = vi.fn();

    expect(
      await coordinator.consume("pending", snapshot, loadTask, handleTask),
    ).toBe(true);
    expect(loadTask).toHaveBeenCalledWith("pending");
    expect(handleTask).toHaveBeenCalledWith(pending);
  });

  it.each(["success", "failed", "cancelled"] as const)(
    "消费 %s 终态",
    async (status) => {
      const coordinator = createPendingTaskCompletionCoordinator();
      const task = makeTask({ status });
      const handleTask = vi.fn();

      expect(
        await coordinator.consume(
          task.task_id,
          makeSnapshot([task]),
          vi.fn().mockResolvedValue(task),
          handleTask,
        ),
      ).toBe(true);
      expect(handleTask).toHaveBeenCalledOnce();
    },
  );

  it("任务未结束、快照缺失或详情加载失败时保持等待", async () => {
    const coordinator = createPendingTaskCompletionCoordinator();
    const pending = makeTask({ status: "running" });
    const handleTask = vi.fn();

    expect(
      await coordinator.consume(
        pending.task_id,
        makeSnapshot([pending]),
        vi.fn().mockResolvedValue(pending),
        handleTask,
      ),
    ).toBe(false);
    expect(
      await coordinator.consume(
        "missing",
        makeSnapshot([]),
        vi.fn(),
        handleTask,
      ),
    ).toBe(false);
    expect(
      await coordinator.consume(
        "failed-load",
        makeSnapshot([makeSummary({ task_id: "failed-load", status: "success" })]),
        vi.fn().mockResolvedValue(null),
        handleTask,
      ),
    ).toBe(false);
    expect(handleTask).not.toHaveBeenCalled();
  });

  it("详情加载期间重复检查只消费一次", async () => {
    const coordinator = createPendingTaskCompletionCoordinator();
    const task = makeTask({ status: "success" });
    let finishLoad!: (task: Task) => void;
    const loadTask = vi.fn(
      () => new Promise<Task>((resolve) => {
        finishLoad = resolve;
      }),
    );
    const handleTask = vi.fn();
    const snapshot = makeSnapshot([task]);

    const first = coordinator.consume(task.task_id, snapshot, loadTask, handleTask);
    const second = coordinator.consume(task.task_id, snapshot, loadTask, handleTask);

    expect(await second).toBe(false);
    finishLoad(task);
    expect(await first).toBe(true);
    expect(loadTask).toHaveBeenCalledOnce();
    expect(handleTask).toHaveBeenCalledOnce();
  });
});

function makeSummary(task: Partial<TaskSummary> = {}): TaskSummary {
  return {
    task_id: "task-1",
    title: "任务",
    status: "pending",
    error: null,
    created_at: 1,
    updated_at: 1,
    ...task,
  };
}

function makeTask(task: Partial<Task> = {}): Task {
  return {
    ...makeSummary(task),
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
