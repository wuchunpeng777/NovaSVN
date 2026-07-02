import { writable } from "svelte/store";
import {
  cancelTask,
  chooseWorkspaceDirectory,
  createMockTask,
  detectSvn,
  getRecentWorkspace,
  getTask,
  listTasks,
  openWorkspace,
  scanWorkspaceStatus,
} from "../lib/api";
import type { AppView } from "../types/app";
import type {
  ChangedFile,
  CommandError,
  MockTaskOutcome,
  SvnDetection,
  Task,
  TaskSnapshot,
  WorkingCopyStatus,
  WorkspaceSummary,
} from "../types/api";

export const currentView = writable<AppView>("changes");

export function setCurrentView(view: AppView) {
  currentView.set(view);
}

export interface TaskStoreState {
  snapshot: TaskSnapshot;
  selectedTask: Task | null;
  loading: boolean;
  error: CommandError | null;
}

const initialTaskState: TaskStoreState = {
  snapshot: {
    tasks: [],
    running_task_id: null,
  },
  selectedTask: null,
  loading: false,
  error: null,
};

function createTaskStore() {
  const { subscribe, update } = writable<TaskStoreState>(initialTaskState);
  let selectedTaskId: string | null = null;
  let pollTimer: number | null = null;

  async function refresh() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const snapshot = await listTasks();
      selectedTaskId =
        selectedTaskId ?? snapshot.running_task_id ?? snapshot.tasks[0]?.task_id ?? null;

      let selectedTask: Task | null = null;
      if (selectedTaskId) {
        const exists = snapshot.tasks.some((task) => task.task_id === selectedTaskId);
        if (exists) {
          selectedTask = await getTask(selectedTaskId);
        } else {
          selectedTaskId = snapshot.running_task_id ?? snapshot.tasks[0]?.task_id ?? null;
          selectedTask = selectedTaskId ? await getTask(selectedTaskId) : null;
        }
      }

      update((state) => ({
        ...state,
        snapshot,
        selectedTask,
        loading: false,
        error: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function create(outcome: MockTaskOutcome) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createMockTask({
        outcome,
        title: outcome === "success" ? "模拟成功任务" : "模拟失败任务",
      });
      selectedTaskId = task.task_id;
      await refresh();
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function select(taskId: string) {
    selectedTaskId = taskId;
    await refresh();
  }

  async function cancel(taskId: string) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      await cancelTask(taskId);
      await refresh();
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  function startPolling() {
    if (pollTimer !== null) {
      return;
    }

    void refresh();
    pollTimer = window.setInterval(() => {
      void refresh();
    }, 900);
  }

  function stopPolling() {
    if (pollTimer === null) {
      return;
    }

    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    subscribe,
    refresh,
    create,
    select,
    cancel,
    startPolling,
    stopPolling,
  };
}

export const taskStore = createTaskStore();

export interface SvnStoreState {
  detection: SvnDetection | null;
  executableInput: string;
  loading: boolean;
  error: CommandError | null;
}

const initialSvnState: SvnStoreState = {
  detection: null,
  executableInput: "",
  loading: false,
  error: null,
};

function createSvnStore() {
  const { subscribe, update } = writable<SvnStoreState>(initialSvnState);

  async function detect() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const detection = await detectSvn();
      update((state) => ({
        ...state,
        detection,
        executableInput: state.executableInput || detection.resolved_path || detection.executable,
        loading: false,
        error: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        detection: null,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function detectWithInput() {
    update((state) => ({ ...state, loading: true, error: null }));

    let executable = "";
    update((state) => {
      executable = state.executableInput.trim();
      return state;
    });

    try {
      const detection = await detectSvn({ executable });
      update((state) => ({
        ...state,
        detection,
        executableInput: executable || detection.resolved_path || detection.executable,
        loading: false,
        error: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        detection: null,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  function setExecutableInput(value: string) {
    update((state) => ({
      ...state,
      executableInput: value,
    }));
  }

  return {
    subscribe,
    detect,
    detectWithInput,
    setExecutableInput,
  };
}

export const svnStore = createSvnStore();

export interface WorkspaceStoreState {
  current: WorkspaceSummary | null;
  status: WorkingCopyStatus | null;
  searchText: string;
  groupByStatus: boolean;
  selectedFilePath: string | null;
  pathInput: string;
  loading: boolean;
  statusLoading: boolean;
  error: CommandError | null;
  statusError: CommandError | null;
}

const initialWorkspaceState: WorkspaceStoreState = {
  current: null,
  status: null,
  searchText: "",
  groupByStatus: true,
  selectedFilePath: null,
  pathInput: "",
  loading: false,
  statusLoading: false,
  error: null,
  statusError: null,
};

function createWorkspaceStore() {
  const { subscribe, update } = writable<WorkspaceStoreState>(initialWorkspaceState);

  async function loadRecent() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const recent = await getRecentWorkspace();
      const root = recent.workspace?.working_copy_root;
      update((state) => ({
        ...state,
        current: recent.workspace,
        status: null,
        selectedFilePath: null,
        pathInput: state.pathInput || root || "",
        loading: false,
        error: null,
      }));
      if (root) {
        await refreshStatus(null, root);
      }
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function openPath(svnExecutable?: string | null) {
    update((state) => ({ ...state, loading: true, error: null }));

    let path = "";
    update((state) => {
      path = state.pathInput.trim();
      return state;
    });

    try {
      const current = await openWorkspace({
        path,
        svn_executable: svnExecutable || undefined,
      });
      update((state) => ({
        ...state,
        current,
        status: null,
        selectedFilePath: null,
        pathInput: current.working_copy_root,
        loading: false,
        error: null,
      }));
      await refreshStatus(svnExecutable, current.working_copy_root);
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function chooseAndOpen(svnExecutable?: string | null) {
    update((state) => ({ ...state, error: null }));

    try {
      const selected = await chooseWorkspaceDirectory();
      if (!selected) {
        return;
      }

      update((state) => ({
        ...state,
        pathInput: selected,
      }));
      await openPath(svnExecutable);
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  function setPathInput(value: string) {
    update((state) => ({
      ...state,
      pathInput: value,
    }));
  }

  function setSearchText(value: string) {
    update((state) => ({
      ...state,
      searchText: value,
    }));
  }

  function toggleGroupByStatus() {
    update((state) => ({
      ...state,
      groupByStatus: !state.groupByStatus,
    }));
  }

  function selectFile(path: string) {
    update((state) => ({
      ...state,
      selectedFilePath: path,
    }));
  }

  async function refreshStatus(
    svnExecutable?: string | null,
    workingCopyRoot?: string,
  ) {
    let root = workingCopyRoot ?? "";
    update((state) => {
      root = root || state.current?.working_copy_root || "";
      return {
        ...state,
        statusLoading: true,
        statusError: null,
      };
    });

    if (!root) {
      update((state) => ({
        ...state,
        statusLoading: false,
        statusError: {
          code: "WORKSPACE_REQUIRED",
          message: "请先打开 SVN 工作副本",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }

    try {
      const status = await scanWorkspaceStatus({
        working_copy_root: root,
        svn_executable: svnExecutable || undefined,
        offset: 0,
        limit: 500,
      });
      update((state) => ({
        ...state,
        status,
        selectedFilePath: resolveSelectedFilePath(status.files, state.selectedFilePath),
        statusLoading: false,
        statusError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        statusLoading: false,
        statusError: error as CommandError,
      }));
    }
  }

  return {
    subscribe,
    loadRecent,
    openPath,
    chooseAndOpen,
    setPathInput,
    setSearchText,
    toggleGroupByStatus,
    selectFile,
    refreshStatus,
  };
}

export const workspaceStore = createWorkspaceStore();

function resolveSelectedFilePath(
  files: ChangedFile[],
  selectedFilePath: string | null,
) {
  if (selectedFilePath && files.some((file) => file.path === selectedFilePath)) {
    return selectedFilePath;
  }

  return files[0]?.path ?? null;
}
