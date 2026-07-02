import { writable } from "svelte/store";
import {
  cancelTask,
  chooseWorkspaceDirectory,
  createCommitTask,
  createMockTask,
  createSvnOperationTask,
  detectSvn,
  getFileContentDiff,
  getFileDiff,
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
  FileContentDiff,
  FileDiff,
  MockTaskOutcome,
  SvnOperationKind,
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

  async function createCommit(request: {
    workingCopyRoot: string;
    message: string;
    files: string[];
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createCommitTask({
        working_copy_root: request.workingCopyRoot,
        message: request.message,
        files: request.files,
        svn_executable: request.svnExecutable || undefined,
      });
      selectedTaskId = task.task_id;
      await refresh();
      return task;
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
      return null;
    }
  }

  async function createSvnOperation(request: {
    workingCopyRoot: string;
    kind: SvnOperationKind;
    filePath?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createSvnOperationTask({
        working_copy_root: request.workingCopyRoot,
        kind: request.kind,
        file_path: request.filePath || undefined,
        svn_executable: request.svnExecutable || undefined,
      });
      selectedTaskId = task.task_id;
      await refresh();
      return task;
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
      return null;
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
    createCommit,
    createSvnOperation,
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
  selectedFileDiff: FileDiff | null;
  selectedFileContentDiff: FileContentDiff | null;
  stagedFiles: Array<{
    path: string;
    status: string;
  }>;
  commitMessage: string;
  commitError: string | null;
  pendingCommitTaskId: string | null;
  pendingSvnOperationTaskId: string | null;
  pendingSvnOperationKind: SvnOperationKind | null;
  pathInput: string;
  loading: boolean;
  statusLoading: boolean;
  diffLoading: boolean;
  contentDiffLoading: boolean;
  error: CommandError | null;
  statusError: CommandError | null;
  diffError: CommandError | null;
  contentDiffError: CommandError | null;
}

const initialWorkspaceState: WorkspaceStoreState = {
  current: null,
  status: null,
  searchText: "",
  groupByStatus: true,
  selectedFilePath: null,
  selectedFileDiff: null,
  selectedFileContentDiff: null,
  stagedFiles: [],
  commitMessage: "",
  commitError: null,
  pendingCommitTaskId: null,
  pendingSvnOperationTaskId: null,
  pendingSvnOperationKind: null,
  pathInput: "",
  loading: false,
  statusLoading: false,
  diffLoading: false,
  contentDiffLoading: false,
  error: null,
  statusError: null,
  diffError: null,
  contentDiffError: null,
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
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        stagedFiles: [],
        commitMessage: "",
        commitError: null,
        pendingCommitTaskId: null,
        pendingSvnOperationTaskId: null,
        pendingSvnOperationKind: null,
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
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        stagedFiles: [],
        commitMessage: "",
        commitError: null,
        pendingCommitTaskId: null,
        pendingSvnOperationTaskId: null,
        pendingSvnOperationKind: null,
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

  function setCommitMessage(value: string) {
    update((state) => ({
      ...state,
      commitMessage: value,
      commitError: null,
    }));
  }

  function toggleGroupByStatus() {
    update((state) => ({
      ...state,
      groupByStatus: !state.groupByStatus,
    }));
  }

  async function selectFile(path: string, svnExecutable?: string | null) {
    let root = "";
    update((state) => ({
      ...state,
      selectedFileDiff: null,
      selectedFileContentDiff: null,
      selectedFilePath: path,
    }));
    update((state) => {
      root = state.current?.working_copy_root ?? "";
      return state;
    });

    if (root) {
      await Promise.all([
        refreshFileDiff(svnExecutable, root, path),
        refreshFileContentDiff(svnExecutable, root, path),
      ]);
    }
  }

  function stageFile(path: string) {
    update((state) => {
      const file = state.status?.files.find((item) => item.path === path);
      if (!file || !isStageable(file) || state.stagedFiles.some((item) => item.path === path)) {
        return state;
      }

      return {
        ...state,
        stagedFiles: [...state.stagedFiles, { path: file.path, status: file.status }],
        commitError: null,
      };
    });
  }

  function unstageFile(path: string) {
    update((state) => ({
      ...state,
      stagedFiles: state.stagedFiles.filter((file) => file.path !== path),
      commitError: null,
    }));
  }

  function validateStagedFilesForCommit() {
    let valid = false;
    update((state) => {
      const reconciled = reconcileStagedFiles(state.stagedFiles, state.status?.files ?? []);
      const message = state.commitMessage.trim();
      let commitError: string | null = null;

      if (!state.current) {
        commitError = "请先打开 SVN 工作副本";
      } else if (reconciled.length === 0) {
        commitError = "请先暂存要提交的文件";
      } else if (!message) {
        commitError = "请输入提交信息";
      }

      valid = commitError === null;

      return {
        ...state,
        stagedFiles: reconciled,
        commitError,
      };
    });

    return valid;
  }

  function markCommitTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingCommitTaskId: taskId,
      commitError: null,
    }));
  }

  function markSvnOperationTask(taskId: string | null, kind: SvnOperationKind | null) {
    update((state) => ({
      ...state,
      pendingSvnOperationTaskId: taskId,
      pendingSvnOperationKind: kind,
    }));
  }

  function clearCommittedFiles(paths: string[]) {
    const committed = new Set(paths);
    update((state) => ({
      ...state,
      stagedFiles: state.stagedFiles.filter((file) => !committed.has(file.path)),
      commitMessage: "",
      commitError: null,
      pendingCommitTaskId: null,
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
      let previousSelectedFilePath: string | null = null;
      update((state) => {
        previousSelectedFilePath = state.selectedFilePath;
        return state;
      });
      const status = await scanWorkspaceStatus({
        working_copy_root: root,
        svn_executable: svnExecutable || undefined,
        offset: 0,
        limit: 500,
      });
      const selectedFilePath = resolveSelectedFilePath(status.files, previousSelectedFilePath);
      update((state) => ({
        ...state,
        status,
        selectedFilePath,
        selectedFileDiff:
          selectedFilePath === state.selectedFilePath ? state.selectedFileDiff : null,
        selectedFileContentDiff:
          selectedFilePath === state.selectedFilePath ? state.selectedFileContentDiff : null,
        stagedFiles: reconcileStagedFiles(state.stagedFiles, status.files),
        statusLoading: false,
        statusError: null,
      }));
      if (selectedFilePath) {
        await Promise.all([
          refreshFileDiff(svnExecutable, root, selectedFilePath),
          refreshFileContentDiff(svnExecutable, root, selectedFilePath),
        ]);
      }
    } catch (error) {
      update((state) => ({
        ...state,
        statusLoading: false,
        statusError: error as CommandError,
      }));
    }
  }

  async function refreshFileDiff(
    svnExecutable?: string | null,
    workingCopyRoot?: string,
    filePath?: string | null,
  ) {
    let root = workingCopyRoot ?? "";
    let path = filePath ?? "";
    update((state) => {
      root = root || state.current?.working_copy_root || "";
      path = path || state.selectedFilePath || "";
      return {
        ...state,
        diffLoading: true,
        diffError: null,
      };
    });

    if (!root || !path) {
      update((state) => ({
        ...state,
        selectedFileDiff: null,
        diffLoading: false,
      }));
      return;
    }

    try {
      const selectedFileDiff = await getFileDiff({
        working_copy_root: root,
        file_path: path,
        svn_executable: svnExecutable || undefined,
      });
      update((state) => ({
        ...state,
        selectedFileDiff,
        diffLoading: false,
        diffError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        selectedFileDiff: null,
        diffLoading: false,
        diffError: error as CommandError,
      }));
    }
  }

  async function refreshFileContentDiff(
    svnExecutable?: string | null,
    workingCopyRoot?: string,
    filePath?: string | null,
  ) {
    let root = workingCopyRoot ?? "";
    let path = filePath ?? "";
    update((state) => {
      root = root || state.current?.working_copy_root || "";
      path = path || state.selectedFilePath || "";
      return {
        ...state,
        contentDiffLoading: true,
        contentDiffError: null,
      };
    });

    if (!root || !path) {
      update((state) => ({
        ...state,
        selectedFileContentDiff: null,
        contentDiffLoading: false,
      }));
      return;
    }

    try {
      const selectedFileContentDiff = await getFileContentDiff({
        working_copy_root: root,
        file_path: path,
        svn_executable: svnExecutable || undefined,
        max_bytes: 512 * 1024,
      });
      update((state) => ({
        ...state,
        selectedFileContentDiff,
        contentDiffLoading: false,
        contentDiffError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        selectedFileContentDiff: null,
        contentDiffLoading: false,
        contentDiffError: error as CommandError,
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
    setCommitMessage,
    toggleGroupByStatus,
    selectFile,
    stageFile,
    unstageFile,
    validateStagedFilesForCommit,
    markCommitTask,
    markSvnOperationTask,
    clearCommittedFiles,
    refreshStatus,
    refreshFileDiff,
    refreshFileContentDiff,
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

function isStageable(file: ChangedFile) {
  return !["missing", "conflicted", "obstructed"].includes(file.status);
}

function reconcileStagedFiles(
  stagedFiles: Array<{ path: string; status: string }>,
  currentFiles: ChangedFile[],
) {
  return stagedFiles.filter((stagedFile) => {
    const current = currentFiles.find((file) => file.path === stagedFile.path);
    return current && current.status === stagedFile.status && isStageable(current);
  });
}
