import type {
  SvnOperationKind,
  TaskSnapshot,
  TaskStatus,
} from "../types/api";

type TerminalTaskStatus = Extract<TaskStatus, "success" | "failed" | "cancelled">;

export interface TaskSnapshotSource {
  snapshot: TaskSnapshot;
}

export interface PendingSvnOperationCompletion {
  taskId: string;
  status: TerminalTaskStatus;
  workingCopyRoot: string | null;
  refresh: "workspace" | "status" | null;
}

export interface PendingSvnOperationCompletionHandlers {
  clearPending: () => void;
  refreshWorkspace: (workingCopyRoot: string) => void;
  refreshStatus: (workingCopyRoot: string) => void;
}

export interface SvnOperationCreationCoordinator {
  isCreating: () => boolean;
  create: <T>(
    hasPendingTask: () => boolean,
    createTask: () => Promise<T | null>,
    onCreated: (task: T) => void,
  ) => Promise<boolean>;
}

export function resolvePendingSvnOperationCompletion(
  pendingTaskId: string | null,
  operationKind: SvnOperationKind | null,
  pendingWorkingCopyRoot: string | null,
  currentWorkingCopyRoot: string | null,
  taskState: TaskSnapshotSource,
): PendingSvnOperationCompletion | null {
  if (!pendingTaskId) {
    return null;
  }

  const task = taskState.snapshot.tasks.find((item) => item.task_id === pendingTaskId);
  if (
    !task ||
    (task.status !== "success" &&
      task.status !== "failed" &&
      task.status !== "cancelled")
  ) {
    return null;
  }

  const canRefresh =
    task.status === "success" &&
    pendingWorkingCopyRoot !== null &&
    currentWorkingCopyRoot !== null &&
    isSameWorkingCopyRoot(pendingWorkingCopyRoot, currentWorkingCopyRoot);

  return {
    taskId: task.task_id,
    status: task.status,
    workingCopyRoot: pendingWorkingCopyRoot,
    refresh:
      !canRefresh
        ? null
        : operationKind === "update"
          ? "workspace"
          : "status",
  };
}

export function consumePendingSvnOperationCompletion(
  pendingTaskId: string | null,
  operationKind: SvnOperationKind | null,
  pendingWorkingCopyRoot: string | null,
  currentWorkingCopyRoot: string | null,
  taskState: TaskSnapshotSource,
  handlers: PendingSvnOperationCompletionHandlers,
): boolean {
  const completion = resolvePendingSvnOperationCompletion(
    pendingTaskId,
    operationKind,
    pendingWorkingCopyRoot,
    currentWorkingCopyRoot,
    taskState,
  );
  if (!completion) {
    return false;
  }

  handlers.clearPending();
  if (completion.refresh === "workspace" && completion.workingCopyRoot) {
    handlers.refreshWorkspace(completion.workingCopyRoot);
  } else if (completion.refresh === "status" && completion.workingCopyRoot) {
    handlers.refreshStatus(completion.workingCopyRoot);
  }

  return true;
}

export function createSvnOperationCreationCoordinator(): SvnOperationCreationCoordinator {
  let creating = false;

  return {
    isCreating: () => creating,
    async create<T>(
      hasPendingTask: () => boolean,
      createTask: () => Promise<T | null>,
      onCreated: (task: T) => void,
    ) {
      if (creating || hasPendingTask()) {
        return false;
      }

      creating = true;
      try {
        const task = await createTask();
        if (!task) {
          return false;
        }

        onCreated(task);
        return true;
      } finally {
        creating = false;
      }
    },
  };
}

function isSameWorkingCopyRoot(left: string, right: string) {
  return normalizeWorkingCopyRoot(left) === normalizeWorkingCopyRoot(right);
}

function normalizeWorkingCopyRoot(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const windowsPath = /^[a-z]:\//i.test(normalized) || normalized.startsWith("//");
  const withoutTrailingSeparator = normalized.replace(/\/+$/, "") || "/";
  return windowsPath ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
}
