import type { Task, TaskSnapshot, TaskStatus } from "../types/api";

type TerminalTaskStatus = Extract<
  TaskStatus,
  "success" | "failed" | "cancelled" | "interrupted"
>;

export interface PendingTaskCompletionCoordinator {
  consume: (
    pendingTaskId: string | null,
    snapshot: TaskSnapshot,
    loadTask: (taskId: string) => Promise<Task | null>,
    handleTask: (task: Task & { status: TerminalTaskStatus }) => void | Promise<void>,
  ) => Promise<boolean>;
}

export function createPendingTaskCompletionCoordinator(): PendingTaskCompletionCoordinator {
  const checkingTaskIds = new Set<string>();

  return {
    async consume(pendingTaskId, snapshot, loadTask, handleTask) {
      if (!pendingTaskId || checkingTaskIds.has(pendingTaskId)) {
        return false;
      }

      const summary = snapshot.tasks.find((task) => task.task_id === pendingTaskId);
      if (!summary || !isTerminalTaskStatus(summary.status)) {
        return false;
      }

      checkingTaskIds.add(pendingTaskId);
      try {
        const task = await loadTask(pendingTaskId);
        if (!task || !isTerminalTaskStatus(task.status)) {
          return false;
        }

        await handleTask(task as Task & { status: TerminalTaskStatus });
        return true;
      } finally {
        checkingTaskIds.delete(pendingTaskId);
      }
    },
  };
}

function isTerminalTaskStatus(status: TaskStatus): status is TerminalTaskStatus {
  return (
    status === "success" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}
