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
import type {
  AppView,
  ReviewedFileState,
  SafetyCheckItem,
  SafetyCheckSummary,
  WorkspaceGroupMode,
  WorkspaceStageFilter,
} from "../types/app";
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
  stageFilter: WorkspaceStageFilter;
  abnormalOnly: boolean;
  unreviewedOnly: boolean;
  statusFilters: string[];
  groupMode: WorkspaceGroupMode;
  selectedFilePath: string | null;
  selectedFileDiff: FileDiff | null;
  selectedFileContentDiff: FileContentDiff | null;
  stagedFiles: Array<{
    path: string;
    status: string;
    contentDigest: string;
  }>;
  safetyCheck: SafetyCheckSummary;
  reviewedFiles: ReviewedFileState[];
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
  stageFilter: "all",
  abnormalOnly: false,
  unreviewedOnly: false,
  statusFilters: [],
  groupMode: "status",
  selectedFilePath: null,
  selectedFileDiff: null,
  selectedFileContentDiff: null,
  stagedFiles: [],
  safetyCheck: emptySafetyCheck(),
  reviewedFiles: [],
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
      const reviewedFiles = recent.workspace ? loadReviewedFiles(recent.workspace) : [];
      update((state) => ({
        ...state,
        current: recent.workspace,
        status: null,
        selectedFilePath: null,
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        stagedFiles: [],
        safetyCheck: emptySafetyCheck(),
        reviewedFiles,
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
      const reviewedFiles = loadReviewedFiles(current);
      update((state) => ({
        ...state,
        current,
        status: null,
        selectedFilePath: null,
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        stagedFiles: [],
        safetyCheck: emptySafetyCheck(),
        reviewedFiles,
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

  function setStageFilter(value: WorkspaceStageFilter) {
    update((state) => ({
      ...state,
      stageFilter: state.stageFilter === value ? "all" : value,
    }));
  }

  function toggleAbnormalOnly() {
    update((state) => ({
      ...state,
      abnormalOnly: !state.abnormalOnly,
    }));
  }

  function toggleUnreviewedOnly() {
    update((state) => ({
      ...state,
      unreviewedOnly: !state.unreviewedOnly,
    }));
  }

  function toggleStatusFilter(status: string) {
    update((state) => {
      const selected = new Set(state.statusFilters);
      if (selected.has(status)) {
        selected.delete(status);
      } else {
        selected.add(status);
      }

      return {
        ...state,
        statusFilters: Array.from(selected),
      };
    });
  }

  function setGroupMode(value: WorkspaceGroupMode) {
    update((state) => ({
      ...state,
      groupMode: value,
      groupByStatus: true,
    }));
  }

  function clearFilters() {
    update((state) => ({
      ...state,
      searchText: "",
      stageFilter: "all",
      abnormalOnly: false,
      unreviewedOnly: false,
      statusFilters: [],
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
      const stagedFiles = [
        ...state.stagedFiles,
        { path: file.path, status: file.status, contentDigest: file.content_digest },
      ];

      return {
        ...state,
        stagedFiles,
        safetyCheck: buildSafetyCheck(
          state.status?.files ?? [],
          stagedFiles,
          state.safetyCheck.confirmedWarningIds,
        ),
        commitError: null,
      };
    });
  }

  function unstageFile(path: string) {
    update((state) => {
      const stagedFiles = state.stagedFiles.filter((file) => file.path !== path);

      return {
        ...state,
        stagedFiles,
        safetyCheck: buildSafetyCheck(
          state.status?.files ?? [],
          stagedFiles,
          reconcileSafetyWarningConfirmations(state.safetyCheck, stagedFiles).confirmedWarningIds,
        ),
        commitError: null,
      };
    });
  }

  function markFileReviewed(path: string) {
    update((state) => {
      const file = state.status?.files.find((item) => item.path === path);
      if (!state.current || !file) {
        return state;
      }

      const nextReviewedFiles = upsertReviewedFile(state.reviewedFiles, {
        path: file.path,
        contentDigest: file.content_digest,
        reviewedAt: Date.now(),
      });
      saveReviewedFiles(state.current, nextReviewedFiles);

      return {
        ...state,
        reviewedFiles: nextReviewedFiles,
      };
    });
  }

  function markFileUnreviewed(path: string) {
    update((state) => {
      if (!state.current) {
        return state;
      }

      const nextReviewedFiles = state.reviewedFiles.filter((file) => file.path !== path);
      saveReviewedFiles(state.current, nextReviewedFiles);

      return {
        ...state,
        reviewedFiles: nextReviewedFiles,
      };
    });
  }

  function validateStagedFilesForCommit() {
    let valid = false;
    update((state) => {
      const reconciled = reconcileStagedFiles(state.stagedFiles, state.status?.files ?? []);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        reconciled,
        state.safetyCheck.confirmedWarningIds,
      );
      const message = state.commitMessage.trim();
      let commitError: string | null = null;

      if (!state.current) {
        commitError = "请先打开 SVN 工作副本";
      } else if (reconciled.length === 0) {
        commitError = "请先暂存要提交的文件";
      } else if (!message) {
        commitError = "请输入提交信息";
      } else if (safetyCheck.blockers.length > 0) {
        commitError = "安全检查存在阻塞项，请先处理冲突、缺失或阻塞文件";
      } else if (unconfirmedWarnings(safetyCheck).length > 0) {
        commitError = "安全检查存在警告项，请确认警告后再提交";
      }

      valid = commitError === null;

      return {
        ...state,
        stagedFiles: reconciled,
        safetyCheck,
        commitError,
      };
    });

    return valid;
  }

  function confirmSafetyWarnings() {
    update((state) => {
      const reconciled = reconcileStagedFiles(state.stagedFiles, state.status?.files ?? []);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        reconciled,
        state.safetyCheck.confirmedWarningIds,
      );

      return {
        ...state,
        stagedFiles: reconciled,
        safetyCheck: {
          ...safetyCheck,
          confirmedWarningIds: safetyCheck.warnings.map((item) => item.id),
        },
        commitError: null,
      };
    });
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
    update((state) => {
      const stagedFiles = state.stagedFiles.filter((file) => !committed.has(file.path));

      return {
        ...state,
        stagedFiles,
        safetyCheck: buildSafetyCheck(state.status?.files ?? [], stagedFiles),
        commitMessage: "",
        commitError: null,
        pendingCommitTaskId: null,
      };
    });
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
        safetyCheck: buildSafetyCheck(
          status.files,
          reconcileStagedFiles(state.stagedFiles, status.files),
          state.safetyCheck.confirmedWarningIds,
        ),
        reviewedFiles: reconcileReviewedFiles(state.reviewedFiles, status.files, state.current),
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
    setStageFilter,
    toggleAbnormalOnly,
    toggleUnreviewedOnly,
    toggleStatusFilter,
    setGroupMode,
    clearFilters,
    selectFile,
    stageFile,
    unstageFile,
    markFileReviewed,
    markFileUnreviewed,
    validateStagedFilesForCommit,
    confirmSafetyWarnings,
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
  stagedFiles: Array<{ path: string; status: string; contentDigest: string }>,
  currentFiles: ChangedFile[],
) {
  return stagedFiles.flatMap((stagedFile) => {
    const current = currentFiles.find((file) => file.path === stagedFile.path);
    if (!current || current.status !== stagedFile.status || !isStageable(current)) {
      return [];
    }

    return [
      {
        path: current.path,
        status: current.status,
        contentDigest: current.content_digest,
      },
    ];
  });
}

function emptySafetyCheck(): SafetyCheckSummary {
  return {
    blockers: [],
    warnings: [],
    infos: [],
    confirmedWarningIds: [],
  };
}

function buildSafetyCheck(
  files: ChangedFile[],
  stagedFiles: Array<{ path: string; status: string; contentDigest: string }>,
  confirmedWarningIds: string[] = [],
): SafetyCheckSummary {
  const stagedPaths = new Set(stagedFiles.map((file) => file.path));
  const blockers: SafetyCheckItem[] = [];
  const warnings: SafetyCheckItem[] = [];
  const infos: SafetyCheckItem[] = [];

  for (const file of files) {
    if (["conflicted", "missing", "obstructed"].includes(file.status)) {
      blockers.push({
        id: `blocker:${file.status}:${file.path}:${file.content_digest}`,
        severity: "blocker",
        title: labelSafetyStatus(file.status),
        detail: `${file.path} 当前为 ${labelSafetyStatus(file.status)}，提交前需要先处理。`,
        filePath: file.path,
      });
    }

    if (file.status === "unversioned") {
      warnings.push({
        id: `warning:unversioned:${file.path}:${file.content_digest}`,
        severity: "warning",
        title: "未版本控制文件",
        detail: `${file.path} 未加入版本控制，请确认是否需要 add 或忽略。`,
        filePath: file.path,
      });
    }

    if (looksLikeGeneratedOrTemporary(file.path)) {
      warnings.push({
        id: `warning:generated:${file.path}:${file.content_digest}`,
        severity: "warning",
        title: "疑似临时或生成文件",
        detail: `${file.path} 命中日志、临时文件或生成目录规则，请确认是否应提交。`,
        filePath: file.path,
      });
    }

    if (looksLikeLargeBinary(file.path)) {
      warnings.push({
        id: `warning:binary:${file.path}:${file.content_digest}`,
        severity: "warning",
        title: "疑似大型二进制文件",
        detail: `${file.path} 是常见二进制资源类型，提交前请确认体积和必要性。`,
        filePath: file.path,
      });
    }
  }

  if (stagedFiles.some((file) => !files.some((current) => current.path === file.path))) {
    blockers.push({
      id: "blocker:staged-missing",
      severity: "blocker",
      title: "暂存项已失效",
      detail: "部分已暂存文件不在当前状态扫描结果中，请刷新状态后重新暂存。",
      filePath: null,
    });
  }

  infos.push({
    id: "info:mixed-revision:not-implemented",
    severity: "info",
    title: "Mixed revision 待扩展检测",
    detail: "当前状态扫描尚未返回 revision 维度，后续会在工作副本状态模型扩展后接入真实检测。",
    filePath: null,
  });

  const warningIds = new Set(warnings.map((item) => item.id));
  const stagedDigestIds = new Set(
    stagedFiles.map((file) => `${file.path}:${file.contentDigest}`),
  );

  return {
    blockers,
    warnings,
    infos,
    confirmedWarningIds: confirmedWarningIds.filter((id) => {
      if (warningIds.has(id)) {
        return true;
      }

      return stagedDigestIds.has(id);
    }),
  };
}

function reconcileSafetyWarningConfirmations(
  safetyCheck: SafetyCheckSummary,
  stagedFiles: Array<{ path: string; status: string; contentDigest: string }>,
) {
  const stagedPaths = new Set(stagedFiles.map((file) => file.path));
  return {
    ...safetyCheck,
    confirmedWarningIds: safetyCheck.confirmedWarningIds.filter((id) => {
      const item = safetyCheck.warnings.find((warning) => warning.id === id);
      return !item?.filePath || stagedPaths.has(item.filePath);
    }),
  };
}

function unconfirmedWarnings(safetyCheck: SafetyCheckSummary) {
  const confirmed = new Set(safetyCheck.confirmedWarningIds);
  return safetyCheck.warnings.filter((item) => !confirmed.has(item.id));
}

function labelSafetyStatus(status: string) {
  const labels: Record<string, string> = {
    conflicted: "冲突文件",
    missing: "缺失文件",
    obstructed: "阻塞文件",
  };

  return labels[status] ?? status;
}

function looksLikeGeneratedOrTemporary(path: string) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? normalized;

  return (
    segments.some((segment) =>
      ["dist", "build", "target", "node_modules", ".cache", "coverage"].includes(segment),
    ) ||
    fileName.endsWith(".log") ||
    fileName.endsWith(".tmp") ||
    fileName.endsWith(".temp") ||
    fileName.endsWith(".bak") ||
    fileName.endsWith(".swp") ||
    fileName === ".ds_store"
  );
}

function looksLikeLargeBinary(path: string) {
  const extension = path.replaceAll("\\", "/").split(".").pop()?.toLowerCase() ?? "";
  return [
    "7z",
    "avi",
    "dmg",
    "exe",
    "gif",
    "ico",
    "iso",
    "jpg",
    "jpeg",
    "mov",
    "mp4",
    "pdf",
    "png",
    "psd",
    "rar",
    "webp",
    "zip",
  ].includes(extension);
}

function upsertReviewedFile(
  reviewedFiles: ReviewedFileState[],
  reviewedFile: ReviewedFileState,
) {
  return [
    ...reviewedFiles.filter((file) => file.path !== reviewedFile.path),
    reviewedFile,
  ];
}

function reconcileReviewedFiles(
  reviewedFiles: ReviewedFileState[],
  currentFiles: ChangedFile[],
  workspace: WorkspaceSummary | null,
) {
  const nextReviewedFiles = reviewedFiles.filter((reviewedFile) => {
    const current = currentFiles.find((file) => file.path === reviewedFile.path);
    return current && current.content_digest === reviewedFile.contentDigest;
  });

  if (workspace && nextReviewedFiles.length !== reviewedFiles.length) {
    saveReviewedFiles(workspace, nextReviewedFiles);
  }

  return nextReviewedFiles;
}

function reviewedStorageKey(workspace: WorkspaceSummary) {
  return `novasvn:reviewed-files:${workspace.working_copy_root}:${workspace.repository_url}`;
}

function loadReviewedFiles(workspace: WorkspaceSummary) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(reviewedStorageKey(workspace));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isReviewedFileState);
  } catch {
    return [];
  }
}

function saveReviewedFiles(
  workspace: WorkspaceSummary,
  reviewedFiles: ReviewedFileState[],
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      reviewedStorageKey(workspace),
      JSON.stringify(reviewedFiles),
    );
  } catch {
    // 本地持久化失败不应阻断工作副本操作。
  }
}

function isReviewedFileState(value: unknown): value is ReviewedFileState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ReviewedFileState>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.contentDigest === "string" &&
    typeof candidate.reviewedAt === "number"
  );
}
