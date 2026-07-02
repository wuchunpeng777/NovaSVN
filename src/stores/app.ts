import { get, writable } from "svelte/store";
import {
  cancelTask,
  chooseWorkspaceDirectory,
  createCommitTask,
  createMockTask,
  createPartialCommitTask,
  createRepositoryCopyTask,
  createRepositoryListTask,
  createShadowWorkspaceTask,
  createSvnOperationTask,
  detectSvn,
  getFileContentDiff,
  getFileDiff,
  generateSelectedPatch,
  getShadowWorkspaceStatus,
  getRecentWorkspace,
  getTask,
  listTasks,
  openWorkspace,
  parseUnifiedDiff,
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
  ParsedFileDiff,
  RepositoryListResult,
  RepositoryCopyKind,
  SelectedPatch,
  ShadowWorkspaceOperationKind,
  ShadowWorkspaceStatus,
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

  async function createShadowWorkspace(request: {
    workingCopyRoot: string;
    repositoryUrl: string;
    revision?: string | null;
    kind: ShadowWorkspaceOperationKind;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createShadowWorkspaceTask({
        working_copy_root: request.workingCopyRoot,
        repository_url: request.repositoryUrl,
        revision: request.revision || undefined,
        kind: request.kind,
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

  async function createPartialCommit(request: {
    workingCopyRoot: string;
    repositoryUrl: string;
    revision?: string | null;
    message: string;
    selectedPatch: string;
    files: string[];
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createPartialCommitTask({
        working_copy_root: request.workingCopyRoot,
        repository_url: request.repositoryUrl,
        revision: request.revision || undefined,
        message: request.message,
        selected_patch: request.selectedPatch,
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

  async function createRepositoryList(request: {
    url: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryListTask({
        url: request.url,
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

  async function createRepositoryCopy(request: {
    kind: RepositoryCopyKind;
    sourceUrl: string;
    targetUrl: string;
    revision?: string | null;
    message: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryCopyTask({
        kind: request.kind,
        source_url: request.sourceUrl,
        target_url: request.targetUrl,
        revision: request.revision || undefined,
        message: request.message,
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

  async function getTaskById(taskId: string) {
    try {
      return await getTask(taskId);
    } catch {
      return null;
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
    createShadowWorkspace,
    createPartialCommit,
    createRepositoryList,
    createRepositoryCopy,
    select,
    cancel,
    getTaskById,
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
  selectedFileParsedDiff: ParsedFileDiff | null;
  selectedPatch: SelectedPatch | null;
  stagedFiles: Array<{
    path: string;
    status: string;
    contentDigest: string;
  }>;
  safetyCheck: SafetyCheckSummary;
  selectedHunks: Array<{
    filePath: string;
    fileDigest: string;
    hunkId: string;
  }>;
  reviewedFiles: ReviewedFileState[];
  commitTemplate: string;
  commitHistory: string[];
  commitMessage: string;
  commitError: string | null;
  pendingCommitTaskId: string | null;
  pendingPartialCommitTaskId: string | null;
  pendingSvnOperationTaskId: string | null;
  pendingSvnOperationKind: SvnOperationKind | null;
  repositoryUrlInput: string;
  repositoryCurrentUrl: string;
  repositoryList: RepositoryListResult | null;
  pendingRepositoryListTaskId: string | null;
  repositoryLayout: {
    trunkPath: string;
    branchesPath: string;
    tagsPath: string;
  };
  repositoryLayoutTasks: {
    trunk: string | null;
    branches: string | null;
    tags: string | null;
  };
  repositoryLayoutResults: {
    trunk: RepositoryListResult | null;
    branches: RepositoryListResult | null;
    tags: RepositoryListResult | null;
  };
  repositoryLayoutErrors: {
    trunk: string | null;
    branches: string | null;
    tags: string | null;
  };
  repositoryLayoutLoading: boolean;
  repositoryCopyForm: {
    kind: RepositoryCopyKind;
    sourceUrl: string;
    targetUrl: string;
    revision: string;
    message: string;
  };
  pendingRepositoryCopyTaskId: string | null;
  repositoryCopyError: string | null;
  repositoryLoading: boolean;
  repositoryError: string | null;
  shadowStatus: ShadowWorkspaceStatus | null;
  shadowLoading: boolean;
  shadowError: CommandError | null;
  pathInput: string;
  loading: boolean;
  statusLoading: boolean;
  diffLoading: boolean;
  contentDiffLoading: boolean;
  selectedPatchLoading: boolean;
  error: CommandError | null;
  statusError: CommandError | null;
  diffError: CommandError | null;
  contentDiffError: CommandError | null;
  parsedDiffError: CommandError | null;
  selectedPatchError: CommandError | null;
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
  selectedFileParsedDiff: null,
  selectedPatch: null,
  stagedFiles: [],
  safetyCheck: emptySafetyCheck(),
  selectedHunks: [],
  reviewedFiles: [],
  commitTemplate: "",
  commitHistory: [],
  commitMessage: "",
  commitError: null,
  pendingCommitTaskId: null,
  pendingPartialCommitTaskId: null,
  pendingSvnOperationTaskId: null,
  pendingSvnOperationKind: null,
  repositoryUrlInput: "",
  repositoryCurrentUrl: "",
  repositoryList: null,
  pendingRepositoryListTaskId: null,
  repositoryLayout: {
    trunkPath: "trunk",
    branchesPath: "branches",
    tagsPath: "tags",
  },
  repositoryLayoutTasks: {
    trunk: null,
    branches: null,
    tags: null,
  },
  repositoryLayoutResults: {
    trunk: null,
    branches: null,
    tags: null,
  },
  repositoryLayoutErrors: {
    trunk: null,
    branches: null,
    tags: null,
  },
  repositoryLayoutLoading: false,
  repositoryCopyForm: {
    kind: "branch",
    sourceUrl: "",
    targetUrl: "",
    revision: "",
    message: "",
  },
  pendingRepositoryCopyTaskId: null,
  repositoryCopyError: null,
  repositoryLoading: false,
  repositoryError: null,
  shadowStatus: null,
  shadowLoading: false,
  shadowError: null,
  pathInput: "",
  loading: false,
  statusLoading: false,
  diffLoading: false,
  contentDiffLoading: false,
  selectedPatchLoading: false,
  error: null,
  statusError: null,
  diffError: null,
  contentDiffError: null,
  parsedDiffError: null,
  selectedPatchError: null,
};

function createWorkspaceStore() {
  const { subscribe, update } = writable<WorkspaceStoreState>(initialWorkspaceState);

  async function loadRecent() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const recent = await getRecentWorkspace();
      const root = recent.workspace?.working_copy_root;
      const draft = recent.workspace ? loadWorkspaceDraft(recent.workspace) : emptyWorkspaceDraft();
      const commitSettings = loadCommitMessageSettings();
      update((state) => ({
        ...state,
        current: recent.workspace,
        status: null,
        selectedFilePath: null,
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        selectedFileParsedDiff: null,
        stagedFiles: draft.stagedFiles,
        safetyCheck: {
          ...emptySafetyCheck(),
          confirmedWarningIds: draft.confirmedWarningIds,
        },
        selectedHunks: draft.selectedHunks,
        reviewedFiles: draft.reviewedFiles,
        commitTemplate: commitSettings.template,
        commitHistory: commitSettings.history,
        commitMessage: draft.commitMessage || commitSettings.template,
        commitError: null,
        pendingCommitTaskId: null,
        pendingPartialCommitTaskId: null,
        pendingSvnOperationTaskId: null,
        pendingSvnOperationKind: null,
        repositoryUrlInput: recent.workspace?.repository_root ?? state.repositoryUrlInput,
        repositoryCurrentUrl: "",
        repositoryList: null,
        pendingRepositoryListTaskId: null,
        repositoryLayoutTasks: emptyRepositoryLayoutTasks(),
        repositoryLayoutResults: emptyRepositoryLayoutResults(),
        repositoryLayoutErrors: emptyRepositoryLayoutErrors(),
        repositoryLayoutLoading: false,
        repositoryCopyForm: {
          ...emptyRepositoryCopyForm(),
          sourceUrl: recent.workspace?.repository_url ?? "",
          revision: recent.workspace?.revision ?? "",
        },
        pendingRepositoryCopyTaskId: null,
        repositoryCopyError: null,
        repositoryLoading: false,
        repositoryError: null,
        shadowStatus: null,
        shadowError: null,
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
      const draft = loadWorkspaceDraft(current);
      const commitSettings = loadCommitMessageSettings();
      update((state) => ({
        ...state,
        current,
        status: null,
        selectedFilePath: null,
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        selectedFileParsedDiff: null,
        stagedFiles: draft.stagedFiles,
        safetyCheck: {
          ...emptySafetyCheck(),
          confirmedWarningIds: draft.confirmedWarningIds,
        },
        selectedHunks: draft.selectedHunks,
        reviewedFiles: draft.reviewedFiles,
        commitTemplate: commitSettings.template,
        commitHistory: commitSettings.history,
        commitMessage: draft.commitMessage || commitSettings.template,
        commitError: null,
        pendingCommitTaskId: null,
        pendingPartialCommitTaskId: null,
        pendingSvnOperationTaskId: null,
        pendingSvnOperationKind: null,
        repositoryUrlInput: current.repository_root,
        repositoryCurrentUrl: "",
        repositoryList: null,
        pendingRepositoryListTaskId: null,
        repositoryLayoutTasks: emptyRepositoryLayoutTasks(),
        repositoryLayoutResults: emptyRepositoryLayoutResults(),
        repositoryLayoutErrors: emptyRepositoryLayoutErrors(),
        repositoryLayoutLoading: false,
        repositoryCopyForm: {
          ...emptyRepositoryCopyForm(),
          sourceUrl: current.repository_url,
          revision: current.revision,
        },
        pendingRepositoryCopyTaskId: null,
        repositoryCopyError: null,
        repositoryLoading: false,
        repositoryError: null,
        shadowStatus: null,
        shadowError: null,
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
    update((state) => {
      saveWorkspaceDraftFromState({
        ...state,
        commitMessage: value,
      });

      return {
        ...state,
        commitMessage: value,
        commitError: null,
      };
    });
  }

  function setCommitTemplate(value: string) {
    update((state) => {
      const commitTemplate = value;
      saveCommitMessageSettings({
        template: commitTemplate,
        history: state.commitHistory,
      });
      const commitMessage = state.commitMessage.trim() ? state.commitMessage : commitTemplate;
      saveWorkspaceDraftFromState({
        ...state,
        commitMessage,
      });

      return {
        ...state,
        commitTemplate,
        commitMessage,
      };
    });
  }

  function useCommitHistoryMessage(value: string) {
    update((state) => {
      saveWorkspaceDraftFromState({
        ...state,
        commitMessage: value,
      });

      return {
        ...state,
        commitMessage: value,
        commitError: null,
      };
    });
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
      selectedFileParsedDiff: null,
      selectedPatch: null,
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
      await refreshParsedDiff(path);
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
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        stagedFiles,
        state.safetyCheck.confirmedWarningIds,
      );
      saveWorkspaceDraftFromState({ ...state, stagedFiles, safetyCheck });

      return {
        ...state,
        stagedFiles,
        safetyCheck,
        commitError: null,
      };
    });
  }

  function unstageFile(path: string) {
    update((state) => {
      const stagedFiles = state.stagedFiles.filter((file) => file.path !== path);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        stagedFiles,
        reconcileSafetyWarningConfirmations(state.safetyCheck, stagedFiles).confirmedWarningIds,
      );
      saveWorkspaceDraftFromState({ ...state, stagedFiles, safetyCheck });

      return {
        ...state,
        stagedFiles,
        safetyCheck,
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
      saveWorkspaceDraftFromState({ ...state, reviewedFiles: nextReviewedFiles });

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
      saveWorkspaceDraftFromState({ ...state, reviewedFiles: nextReviewedFiles });

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
      saveWorkspaceDraftFromState({
        ...state,
        stagedFiles: reconciled,
        safetyCheck,
      });

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
      const nextSafetyCheck = {
        ...safetyCheck,
        confirmedWarningIds: safetyCheck.warnings.map((item) => item.id),
      };
      saveWorkspaceDraftFromState({
        ...state,
        stagedFiles: reconciled,
        safetyCheck: nextSafetyCheck,
      });

      return {
        ...state,
        stagedFiles: reconciled,
        safetyCheck: nextSafetyCheck,
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

  function markPartialCommitTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingPartialCommitTaskId: taskId,
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

  function setRepositoryUrlInput(value: string) {
    update((state) => ({
      ...state,
      repositoryUrlInput: value,
      repositoryError: null,
    }));
  }

  function useWorkspaceRepositoryRoot() {
    update((state) => ({
      ...state,
      repositoryUrlInput: state.current?.repository_root ?? state.repositoryUrlInput,
      repositoryError: state.current ? null : "请先打开 SVN 工作副本",
    }));
  }

  function markRepositoryListTask(taskId: string | null, url?: string) {
    update((state) => ({
      ...state,
      pendingRepositoryListTaskId: taskId,
      repositoryCurrentUrl: url ?? state.repositoryCurrentUrl,
      repositoryLoading: taskId !== null,
      repositoryError: null,
    }));
  }

  function applyRepositoryListResult(result: RepositoryListResult) {
    update((state) => ({
      ...state,
      repositoryUrlInput: result.url,
      repositoryCurrentUrl: result.url,
      repositoryList: result,
      pendingRepositoryListTaskId: null,
      repositoryLoading: false,
      repositoryError: null,
    }));
  }

  function failRepositoryList(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryListTaskId: null,
      repositoryLoading: false,
      repositoryError: message ?? "仓库目录加载失败",
    }));
  }

  function setRepositoryLayoutPath(kind: "trunk" | "branches" | "tags", value: string) {
    update((state) => ({
      ...state,
      repositoryLayout: {
        ...state.repositoryLayout,
        [`${kind}Path`]: value,
      },
      repositoryLayoutErrors: {
        ...state.repositoryLayoutErrors,
        [kind]: null,
      },
    }));
  }

  function markRepositoryLayoutTask(
    kind: "trunk" | "branches" | "tags",
    taskId: string | null,
  ) {
    update((state) => {
      const tasks = {
        ...state.repositoryLayoutTasks,
        [kind]: taskId,
      };

      return {
        ...state,
        repositoryLayoutTasks: tasks,
        repositoryLayoutLoading: Object.values(tasks).some(Boolean),
        repositoryLayoutErrors: {
          ...state.repositoryLayoutErrors,
          [kind]: null,
        },
      };
    });
  }

  function applyRepositoryLayoutResult(
    kind: "trunk" | "branches" | "tags",
    result: RepositoryListResult,
  ) {
    update((state) => {
      const tasks = {
        ...state.repositoryLayoutTasks,
        [kind]: null,
      };

      return {
        ...state,
        repositoryLayoutTasks: tasks,
        repositoryLayoutResults: {
          ...state.repositoryLayoutResults,
          [kind]: result,
        },
        repositoryLayoutErrors: {
          ...state.repositoryLayoutErrors,
          [kind]: null,
        },
        repositoryLayoutLoading: Object.values(tasks).some(Boolean),
      };
    });
  }

  function failRepositoryLayoutResult(
    kind: "trunk" | "branches" | "tags",
    message: string | null,
  ) {
    update((state) => {
      const tasks = {
        ...state.repositoryLayoutTasks,
        [kind]: null,
      };

      return {
        ...state,
        repositoryLayoutTasks: tasks,
        repositoryLayoutErrors: {
          ...state.repositoryLayoutErrors,
          [kind]: message ?? "仓库布局识别失败",
        },
        repositoryLayoutLoading: Object.values(tasks).some(Boolean),
      };
    });
  }

  function setRepositoryCopyForm(
    field: keyof WorkspaceStoreState["repositoryCopyForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryCopyForm: {
        ...state.repositoryCopyForm,
        [field]: field === "kind" && value === "tag" ? "tag" : value,
      },
      repositoryCopyError: null,
    }));
  }

  function prepareRepositoryCopyTarget(kind: RepositoryCopyKind, targetBaseUrl?: string | null) {
    update((state) => {
      const baseUrl =
        targetBaseUrl ||
        (kind === "branch"
          ? state.repositoryLayoutResults.branches?.url
          : state.repositoryLayoutResults.tags?.url) ||
        state.repositoryUrlInput;
      const suffix = kind === "branch" ? "new-branch" : "new-tag";

      return {
        ...state,
        repositoryCopyForm: {
          ...state.repositoryCopyForm,
          kind,
          sourceUrl: state.repositoryCopyForm.sourceUrl || state.current?.repository_url || "",
          targetUrl: baseUrl ? `${baseUrl.replace(/\/+$/, "")}/${suffix}` : "",
          revision: state.repositoryCopyForm.revision || state.current?.revision || "",
        },
        repositoryCopyError: null,
      };
    });
  }

  function markRepositoryCopyTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryCopyTaskId: taskId,
      repositoryCopyError: null,
    }));
  }

  function completeRepositoryCopyTask() {
    update((state) => ({
      ...state,
      pendingRepositoryCopyTaskId: null,
      repositoryCopyForm: {
        ...state.repositoryCopyForm,
        targetUrl: "",
        message: "",
      },
      repositoryCopyError: null,
    }));
  }

  function failRepositoryCopyTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryCopyTaskId: null,
      repositoryCopyError: message ?? "创建分支或标签失败",
    }));
  }

  function clearCommittedFiles(paths: string[]) {
    const committed = new Set(paths);
    update((state) => {
      const stagedFiles = state.stagedFiles.filter((file) => !committed.has(file.path));
      const commitHistory = recordCommitHistory(
        state.commitMessage,
        state.commitHistory,
        state.commitTemplate,
      );
      const nextState = {
        ...state,
        stagedFiles,
        safetyCheck: buildSafetyCheck(state.status?.files ?? [], stagedFiles),
        commitHistory,
        commitMessage: state.commitTemplate,
      };
      saveWorkspaceDraftFromState(nextState);

      return {
        ...state,
        stagedFiles,
        safetyCheck: nextState.safetyCheck,
        commitHistory,
        commitMessage: state.commitTemplate,
        commitError: null,
        pendingCommitTaskId: null,
        pendingPartialCommitTaskId: null,
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
      update((state) => {
        const stagedFiles = reconcileStagedFiles(state.stagedFiles, status.files);
        const reviewedFiles = reconcileReviewedFiles(state.reviewedFiles, status.files);
        const selectedHunks = reconcileSelectedHunks(state.selectedHunks, status.files);
        const safetyCheck = buildSafetyCheck(
          status.files,
          stagedFiles,
          state.safetyCheck.confirmedWarningIds,
        );
        const nextState = {
          ...state,
          status,
          selectedFilePath,
          selectedFileDiff:
            selectedFilePath === state.selectedFilePath ? state.selectedFileDiff : null,
          selectedFileContentDiff:
            selectedFilePath === state.selectedFilePath ? state.selectedFileContentDiff : null,
          stagedFiles,
          safetyCheck,
          selectedHunks,
          selectedPatch: null,
          reviewedFiles,
          statusLoading: false,
          statusError: null,
        };
        saveWorkspaceDraftFromState(nextState);
        return nextState;
      });
      if (selectedFilePath) {
        await Promise.all([
          refreshFileDiff(svnExecutable, root, selectedFilePath),
          refreshFileContentDiff(svnExecutable, root, selectedFilePath),
        ]);
        await refreshParsedDiff(selectedFilePath);
      }
    } catch (error) {
      update((state) => ({
        ...state,
        statusLoading: false,
        statusError: error as CommandError,
      }));
    }
  }

  function clearWorkspaceDraft() {
    update((state) => {
      if (state.current) {
        clearWorkspaceDraftStorage(state.current);
      }

      return {
        ...state,
        stagedFiles: [],
        reviewedFiles: [],
        safetyCheck: emptySafetyCheck(),
        commitMessage: state.commitTemplate,
        selectedHunks: [],
        selectedPatch: null,
        commitError: null,
      };
    });
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

  async function refreshParsedDiff(filePath?: string | null) {
    let path = filePath ?? "";
    let diffText = "";
    update((state) => {
      path = path || state.selectedFilePath || "";
      diffText = state.selectedFileDiff?.text ?? "";
      return {
        ...state,
        selectedFileParsedDiff: null,
        parsedDiffError: null,
      };
    });

    if (!path || !diffText.trim()) {
      return;
    }

    try {
      const parsed = await parseUnifiedDiff(diffText);
      const selectedFileParsedDiff =
        parsed.files.find((file) => file.path === path) ?? parsed.files[0] ?? null;
      update((state) => ({
        ...state,
        selectedFileParsedDiff,
        parsedDiffError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        selectedFileParsedDiff: null,
        parsedDiffError: error as CommandError,
      }));
    }
  }

  function toggleHunkSelection(filePath: string, hunkId: string) {
    update((state) => {
      const file = state.status?.files.find((item) => item.path === filePath);
      if (!file) {
        return state;
      }

      const exists = state.selectedHunks.some(
        (item) =>
          item.filePath === filePath &&
          item.fileDigest === file.content_digest &&
          item.hunkId === hunkId,
      );
      const selectedHunks = exists
        ? state.selectedHunks.filter(
            (item) =>
              !(
                item.filePath === filePath &&
                item.fileDigest === file.content_digest &&
                item.hunkId === hunkId
              ),
          )
        : [
            ...state.selectedHunks.filter(
              (item) => item.filePath !== filePath || item.fileDigest === file.content_digest,
            ),
            {
              filePath,
              fileDigest: file.content_digest,
              hunkId,
            },
          ];

      saveWorkspaceDraftFromState({ ...state, selectedHunks });

      return {
        ...state,
        selectedHunks,
        selectedPatch: null,
        selectedPatchError: null,
      };
    });
  }

  async function previewSelectedPatch() {
    let parsedDiff: ParsedFileDiff | null = null;
    let selectedHunkIds: string[] = [];
    update((state) => {
      parsedDiff = state.selectedFileParsedDiff;
      const selectedFile = state.status?.files.find(
        (file) => file.path === state.selectedFilePath,
      );
      selectedHunkIds = selectedFile
        ? state.selectedHunks
            .filter(
              (item) =>
                item.filePath === selectedFile.path &&
                item.fileDigest === selectedFile.content_digest,
            )
            .map((item) => item.hunkId)
        : [];
      return {
        ...state,
        selectedPatchLoading: true,
        selectedPatchError: null,
      };
    });

    if (!parsedDiff || selectedHunkIds.length === 0) {
      update((state) => ({
        ...state,
        selectedPatch: null,
        selectedPatchLoading: false,
      }));
      return;
    }

    try {
      const selectedPatch = await generateSelectedPatch({
        parsed_diff: { files: [parsedDiff] },
        selected_hunk_ids: selectedHunkIds,
      });
      update((state) => ({
        ...state,
        selectedPatch,
        selectedPatchLoading: false,
        selectedPatchError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        selectedPatch: null,
        selectedPatchLoading: false,
        selectedPatchError: error as CommandError,
      }));
    }
  }

  async function refreshShadowStatus(svnExecutable?: string | null) {
    const current = get({ subscribe }).current;
    update((state) => {
      return {
        ...state,
        shadowLoading: true,
        shadowError: null,
      };
    });

    if (!current) {
      update((state) => ({
        ...state,
        shadowLoading: false,
        shadowError: {
          code: "WORKSPACE_REQUIRED",
          message: "请先打开 SVN 工作副本",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }

    try {
      const shadowStatus = await getShadowWorkspaceStatus({
        working_copy_root: current.working_copy_root,
        repository_url: current.repository_url,
        revision: current.revision,
        svn_executable: svnExecutable || undefined,
      });
      update((state) => ({
        ...state,
        shadowStatus,
        shadowLoading: false,
        shadowError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        shadowLoading: false,
        shadowError: error as CommandError,
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
    setCommitTemplate,
    useCommitHistoryMessage,
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
    markPartialCommitTask,
    markSvnOperationTask,
    setRepositoryUrlInput,
    useWorkspaceRepositoryRoot,
    markRepositoryListTask,
    applyRepositoryListResult,
    failRepositoryList,
    setRepositoryLayoutPath,
    markRepositoryLayoutTask,
    applyRepositoryLayoutResult,
    failRepositoryLayoutResult,
    setRepositoryCopyForm,
    prepareRepositoryCopyTarget,
    markRepositoryCopyTask,
    completeRepositoryCopyTask,
    failRepositoryCopyTask,
    clearCommittedFiles,
    clearWorkspaceDraft,
    refreshStatus,
    refreshFileDiff,
    refreshFileContentDiff,
    refreshParsedDiff,
    toggleHunkSelection,
    previewSelectedPatch,
    refreshShadowStatus,
  };
}

export const workspaceStore = createWorkspaceStore();

function emptyRepositoryLayoutTasks() {
  return {
    trunk: null,
    branches: null,
    tags: null,
  };
}

function emptyRepositoryLayoutResults() {
  return {
    trunk: null,
    branches: null,
    tags: null,
  };
}

function emptyRepositoryLayoutErrors() {
  return {
    trunk: null,
    branches: null,
    tags: null,
  };
}

function emptyRepositoryCopyForm() {
  return {
    kind: "branch" as RepositoryCopyKind,
    sourceUrl: "",
    targetUrl: "",
    revision: "",
    message: "",
  };
}

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
) {
  return reviewedFiles.filter((reviewedFile) => {
    const current = currentFiles.find((file) => file.path === reviewedFile.path);
    return current && current.content_digest === reviewedFile.contentDigest;
  });
}

function reconcileSelectedHunks(
  selectedHunks: Array<{ filePath: string; fileDigest: string; hunkId: string }>,
  currentFiles: ChangedFile[],
) {
  return selectedHunks.filter((selectedHunk) => {
    const current = currentFiles.find((file) => file.path === selectedHunk.filePath);
    return current && current.content_digest === selectedHunk.fileDigest;
  });
}

interface WorkspaceDraft {
  version: number;
  stagedFiles: Array<{
    path: string;
    status: string;
    contentDigest: string;
  }>;
  selectedHunks: Array<{
    filePath: string;
    fileDigest: string;
    hunkId: string;
  }>;
  reviewedFiles: ReviewedFileState[];
  confirmedWarningIds: string[];
  commitMessage: string;
  updatedAt: number;
}

function emptyWorkspaceDraft(): WorkspaceDraft {
  return {
    version: 1,
    stagedFiles: [],
    selectedHunks: [],
    reviewedFiles: [],
    confirmedWarningIds: [],
    commitMessage: "",
    updatedAt: 0,
  };
}

function workspaceDraftStorageKey(workspace: WorkspaceSummary) {
  return `novasvn:workspace-draft:${workspace.working_copy_root}:${workspace.repository_url}`;
}

function legacyReviewedStorageKey(workspace: WorkspaceSummary) {
  return `novasvn:reviewed-files:${workspace.working_copy_root}:${workspace.repository_url}`;
}

function loadWorkspaceDraft(workspace: WorkspaceSummary): WorkspaceDraft {
  if (typeof window === "undefined") {
    return emptyWorkspaceDraft();
  }

  try {
    const raw = window.localStorage.getItem(workspaceDraftStorageKey(workspace));
    if (!raw) {
      return {
        ...emptyWorkspaceDraft(),
        reviewedFiles: loadLegacyReviewedFiles(workspace),
      };
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceDraft>;
    return {
      version: 1,
      stagedFiles: Array.isArray(parsed.stagedFiles)
        ? parsed.stagedFiles.filter(isStagedFileDraft)
        : [],
      selectedHunks: Array.isArray(parsed.selectedHunks)
        ? parsed.selectedHunks.filter(isSelectedHunkDraft)
        : [],
      reviewedFiles: Array.isArray(parsed.reviewedFiles)
        ? parsed.reviewedFiles.filter(isReviewedFileState)
        : loadLegacyReviewedFiles(workspace),
      confirmedWarningIds: Array.isArray(parsed.confirmedWarningIds)
        ? parsed.confirmedWarningIds.filter((item): item is string => typeof item === "string")
        : [],
      commitMessage: typeof parsed.commitMessage === "string" ? parsed.commitMessage : "",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return {
      ...emptyWorkspaceDraft(),
      reviewedFiles: loadLegacyReviewedFiles(workspace),
    };
  }
}

function saveWorkspaceDraftFromState(state: Pick<
  WorkspaceStoreState,
  | "current"
  | "stagedFiles"
  | "selectedHunks"
  | "reviewedFiles"
  | "safetyCheck"
  | "commitMessage"
>) {
  if (!state.current) {
    return;
  }

  saveWorkspaceDraft(state.current, {
    version: 1,
    stagedFiles: state.stagedFiles,
    selectedHunks: state.selectedHunks,
    reviewedFiles: state.reviewedFiles,
    confirmedWarningIds: state.safetyCheck.confirmedWarningIds,
    commitMessage: state.commitMessage,
    updatedAt: Date.now(),
  });
}

function saveWorkspaceDraft(workspace: WorkspaceSummary, draft: WorkspaceDraft) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(workspaceDraftStorageKey(workspace), JSON.stringify(draft));
  } catch {
    // 本地草稿保存失败不应阻断工作副本操作。
  }
}

function clearWorkspaceDraftStorage(workspace: WorkspaceSummary) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(workspaceDraftStorageKey(workspace));
    window.localStorage.removeItem(legacyReviewedStorageKey(workspace));
  } catch {
    // 清理本地草稿失败不应阻断当前会话。
  }
}

function loadLegacyReviewedFiles(workspace: WorkspaceSummary) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(legacyReviewedStorageKey(workspace));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isReviewedFileState) : [];
  } catch {
    return [];
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

function isStagedFileDraft(value: unknown): value is {
  path: string;
  status: string;
  contentDigest: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    path?: unknown;
    status?: unknown;
    contentDigest?: unknown;
  };

  return (
    typeof candidate.path === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.contentDigest === "string"
  );
}

function isSelectedHunkDraft(value: unknown): value is {
  filePath: string;
  fileDigest: string;
  hunkId: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    filePath?: unknown;
    fileDigest?: unknown;
    hunkId?: unknown;
  };

  return (
    typeof candidate.filePath === "string" &&
    typeof candidate.fileDigest === "string" &&
    typeof candidate.hunkId === "string"
  );
}

interface CommitMessageSettings {
  template: string;
  history: string[];
}

function commitMessageSettingsKey() {
  return "novasvn:commit-message-settings";
}

function loadCommitMessageSettings(): CommitMessageSettings {
  if (typeof window === "undefined") {
    return { template: "", history: [] };
  }

  try {
    const raw = window.localStorage.getItem(commitMessageSettingsKey());
    if (!raw) {
      return { template: "", history: [] };
    }

    const parsed = JSON.parse(raw) as Partial<CommitMessageSettings>;
    return {
      template: typeof parsed.template === "string" ? parsed.template : "",
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((item): item is string => typeof item === "string").slice(0, 8)
        : [],
    };
  } catch {
    return { template: "", history: [] };
  }
}

function saveCommitMessageSettings(settings: CommitMessageSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(commitMessageSettingsKey(), JSON.stringify(settings));
  } catch {
    // 本地设置保存失败不应阻断提交流程。
  }
}

function recordCommitHistory(
  message: string,
  history: string[],
  template: string,
) {
  const normalized = message.trim();
  if (!normalized) {
    return history;
  }

  const nextHistory = [normalized, ...history.filter((item) => item !== normalized)].slice(0, 8);
  saveCommitMessageSettings({
    template,
    history: nextHistory,
  });

  return nextHistory;
}
