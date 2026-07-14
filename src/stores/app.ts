import { get, writable } from "svelte/store";
import {
  cancelTask,
  chooseCheckoutDirectory,
  chooseExportDirectory,
  chooseImportSource,
  chooseWorkspaceDirectory,
  createApplyPatchTask,
  createBranchCheckoutTask,
  createCommitTask,
  createMergeTask,
  createMockTask,
  createPartialCommitTask,
  createRepositoryCheckoutTask,
  createRepositoryCopyTask,
  createRepositoryDeleteTask,
  createRepositoryDragExportTask,
  createRepositoryExportTask,
  createRepositoryFileTask,
  createRepositoryListTask,
  createRepositoryImportTask,
  createRepositoryMkdirTask,
  createRepositoryMoveTask,
  createRevertRevisionTask,
  createRevisionDiffTask,
  createShadowWorkspaceTask,
  createSvnBatchOperationTask,
  createSvnOperationTask,
  createSvnSwitchTask,
  detectSvn,
  exportDiagnostics,
  getFileContentDiff,
  getFileDiff,
  getBranchPool,
  getRepositoryFileBlame,
  getRepositoryFileLog,
  getRepositoryFileProperties,
  getSvnBlame,
  getSvnLog,
  getSvnProperties,
  ignoreWorkspacePath,
  getTaskWorkspaces,
  generateSelectedPatch,
  getShadowWorkspaceStatus,
  getRecentWorkspace,
  getTask,
  listWorkspaceFiles,
  listTasks,
  openGeneratedFileLocation,
  openWorkspace,
  parseUnifiedDiff,
  removeBranchPoolEntry,
  removeTaskWorkspace,
  scanWorkspaceStatus,
  saveBranchPoolEntry,
  setSvnProperty,
  saveTaskWorkspace,
} from "../lib/api";
import type {
  AppView,
  AppSettingsState,
  ReviewedFileState,
  SafetyCheckItem,
  SafetyCheckSummary,
  WorkspaceGroupMode,
} from "../types/app";
import type {
  ApplyPatchResult,
  ChangedFile,
  BranchPool,
  BranchPoolEntry,
  CommandError,
  FileContentDiff,
  FileDiff,
  MergeResult,
  MockTaskOutcome,
  ParsedFileDiff,
  RepositoryListResult,
  RepositoryFileResult,
  RepositoryCopyKind,
  RepositoryMoveKind,
  RevisionDiffMode,
  RevisionDiffResult,
  SelectedPatch,
  ShadowWorkspaceOperationKind,
  ShadowWorkspaceStatus,
  SvnBlame,
  PendingSvnOperationKind,
  SvnBatchOperationKind,
  SvnOperationKind,
  SvnDetection,
  SvnLog,
  SvnProperties,
  Task,
  TaskSnapshot,
  TaskWorkspaceEntry,
  TaskWorkspaceList,
  WorkingCopyStatus,
  WorkspaceFileTree,
  WorkspaceSummary,
} from "../types/api";
import { isSameWorkingCopyRoot } from "../lib/svn-operation-completion";

export const currentView = writable<AppView>("changes");

export function setCurrentView(view: AppView) {
  currentView.set(view);
}

const initialAppSettings: AppSettingsState = {
  svnExecutable: "",
  svnAuthenticationMode: "system",
  svnUsername: "",
  svnRememberPassword: true,
  diffMode: "side_by_side",
  showWhitespace: false,
  themeMode: "system",
  showSourceList: true,
  showInspector: true,
  commitTemplate: "",
  branchPoolBasePath: "",
  largeFileThresholdMb: 20,
  externalDiffTool: "",
  externalMergeTool: "",
  diagnosticExportPath: "",
  diagnosticExportError: null,
  validationErrors: emptyAppSettingsValidationErrors(),
  loading: false,
};

function createAppSettingsStore() {
  const { subscribe, update } = writable<AppSettingsState>(initialAppSettings);

  function load() {
    const settings = loadAppSettings();
    update((state) => ({ ...state, ...settings, loading: false }));
    svnStore.setExecutableInput(settings.svnExecutable);
    workspaceStore.setCommitTemplate(settings.commitTemplate);
  }

  function setField<K extends keyof AppSettingsState>(field: K, value: AppSettingsState[K]) {
    update((state) => {
      const normalizedValue = normalizeAppSettingValue(field, value);
      const next = {
        ...state,
        [field]: normalizedValue,
        validationErrors: validateAppSettingsField(
          state.validationErrors,
          field,
          normalizedValue,
        ),
      };
      saveAppSettings(next);
      if (field === "svnExecutable") {
        svnStore.setExecutableInput(String(normalizedValue));
      }
      if (field === "commitTemplate") {
        workspaceStore.setCommitTemplate(String(normalizedValue));
      }
      if (field === "branchPoolBasePath") {
        branchPoolStore.applyBasePath(String(normalizedValue));
      }
      return next;
    });
  }

  async function exportDiagnosticLog() {
    update((state) => ({
      ...state,
      loading: true,
      diagnosticExportError: null,
      diagnosticExportPath: "",
    }));

    try {
      const result = await exportDiagnostics();
      update((state) => ({
        ...state,
        loading: false,
        diagnosticExportPath: result.path,
      }));
    } catch (error) {
      const commandError = error as CommandError;
      update((state) => ({
        ...state,
        loading: false,
        diagnosticExportError: commandError.message,
      }));
    }
  }

  return {
    subscribe,
    load,
    setField,
    exportDiagnosticLog,
  };
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
    targetPath?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createSvnOperationTask({
        working_copy_root: request.workingCopyRoot,
        kind: request.kind,
        file_path: request.filePath || undefined,
        ...(request.targetPath ? { target_path: request.targetPath } : {}),
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
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryListTask({
        url: request.url,
        revision: request.revision || undefined,
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

  async function createRepositoryMkdir(request: {
    url: string;
    message: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryMkdirTask({
        url: request.url,
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

  async function createRepositoryImport(request: {
    sourcePath: string;
    targetUrl: string;
    message: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryImportTask({
        source_path: request.sourcePath,
        target_url: request.targetUrl,
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

  async function createRepositoryMove(request: {
    kind?: RepositoryMoveKind;
    sourceUrl: string;
    targetUrl: string;
    message: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryMoveTask({
        kind: request.kind,
        source_url: request.sourceUrl,
        target_url: request.targetUrl,
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

  async function createRepositoryDelete(request: {
    url: string;
    message: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryDeleteTask({
        url: request.url,
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

  async function createBranchCheckout(request: {
    branchUrl: string;
    localPath: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createBranchCheckoutTask({
        branch_url: request.branchUrl,
        local_path: request.localPath,
        revision: request.revision || undefined,
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

  async function createRepositoryCheckout(request: {
    url: string;
    localPath: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryCheckoutTask({
        url: request.url,
        local_path: request.localPath,
        revision: request.revision || undefined,
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

  async function createRepositoryExport(request: {
    url: string;
    localPath: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryExportTask({
        url: request.url,
        local_path: request.localPath,
        revision: request.revision || undefined,
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

  async function createRepositoryDragExport(request: {
    url: string;
    name: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryDragExportTask({
        url: request.url,
        name: request.name,
        revision: request.revision || undefined,
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

  async function createSvnSwitch(request: {
    workingCopyRoot: string;
    targetUrl: string;
    allowLocalChanges?: boolean;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createSvnSwitchTask({
        working_copy_root: request.workingCopyRoot,
        target_url: request.targetUrl,
        allow_local_changes: request.allowLocalChanges,
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

  async function createRevisionDiff(request: {
    mode: RevisionDiffMode;
    workingCopyRoot?: string | null;
    filePath?: string | null;
    targetUrl?: string | null;
    leftRevision?: string | null;
    rightRevision?: string | null;
    leftUrl?: string | null;
    rightUrl?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRevisionDiffTask({
        mode: request.mode,
        working_copy_root: request.workingCopyRoot || undefined,
        file_path: request.filePath || undefined,
        target_url: request.targetUrl || undefined,
        left_revision: request.leftRevision || undefined,
        right_revision: request.rightRevision || undefined,
        left_url: request.leftUrl || undefined,
        right_url: request.rightUrl || undefined,
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

  async function createMerge(request: {
    workingCopyRoot: string;
    sourceUrl: string;
    startRevision?: string | null;
    endRevision?: string | null;
    dryRun: boolean;
    recordOnly: boolean;
    ignoreAncestry: boolean;
    force: boolean;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createMergeTask({
        working_copy_root: request.workingCopyRoot,
        source_url: request.sourceUrl,
        start_revision: request.startRevision || undefined,
        end_revision: request.endRevision || undefined,
        dry_run: request.dryRun,
        record_only: request.recordOnly,
        ignore_ancestry: request.ignoreAncestry,
        force: request.force,
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

  async function createApplyPatch(request: {
    workingCopyRoot: string;
    patchFilePath: string;
    dryRun: boolean;
    expectedPatchDigest?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createApplyPatchTask({
        working_copy_root: request.workingCopyRoot,
        patch_file_path: request.patchFilePath,
        dry_run: request.dryRun,
        ...(request.expectedPatchDigest
          ? { expected_patch_digest: request.expectedPatchDigest }
          : {}),
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

  async function createRepositoryFile(request: {
    url: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRepositoryFileTask({
        url: request.url,
        revision: request.revision || undefined,
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

  async function createRevertRevision(request: {
    workingCopyRoot: string;
    targetRevision: string;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createRevertRevisionTask({
        working_copy_root: request.workingCopyRoot,
        target_revision: request.targetRevision,
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

  async function createSvnBatchOperation(request: {
    workingCopyRoot: string;
    kind: SvnBatchOperationKind;
    filePaths: string[];
    targetPath?: string | null;
    svnExecutable?: string | null;
  }) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createSvnBatchOperationTask({
        working_copy_root: request.workingCopyRoot,
        kind: request.kind,
        file_paths: request.filePaths,
        ...(request.targetPath !== undefined && request.targetPath !== null
          ? { target_path: request.targetPath }
          : {}),
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

  async function confirmTaskMissing(taskId: string) {
    try {
      await getTask(taskId);
      return false;
    } catch (error) {
      return (error as CommandError).code === "TASK_NOT_FOUND";
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
    createSvnBatchOperation,
    createShadowWorkspace,
    createPartialCommit,
    createRepositoryList,
    createRepositoryFile,
    createRepositoryCopy,
    createRepositoryMkdir,
    createRepositoryImport,
    createRepositoryMove,
    createRepositoryDelete,
    createBranchCheckout,
    createRepositoryCheckout,
    createRepositoryExport,
    createRepositoryDragExport,
    createSvnSwitch,
    createRevisionDiff,
    createRevertRevision,
    createMerge,
    createApplyPatch,
    select,
    cancel,
    getTaskById,
    confirmTaskMissing,
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
      return detection;
    } catch (error) {
      update((state) => ({
        ...state,
        detection: null,
        loading: false,
        error: error as CommandError,
      }));
      return null;
    }
  }

  async function detectWithInputFallback() {
    const requestedExecutable = get({ subscribe }).executableInput.trim();
    const detection = await detectWithInput();
    if (detection || !requestedExecutable) {
      return detection;
    }

    update((state) => ({ ...state, loading: true, error: null }));
    try {
      const fallbackDetection = await detectSvn();
      update((state) => ({
        ...state,
        detection: fallbackDetection,
        executableInput: fallbackDetection.resolved_path || fallbackDetection.executable,
        loading: false,
        error: null,
      }));
      return fallbackDetection;
    } catch (error) {
      update((state) => ({
        ...state,
        detection: null,
        loading: false,
        error: error as CommandError,
      }));
      return null;
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
    detectWithInputFallback,
    setExecutableInput,
  };
}

export const svnStore = createSvnStore();

export interface BranchPoolStoreState {
  pool: BranchPool;
  form: {
    branchUrl: string;
    localPath: string;
    revision: string;
  };
  formErrors: {
    localPath: string | null;
  };
  pendingCheckoutTaskId: string | null;
  pendingCheckoutEntry: {
    branchUrl: string;
    localPath: string;
    revision: string;
  } | null;
  loading: boolean;
  error: CommandError | null;
  checkoutError: string | null;
}

const initialBranchPoolState: BranchPoolStoreState = {
  pool: {
    entries: [],
  },
  form: {
    branchUrl: "",
    localPath: "",
    revision: "",
  },
  formErrors: {
    localPath: null,
  },
  pendingCheckoutTaskId: null,
  pendingCheckoutEntry: null,
  loading: false,
  error: null,
  checkoutError: null,
};

function createBranchPoolStore() {
  const { subscribe, update } = writable<BranchPoolStoreState>(initialBranchPoolState);

  async function load() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const pool = await getBranchPool();
      update((state) => ({
        ...state,
        pool,
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

  function setFormField(field: keyof BranchPoolStoreState["form"], value: string) {
    update((state) => ({
      ...state,
      form: {
        ...state.form,
        [field]: value,
        ...(field === "branchUrl" && !state.form.localPath.trim()
          ? { localPath: suggestBranchPoolLocalPath(value, loadAppSettings().branchPoolBasePath) }
          : {}),
      },
      formErrors: {
        ...state.formErrors,
        localPath:
          field === "localPath" || (field === "branchUrl" && !state.form.localPath.trim())
            ? validateOptionalAbsoluteOrHomePath(
                field === "localPath"
                  ? value
                  : suggestBranchPoolLocalPath(value, loadAppSettings().branchPoolBasePath),
                "本地路径",
              )
            : state.formErrors.localPath,
      },
      checkoutError: null,
    }));
  }

  function useBranchUrl(branchUrl: string) {
    update((state) => ({
      ...state,
      form: {
        ...state.form,
        branchUrl,
        localPath: state.form.localPath.trim()
          ? state.form.localPath
          : suggestBranchPoolLocalPath(branchUrl, loadAppSettings().branchPoolBasePath),
      },
      checkoutError: null,
    }));
  }

  function applyBasePath(basePath: string) {
    update((state) => {
      if (state.form.localPath.trim() || !state.form.branchUrl.trim()) {
        return state;
      }

      const localPath = suggestBranchPoolLocalPath(state.form.branchUrl, basePath);
      return {
        ...state,
        form: {
          ...state.form,
          localPath,
        },
        formErrors: {
          ...state.formErrors,
          localPath: validateOptionalAbsoluteOrHomePath(localPath, "本地路径"),
        },
      };
    });
  }

  async function saveExisting(entry: {
    branchUrl: string;
    localPath: string;
    revision?: string | null;
    localChanges?: number;
  }) {
    const localPathError = validateAbsoluteOrHomePath(entry.localPath, "本地路径");
    if (localPathError) {
      update((state) => ({
        ...state,
        formErrors: {
          ...state.formErrors,
          localPath: localPathError,
        },
        checkoutError: localPathError,
      }));
      return null;
    }

    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const pool = await saveBranchPoolEntry({
        branch_url: entry.branchUrl,
        local_path: entry.localPath,
        revision: entry.revision || undefined,
        local_changes: entry.localChanges,
      });
      update((state) => ({
        ...state,
        pool,
        loading: false,
        error: null,
        checkoutError: null,
      }));
      return pool;
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
      return null;
    }
  }

  async function remove(entry: BranchPoolEntry, deleteLocalCopy = false) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const pool = await removeBranchPoolEntry({
        id: entry.id,
        delete_local_copy: deleteLocalCopy,
      });
      update((state) => ({
        ...state,
        pool,
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

  function markCheckoutTask(taskId: string | null) {
    if (taskId && !validateForm()) {
      return;
    }

    update((state) => ({
      ...state,
      pendingCheckoutTaskId: taskId,
      pendingCheckoutEntry: taskId
        ? {
            branchUrl: state.form.branchUrl,
            localPath: state.form.localPath,
            revision: state.form.revision,
          }
        : null,
      checkoutError: null,
    }));
  }

  function validateForm() {
    const state = get({ subscribe });
    const localPathError = validateAbsoluteOrHomePath(state.form.localPath, "本地路径");
    update((current) => ({
      ...current,
      formErrors: {
        ...current.formErrors,
        localPath: localPathError,
      },
      checkoutError: localPathError,
    }));
    return !localPathError;
  }

  async function completeCheckoutTask() {
    const entry = get({ subscribe }).pendingCheckoutEntry;
    if (!entry) {
      markCheckoutTask(null);
      return;
    }

    try {
      const pool = await saveBranchPoolEntry({
        branch_url: entry.branchUrl,
        local_path: entry.localPath,
        revision: entry.revision || undefined,
        local_changes: 0,
      });
      update((state) => ({
        ...state,
        pool,
        form: {
          ...state.form,
          localPath: "",
        },
        formErrors: {
          localPath: null,
        },
        pendingCheckoutTaskId: null,
        pendingCheckoutEntry: null,
        checkoutError: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        pendingCheckoutTaskId: null,
        pendingCheckoutEntry: null,
        checkoutError: (error as CommandError).message,
      }));
    }
  }

  function failCheckoutTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingCheckoutTaskId: null,
      pendingCheckoutEntry: null,
      checkoutError: message ?? "分支 checkout 失败",
    }));
  }

  return {
    subscribe,
    load,
    setFormField,
    useBranchUrl,
    applyBasePath,
    saveExisting,
    remove,
    validateForm,
    markCheckoutTask,
    completeCheckoutTask,
    failCheckoutTask,
  };
}

export const branchPoolStore = createBranchPoolStore();

export interface TaskWorkspaceStoreState {
  list: TaskWorkspaceList;
  form: {
    name: string;
    branchPoolEntryId: string;
  };
  activeTaskId: string | null;
  loading: boolean;
  error: CommandError | null;
}

type TaskWorkspaceDraftSnapshot = ReturnType<typeof buildTaskWorkspaceDraftSnapshot>;

const initialTaskWorkspaceState: TaskWorkspaceStoreState = {
  list: {
    entries: [],
  },
  form: {
    name: "",
    branchPoolEntryId: "",
  },
  activeTaskId: null,
  loading: false,
  error: null,
};

function createTaskWorkspaceStore() {
  const { subscribe, update } = writable<TaskWorkspaceStoreState>(
    initialTaskWorkspaceState,
  );

  async function load() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const list = await getTaskWorkspaces();
      update((state) => ({
        ...state,
        list,
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

  function setFormField(field: keyof TaskWorkspaceStoreState["form"], value: string) {
    update((state) => ({
      ...state,
      form: {
        ...state.form,
        [field]: value,
      },
      error: null,
    }));
  }

  async function createFromBranch(entry: BranchPoolEntry) {
    const state = get({ subscribe });
    const name = state.form.name.trim() || branchNameFromUrl(entry.branch_url);
    const draftKey = taskWorkspaceDraftKey(entry.id, name);
    update((current) => ({ ...current, loading: true, error: null }));

    try {
      const list = await saveTaskWorkspace({
        name,
        branch_pool_entry_id: entry.id,
        branch_url: entry.branch_url,
        local_path: entry.local_path,
        draft_key: draftKey,
      });
      update((current) => ({
        ...current,
        list,
        form: {
          ...current.form,
          name: "",
        },
        loading: false,
        error: null,
      }));
      return list.entries.find((item) => item.draft_key === draftKey) ?? null;
    } catch (error) {
      update((current) => ({
        ...current,
        loading: false,
        error: error as CommandError,
      }));
      return null;
    }
  }

  async function remove(entry: TaskWorkspaceEntry) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const list = await removeTaskWorkspace({ id: entry.id });
      removeTaskWorkspaceDraft(entry.draft_key);
      update((state) => ({
        ...state,
        list,
        activeTaskId: state.activeTaskId === entry.id ? null : state.activeTaskId,
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

  function saveDraft(entry: TaskWorkspaceEntry, draft: TaskWorkspaceDraftSnapshot) {
    saveTaskWorkspaceDraft(entry.draft_key, draft);
  }

  function loadDraft(entry: TaskWorkspaceEntry) {
    update((state) => ({
      ...state,
      activeTaskId: entry.id,
    }));
    return loadTaskWorkspaceDraft(entry.draft_key);
  }

  return {
    subscribe,
    load,
    setFormField,
    createFromBranch,
    remove,
    saveDraft,
    loadDraft,
  };
}

export const taskWorkspaceStore = createTaskWorkspaceStore();

export interface WorkspaceStoreState {
  current: WorkspaceSummary | null;
  status: WorkingCopyStatus | null;
  fileTree: WorkspaceFileTree | null;
  searchText: string;
  groupByStatus: boolean;
  abnormalOnly: boolean;
  unreviewedOnly: boolean;
  generatedOnly: boolean;
  statusFilters: string[];
  groupMode: WorkspaceGroupMode;
  selectedFilePath: string | null;
  selectedFileDiff: FileDiff | null;
  selectedFileContentDiff: FileContentDiff | null;
  selectedFileParsedDiff: ParsedFileDiff | null;
  svnBlame: SvnBlame | null;
  svnBlameLoading: boolean;
  svnBlameError: CommandError | null;
  selectedPatch: SelectedPatch | null;
  commitFiles: Array<{
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
  pendingCommitFiles: string[];
  pendingCommitWorkingCopyRoot: string | null;
  pendingPartialCommitTaskId: string | null;
  pendingSvnOperationTaskId: string | null;
  pendingSvnOperationKind: PendingSvnOperationKind | null;
  pendingSvnOperationWorkingCopyRoot: string | null;
  repositoryUrlInput: string;
  repositoryRevisionInput: string;
  repositoryCurrentUrl: string;
  repositoryList: RepositoryListResult | null;
  pendingRepositoryListTaskId: string | null;
  pendingRepositoryFileTaskId: string | null;
  repositoryFileLoading: boolean;
  repositoryFileError: string | null;
  repositoryFileLogRevision: string | null;
  repositoryFileLog: SvnLog | null;
  repositoryFileLogLoading: boolean;
  repositoryFileLogError: CommandError | null;
  repositoryFileBlameRevision: string | null;
  repositoryFileBlame: SvnBlame | null;
  repositoryFileBlameLoading: boolean;
  repositoryFileBlameError: CommandError | null;
  repositoryFilePropertiesRevision: string | null;
  repositoryFileProperties: SvnProperties | null;
  repositoryFilePropertiesLoading: boolean;
  repositoryFilePropertiesError: CommandError | null;
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
  pendingRepositoryCopyParentUrl: string | null;
  repositoryCopyError: string | null;
  repositoryMkdirForm: {
    targetUrl: string;
    message: string;
  };
  pendingRepositoryMkdirTaskId: string | null;
  pendingRepositoryMkdirParentUrl: string | null;
  repositoryMkdirError: string | null;
  repositoryImportForm: {
    sourcePath: string;
    targetUrl: string;
    message: string;
  };
  pendingRepositoryImportTaskId: string | null;
  pendingRepositoryImportParentUrl: string | null;
  repositoryImportError: string | null;
  repositoryMoveForm: {
    sourceUrl: string;
    targetUrl: string;
    message: string;
  };
  pendingRepositoryMoveTaskId: string | null;
  pendingRepositoryMoveKind: RepositoryMoveKind | null;
  pendingRepositoryMoveSourceParentUrl: string | null;
  pendingRepositoryMoveTargetParentUrl: string | null;
  repositoryMoveError: string | null;
  repositoryRenameForm: {
    sourceUrl: string;
    targetUrl: string;
    message: string;
  };
  repositoryRenameError: string | null;
  repositoryDeleteForm: {
    url: string;
    message: string;
  };
  pendingRepositoryDeleteTaskId: string | null;
  pendingRepositoryDeleteParentUrl: string | null;
  repositoryDeleteError: string | null;
  repositoryCheckoutForm: {
    url: string;
    localPath: string;
    revision: string;
  };
  pendingRepositoryCheckoutTaskId: string | null;
  pendingRepositoryCheckoutLocalPath: string | null;
  repositoryCheckoutError: string | null;
  repositoryExportForm: {
    url: string;
    localPath: string;
    revision: string;
  };
  pendingRepositoryExportTaskId: string | null;
  pendingRepositoryExportLocalPath: string | null;
  repositoryExportError: string | null;
  svnSwitchTargetUrl: string;
  pendingSvnSwitchTaskId: string | null;
  svnSwitchError: string | null;
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
  svnLog: SvnLog | null;
  svnLogLoading: boolean;
  svnLogError: CommandError | null;
  svnLogAuthorFilter: string;
  svnLogKeywordFilter: string;
  svnLogDateFromFilter: string;
  svnLogDateToFilter: string;
  svnLogFileOnly: boolean;
  svnLogLimit: number;
  revisionDiffForm: {
    mode: RevisionDiffMode;
    filePath: string;
    targetUrl: string;
    leftRevision: string;
    rightRevision: string;
    leftUrl: string;
    rightUrl: string;
  };
  pendingRevisionDiffTaskId: string | null;
  revisionDiffLoading: boolean;
  revisionDiffError: string | null;
  revisionDiffResult: RevisionDiffResult | null;
  mergeForm: {
    sourceUrl: string;
    startRevision: string;
    endRevision: string;
    dryRun: boolean;
    recordOnly: boolean;
    ignoreAncestry: boolean;
    force: boolean;
  };
  pendingMergeTaskId: string | null;
  mergeError: string | null;
  mergeResult: MergeResult | null;
  applyPatchDialogOpen: boolean;
  applyPatchFilePath: string;
  applyPatchWorkingCopyRoot: string;
  applyPatchCreating: boolean;
  pendingApplyPatchTaskId: string | null;
  applyPatchResult: ApplyPatchResult | null;
  applyPatchError: string | null;
  svnProperties: SvnProperties | null;
  svnPropertiesLoading: boolean;
  svnPropertiesError: CommandError | null;
  propertyEditForm: {
    name: string;
    value: string;
  };
}

const initialWorkspaceState: WorkspaceStoreState = {
  current: null,
  status: null,
  fileTree: null,
  searchText: "",
  groupByStatus: true,
  abnormalOnly: false,
  unreviewedOnly: false,
  generatedOnly: false,
  statusFilters: [],
  groupMode: "status",
  selectedFilePath: null,
  selectedFileDiff: null,
  selectedFileContentDiff: null,
  selectedFileParsedDiff: null,
  svnBlame: null,
  svnBlameLoading: false,
  svnBlameError: null,
  selectedPatch: null,
  commitFiles: [],
  safetyCheck: emptySafetyCheck(),
  selectedHunks: [],
  reviewedFiles: [],
  commitTemplate: "",
  commitHistory: [],
  commitMessage: "",
  commitError: null,
  pendingCommitTaskId: null,
  pendingCommitFiles: [],
  pendingCommitWorkingCopyRoot: null,
  pendingPartialCommitTaskId: null,
  pendingSvnOperationTaskId: null,
  pendingSvnOperationKind: null,
  pendingSvnOperationWorkingCopyRoot: null,
  repositoryUrlInput: "",
  repositoryRevisionInput: "",
  repositoryCurrentUrl: "",
  repositoryList: null,
  pendingRepositoryListTaskId: null,
  pendingRepositoryFileTaskId: null,
  repositoryFileLoading: false,
  repositoryFileError: null,
  repositoryFileLogRevision: null,
  repositoryFileLog: null,
  repositoryFileLogLoading: false,
  repositoryFileLogError: null,
  repositoryFileBlameRevision: null,
  repositoryFileBlame: null,
  repositoryFileBlameLoading: false,
  repositoryFileBlameError: null,
  repositoryFilePropertiesRevision: null,
  repositoryFileProperties: null,
  repositoryFilePropertiesLoading: false,
  repositoryFilePropertiesError: null,
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
  pendingRepositoryCopyParentUrl: null,
  repositoryCopyError: null,
  repositoryMkdirForm: {
    targetUrl: "",
    message: "",
  },
  pendingRepositoryMkdirTaskId: null,
  pendingRepositoryMkdirParentUrl: null,
  repositoryMkdirError: null,
  repositoryImportForm: {
    sourcePath: "",
    targetUrl: "",
    message: "",
  },
  pendingRepositoryImportTaskId: null,
  pendingRepositoryImportParentUrl: null,
  repositoryImportError: null,
  repositoryMoveForm: {
    sourceUrl: "",
    targetUrl: "",
    message: "",
  },
  pendingRepositoryMoveTaskId: null,
  pendingRepositoryMoveKind: null,
  pendingRepositoryMoveSourceParentUrl: null,
  pendingRepositoryMoveTargetParentUrl: null,
  repositoryMoveError: null,
  repositoryRenameForm: {
    sourceUrl: "",
    targetUrl: "",
    message: "",
  },
  repositoryRenameError: null,
  repositoryDeleteForm: {
    url: "",
    message: "",
  },
  pendingRepositoryDeleteTaskId: null,
  pendingRepositoryDeleteParentUrl: null,
  repositoryDeleteError: null,
  repositoryCheckoutForm: {
    url: "",
    localPath: "",
    revision: "",
  },
  pendingRepositoryCheckoutTaskId: null,
  pendingRepositoryCheckoutLocalPath: null,
  repositoryCheckoutError: null,
  repositoryExportForm: {
    url: "",
    localPath: "",
    revision: "",
  },
  pendingRepositoryExportTaskId: null,
  pendingRepositoryExportLocalPath: null,
  repositoryExportError: null,
  svnSwitchTargetUrl: "",
  pendingSvnSwitchTaskId: null,
  svnSwitchError: null,
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
  svnLog: null,
  svnLogLoading: false,
  svnLogError: null,
  svnLogAuthorFilter: "",
  svnLogKeywordFilter: "",
  svnLogDateFromFilter: "",
  svnLogDateToFilter: "",
  svnLogFileOnly: false,
  svnLogLimit: 50,
  revisionDiffForm: {
    mode: "revisions",
    filePath: "",
    targetUrl: "",
    leftRevision: "",
    rightRevision: "",
    leftUrl: "",
    rightUrl: "",
  },
  pendingRevisionDiffTaskId: null,
  revisionDiffLoading: false,
  revisionDiffError: null,
  revisionDiffResult: null,
  mergeForm: {
    sourceUrl: "",
    startRevision: "",
    endRevision: "",
    dryRun: true,
    recordOnly: false,
    ignoreAncestry: false,
    force: false,
  },
  pendingMergeTaskId: null,
  mergeError: null,
  mergeResult: null,
  ...emptyApplyPatchState(),
  svnProperties: null,
  svnPropertiesLoading: false,
  svnPropertiesError: null,
  propertyEditForm: emptyPropertyEditForm(),
};

function createWorkspaceStore() {
  const { subscribe, update } = writable<WorkspaceStoreState>(initialWorkspaceState);
  let openPathGeneration = 0;
  let statusRefreshGeneration = 0;
  let fileTreeRefreshGeneration = 0;
  let fileSelectionGeneration = 0;
  let repositoryFileLogGeneration = 0;
  let repositoryFileBlameGeneration = 0;
  let repositoryFilePropertiesGeneration = 0;

  async function loadRecent() {
    fileSelectionGeneration += 1;
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
        fileTree: null,
        selectedFilePath: null,
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        selectedFileParsedDiff: null,
        ...clearSvnBlameState(),
        commitFiles: [],
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
        pendingCommitFiles: [],
        pendingCommitWorkingCopyRoot: null,
        pendingPartialCommitTaskId: null,
        pendingSvnOperationTaskId: null,
        pendingSvnOperationKind: null,
        pendingSvnOperationWorkingCopyRoot: null,
        ...emptyApplyPatchState(),
        repositoryUrlInput: recent.workspace?.repository_root ?? state.repositoryUrlInput,
        repositoryCurrentUrl: "",
        repositoryList: null,
        pendingRepositoryListTaskId: null,
        pendingRepositoryFileTaskId: null,
        repositoryFileLoading: false,
        repositoryFileError: null,
        repositoryFileLogRevision: null,
        repositoryFileLog: null,
        repositoryFileLogLoading: false,
        repositoryFileLogError: null,
        repositoryFileBlameRevision: null,
        repositoryFileBlame: null,
        repositoryFileBlameLoading: false,
        repositoryFileBlameError: null,
        repositoryFilePropertiesRevision: null,
        repositoryFileProperties: null,
        repositoryFilePropertiesLoading: false,
        repositoryFilePropertiesError: null,
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
        pendingRepositoryCopyParentUrl: null,
        repositoryCopyError: null,
        repositoryMkdirForm: emptyRepositoryMkdirForm(),
        pendingRepositoryMkdirTaskId: null,
        pendingRepositoryMkdirParentUrl: null,
        repositoryMkdirError: null,
        repositoryImportForm: emptyRepositoryImportForm(),
        pendingRepositoryImportTaskId: null,
        pendingRepositoryImportParentUrl: null,
        repositoryImportError: null,
        repositoryMoveForm: emptyRepositoryMoveForm(),
        pendingRepositoryMoveTaskId: null,
        pendingRepositoryMoveKind: null,
        pendingRepositoryMoveSourceParentUrl: null,
        pendingRepositoryMoveTargetParentUrl: null,
        repositoryMoveError: null,
        repositoryRenameForm: emptyRepositoryRenameForm(),
        repositoryRenameError: null,
        repositoryDeleteForm: emptyRepositoryDeleteForm(),
        pendingRepositoryDeleteTaskId: null,
        pendingRepositoryDeleteParentUrl: null,
        repositoryDeleteError: null,
        repositoryCheckoutForm: {
          ...emptyRepositoryCheckoutForm(),
          url: recent.workspace?.repository_url ?? "",
          revision: recent.workspace?.revision ?? "",
        },
        pendingRepositoryCheckoutTaskId: null,
        pendingRepositoryCheckoutLocalPath: null,
        repositoryCheckoutError: null,
        repositoryExportForm: {
          ...emptyRepositoryExportForm(),
          url: recent.workspace?.repository_url ?? "",
          revision: recent.workspace?.revision ?? "",
        },
        pendingRepositoryExportTaskId: null,
        pendingRepositoryExportLocalPath: null,
        repositoryExportError: null,
        svnSwitchTargetUrl: recent.workspace?.repository_url ?? "",
        pendingSvnSwitchTaskId: null,
        svnSwitchError: null,
        repositoryLoading: false,
        repositoryError: null,
        shadowStatus: null,
        shadowError: null,
        ...clearSvnPropertiesState(),
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

  async function openPath(
    svnExecutable?: string | null,
    explicitPath?: string | null,
  ): Promise<WorkspaceSummary | null> {
    const requestGeneration = ++openPathGeneration;
    statusRefreshGeneration += 1;
    fileTreeRefreshGeneration += 1;
    fileSelectionGeneration += 1;
    update((state) => ({
      ...state,
      loading: true,
      error: null,
      statusLoading: false,
    }));

    let path = explicitPath?.trim() ?? "";
    if (explicitPath === undefined || explicitPath === null) {
      update((state) => {
        path = state.pathInput.trim();
        return state;
      });
    }

    try {
      const current = await openWorkspace({
        path,
        svn_executable: svnExecutable || undefined,
      });
      if (requestGeneration !== openPathGeneration) {
        return null;
      }
      const draft = loadWorkspaceDraft(current);
      const commitSettings = loadCommitMessageSettings();
      update((state) => ({
        ...state,
        current,
        status: null,
        fileTree: null,
        selectedFilePath: null,
        selectedFileDiff: null,
        selectedFileContentDiff: null,
        selectedFileParsedDiff: null,
        ...clearSvnBlameState(),
        commitFiles: [],
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
        pendingPartialCommitTaskId: null,
        ...emptyApplyPatchState(),
        repositoryUrlInput: current.repository_root,
        repositoryCurrentUrl: "",
        repositoryList: null,
        pendingRepositoryListTaskId: null,
        pendingRepositoryFileTaskId: null,
        repositoryFileLoading: false,
        repositoryFileError: null,
        repositoryFileLogRevision: null,
        repositoryFileLog: null,
        repositoryFileLogLoading: false,
        repositoryFileLogError: null,
        repositoryFileBlameRevision: null,
        repositoryFileBlame: null,
        repositoryFileBlameLoading: false,
        repositoryFileBlameError: null,
        repositoryFilePropertiesRevision: null,
        repositoryFileProperties: null,
        repositoryFilePropertiesLoading: false,
        repositoryFilePropertiesError: null,
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
        pendingRepositoryCopyParentUrl: null,
        repositoryCopyError: null,
        repositoryMkdirForm: emptyRepositoryMkdirForm(),
        pendingRepositoryMkdirTaskId: null,
        pendingRepositoryMkdirParentUrl: null,
        repositoryMkdirError: null,
        repositoryImportForm: emptyRepositoryImportForm(),
        pendingRepositoryImportTaskId: null,
        pendingRepositoryImportParentUrl: null,
        repositoryImportError: null,
        repositoryMoveForm: emptyRepositoryMoveForm(),
        pendingRepositoryMoveTaskId: null,
        pendingRepositoryMoveKind: null,
        pendingRepositoryMoveSourceParentUrl: null,
        pendingRepositoryMoveTargetParentUrl: null,
        repositoryMoveError: null,
        repositoryRenameForm: emptyRepositoryRenameForm(),
        repositoryRenameError: null,
        repositoryDeleteForm: emptyRepositoryDeleteForm(),
        pendingRepositoryDeleteTaskId: null,
        pendingRepositoryDeleteParentUrl: null,
        repositoryDeleteError: null,
        repositoryCheckoutForm: {
          ...emptyRepositoryCheckoutForm(),
          url: current.repository_url,
          revision: current.revision,
        },
        pendingRepositoryCheckoutTaskId: null,
        pendingRepositoryCheckoutLocalPath: null,
        repositoryCheckoutError: null,
        repositoryExportForm: {
          ...emptyRepositoryExportForm(),
          url: current.repository_url,
          revision: current.revision,
        },
        pendingRepositoryExportTaskId: null,
        pendingRepositoryExportLocalPath: null,
        repositoryExportError: null,
        svnSwitchTargetUrl: current.repository_url,
        pendingSvnSwitchTaskId: null,
        svnSwitchError: null,
        repositoryLoading: false,
        repositoryError: null,
        shadowStatus: null,
        shadowError: null,
        ...clearSvnPropertiesState(),
        pathInput: current.working_copy_root,
        loading: false,
        error: null,
      }));
      await refreshStatus(svnExecutable, current.working_copy_root);
      return requestGeneration === openPathGeneration ? current : null;
    } catch (error) {
      if (requestGeneration !== openPathGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
      return null;
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

  function toggleGeneratedOnly() {
    update((state) => ({
      ...state,
      generatedOnly: !state.generatedOnly,
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

  function focusConflictFilter() {
    update((state) => ({
      ...state,
      searchText: "",
      abnormalOnly: false,
      unreviewedOnly: false,
      generatedOnly: false,
      statusFilters: ["conflicted"],
      groupMode: "status",
      groupByStatus: true,
    }));
  }

  function focusConflictResolution() {
    focusConflictFilter();
    const state = get({ subscribe });
    const conflict = state.status?.files.find(
      (file) => file.status === "conflicted" || file.conflict_kind !== null,
    );
    if (!conflict) {
      return null;
    }

    selectPathOnly(conflict.path);
    return conflict.path;
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
      abnormalOnly: false,
      unreviewedOnly: false,
      generatedOnly: false,
      statusFilters: [],
    }));
  }

  async function selectFile(path: string, svnExecutable?: string | null) {
    const requestGeneration = ++fileSelectionGeneration;
    const initialState = get({ subscribe });
    const root = initialState.current?.working_copy_root ?? "";
    if (root && !initialState.status?.files.some((file) => file.path === path)) {
      await loadStatusUntilFile(path, svnExecutable, root, requestGeneration);
    }
    const currentState = get({ subscribe });
    if (
      requestGeneration !== fileSelectionGeneration ||
      (root &&
        (!currentState.current ||
          !isSameWorkingCopyRoot(root, currentState.current.working_copy_root)))
    ) {
      return;
    }

    update((state) => ({
      ...state,
      selectedFileDiff: null,
      selectedFileContentDiff: null,
      selectedFileParsedDiff: null,
      selectedPatch: null,
      selectedFilePath: path,
      ...clearSvnBlameState(),
      ...clearSvnPropertiesState(),
    }));

    if (root) {
      await Promise.all([
        refreshFileDiff(svnExecutable, root, path),
        refreshFileContentDiff(svnExecutable, root, path),
      ]);
      await refreshParsedDiff(path);
    }
  }

  function selectPathOnly(path: string) {
    fileSelectionGeneration += 1;
    update((state) => ({
      ...state,
      selectedFileDiff: null,
      selectedFileContentDiff: null,
      selectedFileParsedDiff: null,
      selectedPatch: null,
      selectedFilePath: path,
      ...clearSvnBlameState(),
      ...clearSvnPropertiesState(),
    }));
  }

  async function refreshSvnBlame(svnExecutable?: string | null) {
    const state = get({ subscribe });
    const root = state.current?.working_copy_root ?? "";
    const path = state.selectedFilePath ?? "";

    if (!root || !path) {
      update((current) => ({
        ...current,
        svnBlame: null,
        svnBlameLoading: false,
        svnBlameError: {
          code: "SVN_BLAME_FILE_REQUIRED",
          message: "请先选择要查看 Blame 的文件",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }

    update((current) => ({
      ...current,
      svnBlame: null,
      svnBlameLoading: true,
      svnBlameError: null,
    }));

    try {
      const svnBlame = await getSvnBlame({
        working_copy_root: root,
        file_path: path,
        svn_executable: svnExecutable || undefined,
        max_lines: 5000,
      });
      update((current) => {
        if (
          current.current?.working_copy_root !== root ||
          current.selectedFilePath !== path
        ) {
          return current;
        }
        return {
          ...current,
          svnBlame,
          svnBlameLoading: false,
          svnBlameError: null,
        };
      });
    } catch (error) {
      update((current) => {
        if (
          current.current?.working_copy_root !== root ||
          current.selectedFilePath !== path
        ) {
          return current;
        }
        return {
          ...current,
          svnBlame: null,
          svnBlameLoading: false,
          svnBlameError: error as CommandError,
        };
      });
    }
  }

  function selectCommitFile(path: string) {
    update((state) => {
      const file = state.status?.files.find((item) => item.path === path);
      if (!file || !isCommittable(file) || state.commitFiles.some((item) => item.path === path)) {
        return state;
      }
      const commitFiles = [
        ...state.commitFiles,
        { path: file.path, status: file.status, contentDigest: file.content_digest },
      ];
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        commitFiles,
        state.safetyCheck.confirmedWarningIds,
        state.status,
      );

      return {
        ...state,
        commitFiles,
        safetyCheck,
        commitError: null,
      };
    });
  }

  function unselectCommitFile(path: string) {
    update((state) => {
      const commitFiles = state.commitFiles.filter((file) => file.path !== path);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        commitFiles,
        reconcileSafetyWarningConfirmations(state.safetyCheck, commitFiles).confirmedWarningIds,
        state.status,
      );

      return {
        ...state,
        commitFiles,
        safetyCheck,
        commitError: null,
      };
    });
  }

  function selectCommitFiles(paths: string[]) {
    const requested = new Set(paths);
    update((state) => {
      const existing = new Set(state.commitFiles.map((file) => file.path));
      const additions = (state.status?.files ?? [])
        .filter(
          (file) => requested.has(file.path) && isCommittable(file) && !existing.has(file.path),
        )
        .map((file) => ({
          path: file.path,
          status: file.status,
          contentDigest: file.content_digest,
        }));
      if (additions.length === 0) {
        return state;
      }
      const commitFiles = [...state.commitFiles, ...additions];
      return {
        ...state,
        commitFiles,
        safetyCheck: buildSafetyCheck(
          state.status?.files ?? [],
          commitFiles,
          state.safetyCheck.confirmedWarningIds,
          state.status,
        ),
        commitError: null,
      };
    });
  }

  function unselectCommitFiles(paths: string[]) {
    const requested = new Set(paths);
    update((state) => {
      const commitFiles = state.commitFiles.filter((file) => !requested.has(file.path));
      if (commitFiles.length === state.commitFiles.length) {
        return state;
      }
      return {
        ...state,
        commitFiles,
        safetyCheck: buildSafetyCheck(
          state.status?.files ?? [],
          commitFiles,
          reconcileSafetyWarningConfirmations(state.safetyCheck, commitFiles)
            .confirmedWarningIds,
          state.status,
        ),
        commitError: null,
      };
    });
  }

  function selectAllCommitFiles() {
    update((state) => {
      const commitFiles = buildCommitFileSelection(state.status?.files ?? []);
      return {
        ...state,
        commitFiles,
        safetyCheck: buildSafetyCheck(
          state.status?.files ?? [],
          commitFiles,
          state.safetyCheck.confirmedWarningIds,
          state.status,
        ),
        commitError: null,
      };
    });
  }

  function clearCommitFiles() {
    update((state) => ({
      ...state,
      commitFiles: [],
      safetyCheck: buildSafetyCheck(state.status?.files ?? [], [], [], state.status),
      commitError: null,
    }));
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

  function validateCommitFiles() {
    let valid = false;
    update((state) => {
      const reconciled = reconcileCommitFiles(state.commitFiles, state.status?.files ?? []);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        reconciled,
        state.safetyCheck.confirmedWarningIds,
        state.status,
      );
      const message = state.commitMessage.trim();
      let commitError: string | null = null;

      if (!state.current) {
        commitError = "请先打开 SVN 工作副本";
      } else if (reconciled.length === 0) {
        commitError = "请选择要提交的文件";
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
        commitFiles: reconciled,
        safetyCheck,
        commitError,
      };
    });

    return valid;
  }

  async function selectStartupTargetFile(targetPath: string, svnExecutable?: string | null) {
    let current: WorkspaceSummary | null = null;
    let files: ChangedFile[] = [];
    update((state) => {
      current = state.current;
      files = state.status?.files ?? [];
      return state;
    });

    if (!current) {
      return false;
    }

    const relativePath = resolveStartupTargetFilePath(targetPath, current, files);
    if (!relativePath) {
      return false;
    }

    if (files.some((file) => file.path === relativePath)) {
      await selectFile(relativePath, svnExecutable);
    } else {
      selectPathOnly(relativePath);
    }
    return true;
  }

  function validateSelectedHunksForPartialCommit() {
    let valid = false;
    update((state) => {
      const selectedFiles = selectedHunkFilesForSafety(state.selectedHunks, state.status?.files ?? []);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        selectedFiles,
        state.safetyCheck.confirmedWarningIds,
        state.status,
      );
      const message = state.commitMessage.trim();
      let commitError: string | null = null;

      if (!state.current) {
        commitError = "请先打开 SVN 工作副本";
      } else if (!state.selectedPatch || selectedFiles.length === 0) {
        commitError = "请先选择 hunk 并生成 selected patch";
      } else if (!message) {
        commitError = "请输入提交信息";
      } else if (state.status?.mixed_revision) {
        commitError = `当前工作副本 revision 范围为 ${
          state.status.revision_range ?? "未知"
        }，Hunk 级部分提交前请先 update 到一致 revision`;
      } else if (safetyCheck.blockers.length > 0) {
        commitError = "安全检查存在阻塞项，请先处理冲突、缺失或阻塞文件";
      } else if (unconfirmedWarnings(safetyCheck).length > 0) {
        commitError = "安全检查存在警告项，请确认警告后再提交";
      }

      valid = commitError === null;
      saveWorkspaceDraftFromState({
        ...state,
        safetyCheck,
      });

      return {
        ...state,
        safetyCheck,
        commitError,
      };
    });

    return valid;
  }

  function confirmSafetyWarnings() {
    update((state) => {
      const reconciled = reconcileCommitFiles(state.commitFiles, state.status?.files ?? []);
      const safetyCheck = buildSafetyCheck(
        state.status?.files ?? [],
        reconciled,
        state.safetyCheck.confirmedWarningIds,
        state.status,
      );
      const nextSafetyCheck = {
        ...safetyCheck,
        confirmedWarningIds: safetyCheck.warnings.map((item) => item.id),
      };
      saveWorkspaceDraftFromState({
        ...state,
        safetyCheck: nextSafetyCheck,
      });

      return {
        ...state,
        commitFiles: reconciled,
        safetyCheck: nextSafetyCheck,
        commitError: null,
      };
    });
  }

  function markCommitTask(
    taskId: string | null,
    files?: string[],
    workingCopyRoot?: string | null,
  ) {
    update((state) => ({
      ...state,
      pendingCommitTaskId: taskId,
      pendingCommitFiles: taskId
        ? [...(files ?? state.commitFiles.map((file) => file.path))]
        : [],
      pendingCommitWorkingCopyRoot: taskId
        ? (workingCopyRoot ?? state.current?.working_copy_root ?? null)
        : null,
      commitError: null,
    }));
  }

  function failCommitTask(message: string) {
    update((state) => ({
      ...state,
      pendingCommitTaskId: null,
      pendingCommitFiles: [],
      pendingCommitWorkingCopyRoot: null,
      commitError: message,
    }));
  }

  function markPartialCommitTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingPartialCommitTaskId: taskId,
      commitError: null,
    }));
  }

  function completePartialCommit() {
    update((state) => {
      const commitHistory = recordCommitHistory(
        state.commitMessage,
        state.commitHistory,
        state.commitTemplate,
      );
      const nextState = {
        ...state,
        selectedHunks: [],
        selectedPatch: null,
        selectedPatchError: null,
        selectedPatchLoading: false,
        commitHistory,
        commitMessage: state.commitTemplate,
        commitError: null,
        pendingPartialCommitTaskId: null,
      };
      saveWorkspaceDraftFromState(nextState);
      return nextState;
    });
  }

  function markSvnOperationTask(
    taskId: string | null,
    kind: PendingSvnOperationKind | null,
    workingCopyRoot: string | null,
  ) {
    update((state) => ({
      ...state,
      pendingSvnOperationTaskId: taskId,
      pendingSvnOperationKind: taskId ? kind : null,
      pendingSvnOperationWorkingCopyRoot: taskId ? workingCopyRoot : null,
    }));
  }

  function failSvnOperationTask(message: string) {
    update((state) => ({
      ...state,
      pendingSvnOperationTaskId: null,
      pendingSvnOperationKind: null,
      pendingSvnOperationWorkingCopyRoot: null,
      statusError: {
        code: "SVN_OPERATION_TASK_MISSING",
        message,
        detail: null,
        recoverable: true,
      },
    }));
  }

  function setRepositoryUrlInput(value: string) {
    update((state) => ({
      ...state,
      repositoryUrlInput: value,
      repositoryError: null,
    }));
  }

  function setRepositoryRevisionInput(value: string) {
    update((state) => ({
      ...state,
      repositoryRevisionInput: value,
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
    if (taskId) {
      repositoryFileLogGeneration += 1;
      repositoryFileBlameGeneration += 1;
      repositoryFilePropertiesGeneration += 1;
    }
    update((state) => ({
      ...state,
      pendingRepositoryListTaskId: taskId,
      repositoryCurrentUrl: url ?? state.repositoryCurrentUrl,
      repositoryLoading: taskId !== null,
      repositoryError: null,
      repositoryFileLogRevision: taskId ? null : state.repositoryFileLogRevision,
      repositoryFileLog: taskId ? null : state.repositoryFileLog,
      repositoryFileLogLoading: taskId ? false : state.repositoryFileLogLoading,
      repositoryFileLogError: taskId ? null : state.repositoryFileLogError,
      repositoryFileBlameRevision: taskId ? null : state.repositoryFileBlameRevision,
      repositoryFileBlame: taskId ? null : state.repositoryFileBlame,
      repositoryFileBlameLoading: taskId ? false : state.repositoryFileBlameLoading,
      repositoryFileBlameError: taskId ? null : state.repositoryFileBlameError,
      repositoryFilePropertiesRevision: taskId
        ? null
        : state.repositoryFilePropertiesRevision,
      repositoryFileProperties: taskId ? null : state.repositoryFileProperties,
      repositoryFilePropertiesLoading: taskId
        ? false
        : state.repositoryFilePropertiesLoading,
      repositoryFilePropertiesError: taskId ? null : state.repositoryFilePropertiesError,
    }));
  }

  function applyRepositoryListResult(result: RepositoryListResult) {
    update((state) => ({
      ...state,
      repositoryUrlInput: result.url,
      repositoryRevisionInput: result.revision ?? "",
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
        [field]:
          field === "kind"
            ? value === "tag" || value === "entry"
              ? value
              : "branch"
            : value,
      },
      repositoryCopyError: null,
    }));
  }

  function prepareRepositoryCopyTarget(kind: RepositoryCopyKind, targetBaseUrl?: string | null) {
    update((state) => {
      const currentRepositoryUrl =
        state.repositoryCurrentUrl || state.repositoryList?.url || state.repositoryUrlInput;
      const sourceUrl =
        kind === "entry"
          ? currentRepositoryUrl || state.current?.repository_url || state.repositoryCopyForm.sourceUrl
          : state.repositoryCopyForm.sourceUrl ||
            state.current?.repository_url ||
            currentRepositoryUrl;
      const baseUrl =
        targetBaseUrl ||
        (kind === "branch"
          ? state.repositoryLayoutResults.branches?.url
          : kind === "tag"
            ? state.repositoryLayoutResults.tags?.url
            : sourceUrl) ||
        state.repositoryUrlInput;
      const suffix = kind === "branch" ? "new-branch" : kind === "tag" ? "new-tag" : "copy";

      return {
        ...state,
        repositoryCopyForm: {
          ...state.repositoryCopyForm,
          kind,
          sourceUrl,
          targetUrl: baseUrl
            ? kind === "entry"
              ? `${baseUrl.replace(/\/+$/, "")}-${suffix}`
              : `${baseUrl.replace(/\/+$/, "")}/${suffix}`
            : "",
          revision: state.repositoryCopyForm.revision || state.current?.revision || "",
        },
        repositoryCopyError: null,
      };
    });
  }

  function markRepositoryCopyTask(taskId: string | null, parentUrl?: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryCopyTaskId: taskId,
      pendingRepositoryCopyParentUrl: taskId ? parentUrl?.trim() || null : null,
      repositoryCopyError: null,
    }));
  }

  function completeRepositoryCopyTask() {
    update((state) => ({
      ...state,
      pendingRepositoryCopyTaskId: null,
      pendingRepositoryCopyParentUrl: null,
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
      pendingRepositoryCopyParentUrl: null,
      repositoryCopyError: message ?? "创建分支或标签失败",
    }));
  }

  function setRepositoryMkdirForm(
    field: keyof WorkspaceStoreState["repositoryMkdirForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryMkdirForm: {
        ...state.repositoryMkdirForm,
        [field]: value,
      },
      repositoryMkdirError: null,
    }));
  }

  function prepareRepositoryMkdir(parentUrl?: string | null) {
    update((state) => {
      const parent = (
        parentUrl ||
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput
      ).replace(/\/+$/, "");
      return {
        ...state,
        repositoryMkdirForm: {
          ...state.repositoryMkdirForm,
          targetUrl: parent ? `${parent}/new-folder` : "",
        },
        repositoryMkdirError: null,
      };
    });
  }

  function markRepositoryMkdirTask(taskId: string | null, parentUrl?: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryMkdirTaskId: taskId,
      pendingRepositoryMkdirParentUrl: taskId ? parentUrl?.trim() || null : null,
      repositoryMkdirError: null,
    }));
  }

  function completeRepositoryMkdirTask() {
    update((state) => ({
      ...state,
      pendingRepositoryMkdirTaskId: null,
      pendingRepositoryMkdirParentUrl: null,
      repositoryMkdirForm: {
        ...state.repositoryMkdirForm,
        targetUrl: "",
        message: "",
      },
      repositoryMkdirError: null,
    }));
  }

  function failRepositoryMkdirTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryMkdirTaskId: null,
      pendingRepositoryMkdirParentUrl: null,
      repositoryMkdirError: message ?? "创建仓库目录失败",
    }));
  }

  function setRepositoryImportForm(
    field: keyof WorkspaceStoreState["repositoryImportForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryImportForm: {
        ...state.repositoryImportForm,
        [field]: value,
      },
      repositoryImportError: null,
    }));
  }

  function prepareRepositoryImport(parentUrl?: string | null) {
    update((state) => {
      const parent = (
        parentUrl ||
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput
      ).replace(/\/+$/, "");
      return {
        ...state,
        repositoryImportForm: {
          ...state.repositoryImportForm,
          targetUrl: state.repositoryImportForm.targetUrl ||
            (parent ? `${parent}/imported-item` : ""),
        },
        repositoryImportError: null,
      };
    });
  }

  async function chooseRepositoryImportSource(directory: boolean) {
    const selected = await chooseImportSource(directory);
    if (!selected) {
      return;
    }
    update((state) => {
      const parent = (
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput
      ).replace(/\/+$/, "");
      const name = selected.split(/[\\/]/).filter(Boolean).at(-1) || "imported-item";
      return {
        ...state,
        repositoryImportForm: {
          ...state.repositoryImportForm,
          sourcePath: selected,
          targetUrl: state.repositoryImportForm.targetUrl ||
            (parent ? `${parent}/${encodeURIComponent(name)}` : ""),
        },
        repositoryImportError: null,
      };
    });
  }

  function prepareRepositoryImportFromDrop(sourcePath: string) {
    const selected = sourcePath.trim();
    if (!selected) {
      return;
    }
    update((state) => {
      const parent = (
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput
      ).replace(/\/+$/, "");
      const name = selected.split(/[\\/]/).filter(Boolean).at(-1) || "imported-item";
      return {
        ...state,
        repositoryImportForm: {
          ...state.repositoryImportForm,
          sourcePath: selected,
          targetUrl: parent ? `${parent}/${encodeURIComponent(name)}` : "",
        },
        repositoryImportError: null,
      };
    });
  }

  function markRepositoryImportTask(taskId: string | null, parentUrl?: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryImportTaskId: taskId,
      pendingRepositoryImportParentUrl: taskId ? parentUrl?.trim() || null : null,
      repositoryImportError: null,
    }));
  }

  function completeRepositoryImportTask() {
    update((state) => ({
      ...state,
      pendingRepositoryImportTaskId: null,
      pendingRepositoryImportParentUrl: null,
      repositoryImportForm: emptyRepositoryImportForm(),
      repositoryImportError: null,
    }));
  }

  function failRepositoryImportTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryImportTaskId: null,
      pendingRepositoryImportParentUrl: null,
      repositoryImportError: message ?? "Repository Import 失败",
    }));
  }

  function setRepositoryMoveForm(
    field: keyof WorkspaceStoreState["repositoryMoveForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryMoveForm: {
        ...state.repositoryMoveForm,
        [field]: value,
      },
      repositoryMoveError: null,
    }));
  }

  function prepareRepositoryMove(sourceUrl?: string | null) {
    update((state) => {
      const source = (
        sourceUrl ||
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput
      ).replace(/\/+$/, "");
      return {
        ...state,
        repositoryMoveForm: {
          ...state.repositoryMoveForm,
          sourceUrl: source,
          targetUrl: source ? `${source}-moved` : "",
        },
        repositoryMoveError: null,
      };
    });
  }

  function setRepositoryRenameForm(
    field: keyof WorkspaceStoreState["repositoryRenameForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryRenameForm: {
        ...state.repositoryRenameForm,
        [field]: value,
      },
      repositoryRenameError: null,
    }));
  }

  function prepareRepositoryRename(sourceUrl?: string | null) {
    update((state) => {
      const source = (
        sourceUrl ||
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput
      ).replace(/\/+$/, "");
      const separatorIndex = source.lastIndexOf("/");
      const parent = separatorIndex >= 0 ? source.slice(0, separatorIndex) : "";
      const name = separatorIndex >= 0 ? source.slice(separatorIndex + 1) : source;
      return {
        ...state,
        repositoryRenameForm: {
          ...state.repositoryRenameForm,
          sourceUrl: source,
          targetUrl: parent && name ? `${parent}/${name}-renamed` : "",
        },
        repositoryRenameError: null,
      };
    });
  }

  function markRepositoryMoveTask(
    taskId: string | null,
    sourceParentUrl?: string | null,
    targetParentUrl?: string | null,
    kind: RepositoryMoveKind = "move",
  ) {
    update((state) => ({
      ...state,
      pendingRepositoryMoveTaskId: taskId,
      pendingRepositoryMoveKind: taskId ? kind : null,
      pendingRepositoryMoveSourceParentUrl: taskId ? sourceParentUrl?.trim() || null : null,
      pendingRepositoryMoveTargetParentUrl: taskId ? targetParentUrl?.trim() || null : null,
      repositoryMoveError: kind === "move" ? null : state.repositoryMoveError,
      repositoryRenameError: kind === "rename" ? null : state.repositoryRenameError,
    }));
  }

  function completeRepositoryMoveTask() {
    update((state) => {
      const rename = state.pendingRepositoryMoveKind === "rename";
      return {
        ...state,
        pendingRepositoryMoveTaskId: null,
        pendingRepositoryMoveKind: null,
        pendingRepositoryMoveSourceParentUrl: null,
        pendingRepositoryMoveTargetParentUrl: null,
        repositoryMoveForm: rename ? state.repositoryMoveForm : emptyRepositoryMoveForm(),
        repositoryMoveError: rename ? state.repositoryMoveError : null,
        repositoryRenameForm: rename ? emptyRepositoryRenameForm() : state.repositoryRenameForm,
        repositoryRenameError: rename ? null : state.repositoryRenameError,
      };
    });
  }

  function failRepositoryMoveTask(message: string | null) {
    update((state) => {
      const rename = state.pendingRepositoryMoveKind === "rename";
      return {
        ...state,
        pendingRepositoryMoveTaskId: null,
        pendingRepositoryMoveKind: null,
        pendingRepositoryMoveSourceParentUrl: null,
        pendingRepositoryMoveTargetParentUrl: null,
        repositoryMoveError: rename ? state.repositoryMoveError : message ?? "Repository Move 失败",
        repositoryRenameError: rename
          ? message ?? "Repository Rename 失败"
          : state.repositoryRenameError,
      };
    });
  }

  function failRepositoryRenameTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryMoveTaskId: null,
      pendingRepositoryMoveKind: null,
      pendingRepositoryMoveSourceParentUrl: null,
      pendingRepositoryMoveTargetParentUrl: null,
      repositoryRenameError: message ?? "Repository Rename 失败",
    }));
  }

  function setRepositoryDeleteForm(
    field: keyof WorkspaceStoreState["repositoryDeleteForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryDeleteForm: {
        ...state.repositoryDeleteForm,
        [field]: value,
      },
      repositoryDeleteError: null,
    }));
  }

  function prepareRepositoryDelete(url?: string | null) {
    update((state) => ({
      ...state,
      repositoryDeleteForm: {
        ...state.repositoryDeleteForm,
        url: (
          url ||
          state.repositoryCurrentUrl ||
          state.repositoryList?.url ||
          state.repositoryUrlInput
        ).replace(/\/+$/, ""),
      },
      repositoryDeleteError: null,
    }));
  }

  function markRepositoryDeleteTask(taskId: string | null, parentUrl?: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryDeleteTaskId: taskId,
      pendingRepositoryDeleteParentUrl: taskId ? parentUrl?.trim() || null : null,
      repositoryDeleteError: null,
    }));
  }

  function completeRepositoryDeleteTask() {
    update((state) => ({
      ...state,
      pendingRepositoryDeleteTaskId: null,
      pendingRepositoryDeleteParentUrl: null,
      repositoryDeleteForm: emptyRepositoryDeleteForm(),
      repositoryDeleteError: null,
    }));
  }

  function failRepositoryDeleteTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryDeleteTaskId: null,
      pendingRepositoryDeleteParentUrl: null,
      repositoryDeleteError: message ?? "Repository Delete 失败",
    }));
  }

  function setRepositoryCheckoutForm(
    field: keyof WorkspaceStoreState["repositoryCheckoutForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryCheckoutForm: {
        ...state.repositoryCheckoutForm,
        [field]: value,
      },
      repositoryCheckoutError: null,
    }));
  }

  function prepareRepositoryCheckout(url?: string | null, revision?: string | null) {
    update((state) => {
      const nextUrl = (
        url ||
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput ||
        state.current?.repository_url ||
        ""
      ).trim();
      const nextRevision = (
        revision ??
        state.repositoryList?.revision ??
        state.repositoryRevisionInput ??
        ""
      ).toString();
      const nextLocalPath =
        state.repositoryCheckoutForm.localPath.trim() ||
        suggestCheckoutLocalPath(nextUrl, loadAppSettings().branchPoolBasePath);

      return {
        ...state,
        repositoryCheckoutForm: {
          url: nextUrl,
          localPath: nextLocalPath,
          revision: nextRevision,
        },
        repositoryCheckoutError: null,
      };
    });
  }

  async function chooseRepositoryCheckoutParent() {
    const selected = await chooseCheckoutDirectory();
    if (!selected) {
      return;
    }

    update((state) => {
      const url = state.repositoryCheckoutForm.url.trim();
      const suggested = suggestCheckoutLocalPath(url, selected);
      return {
        ...state,
        repositoryCheckoutForm: {
          ...state.repositoryCheckoutForm,
          localPath: suggested || selected,
        },
        repositoryCheckoutError: null,
      };
    });
  }

  function markRepositoryCheckoutTask(taskId: string | null, localPath?: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryCheckoutTaskId: taskId,
      pendingRepositoryCheckoutLocalPath: taskId
        ? (localPath ?? state.repositoryCheckoutForm.localPath).trim() || null
        : null,
      repositoryCheckoutError: null,
    }));
  }

  function completeRepositoryCheckoutTask() {
    update((state) => ({
      ...state,
      pendingRepositoryCheckoutTaskId: null,
      pendingRepositoryCheckoutLocalPath: null,
      repositoryCheckoutForm: {
        ...state.repositoryCheckoutForm,
        localPath: "",
      },
      repositoryCheckoutError: null,
    }));
  }

  function failRepositoryCheckoutTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryCheckoutTaskId: null,
      pendingRepositoryCheckoutLocalPath: null,
      repositoryCheckoutError: message ?? "仓库 Checkout 失败",
    }));
  }

  function setRepositoryExportForm(
    field: keyof WorkspaceStoreState["repositoryExportForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      repositoryExportForm: {
        ...state.repositoryExportForm,
        [field]: value,
      },
      repositoryExportError: null,
    }));
  }

  function prepareRepositoryExport(url?: string | null, revision?: string | null) {
    update((state) => {
      const nextUrl = (
        url ||
        state.repositoryCurrentUrl ||
        state.repositoryList?.url ||
        state.repositoryUrlInput ||
        state.current?.repository_url ||
        ""
      ).trim();
      const nextRevision = (
        revision ??
        state.repositoryList?.revision ??
        state.repositoryRevisionInput ??
        ""
      ).toString();
      const nextLocalPath =
        state.repositoryExportForm.localPath.trim() ||
        suggestCheckoutLocalPath(nextUrl, loadAppSettings().branchPoolBasePath);

      return {
        ...state,
        repositoryExportForm: {
          url: nextUrl,
          localPath: nextLocalPath,
          revision: nextRevision,
        },
        repositoryExportError: null,
      };
    });
  }

  async function chooseRepositoryExportParent() {
    const selected = await chooseExportDirectory();
    if (!selected) {
      return;
    }

    update((state) => {
      const url = state.repositoryExportForm.url.trim();
      const suggested = suggestCheckoutLocalPath(url, selected);
      return {
        ...state,
        repositoryExportForm: {
          ...state.repositoryExportForm,
          localPath: suggested || selected,
        },
        repositoryExportError: null,
      };
    });
  }

  function markRepositoryExportTask(taskId: string | null, localPath?: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryExportTaskId: taskId,
      pendingRepositoryExportLocalPath: taskId
        ? (localPath ?? state.repositoryExportForm.localPath).trim() || null
        : null,
      repositoryExportError: null,
    }));
  }

  function completeRepositoryExportTask() {
    update((state) => ({
      ...state,
      pendingRepositoryExportTaskId: null,
      pendingRepositoryExportLocalPath: null,
      repositoryExportForm: {
        ...state.repositoryExportForm,
        localPath: "",
      },
      repositoryExportError: null,
    }));
  }

  function failRepositoryExportTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryExportTaskId: null,
      pendingRepositoryExportLocalPath: null,
      repositoryExportError: message ?? "仓库 Export 失败",
    }));
  }

  function setSvnSwitchTargetUrl(value: string) {
    update((state) => ({
      ...state,
      svnSwitchTargetUrl: value,
      svnSwitchError: null,
    }));
  }

  function markSvnSwitchTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingSvnSwitchTaskId: taskId,
      svnSwitchError: null,
    }));
  }

  function failSvnSwitchTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingSvnSwitchTaskId: null,
      svnSwitchError: message ?? "svn switch 失败",
    }));
  }

  function exportTaskWorkspaceDraft() {
    const state = get({ subscribe });
    return buildTaskWorkspaceDraftSnapshot(state);
  }

  function importTaskWorkspaceDraft(draft: Partial<WorkspaceDraft>) {
    update((state) => {
      const draftState = normalizeWorkspaceDraftInput(draft, state.commitTemplate);
      const currentFiles = state.status?.files ?? [];
      const selectedHunks =
        currentFiles.length > 0
          ? reconcileSelectedHunks(draftState.selectedHunks, currentFiles)
          : draftState.selectedHunks;
      const reviewedFiles =
        currentFiles.length > 0
          ? reconcileReviewedFiles(draftState.reviewedFiles, currentFiles)
          : draftState.reviewedFiles;
      const nextState = {
        ...state,
        commitFiles: [],
        selectedHunks,
        reviewedFiles,
        safetyCheck: buildSafetyCheck(
          currentFiles,
          [],
          draftState.confirmedWarningIds,
          state.status,
        ),
        commitMessage: draftState.commitMessage,
        selectedPatch: null,
        commitError: null,
      };
      saveWorkspaceDraftFromState(nextState);
      return nextState;
    });
  }

  function clearCommittedFiles(paths: string[]) {
    const committed = new Set(paths);
    update((state) => {
      const commitFiles = state.commitFiles.filter((file) => !committed.has(file.path));
      const commitHistory = recordCommitHistory(
        state.commitMessage,
        state.commitHistory,
        state.commitTemplate,
      );
      const nextState = {
        ...state,
        commitFiles,
        safetyCheck: buildSafetyCheck(state.status?.files ?? [], commitFiles, [], state.status),
        commitHistory,
        commitMessage: state.commitTemplate,
      };
      saveWorkspaceDraftFromState(nextState);

      return {
        ...state,
        commitFiles,
        safetyCheck: nextState.safetyCheck,
        commitHistory,
        commitMessage: state.commitTemplate,
        commitError: null,
        pendingCommitTaskId: null,
        pendingCommitFiles: [],
        pendingCommitWorkingCopyRoot: null,
        pendingPartialCommitTaskId: null,
      };
    });
  }

  async function refreshStatus(
    svnExecutable?: string | null,
    workingCopyRoot?: string,
  ): Promise<WorkingCopyStatus | null> {
    const requestGeneration = ++statusRefreshGeneration;
    fileTreeRefreshGeneration += 1;
    const state = get({ subscribe });
    const root = workingCopyRoot || state.current?.working_copy_root || "";

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
      return null;
    }

    if (
      state.current &&
      !isSameWorkingCopyRoot(root, state.current.working_copy_root)
    ) {
      return null;
    }

    update((current) => ({
      ...current,
      statusLoading: true,
      statusError: null,
    }));

    let refreshedStatus: WorkingCopyStatus | null = null;
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
      if (!isCurrentStatusRequest(requestGeneration, root)) {
        return null;
      }
      refreshedStatus = status;
      const selectedFilePath = applyStatusResult(status, previousSelectedFilePath);
      await refreshFileTree(svnExecutable, root);
      if (!isCurrentStatusRequest(requestGeneration, root)) {
        return null;
      }
      if (selectedFilePath) {
        await Promise.all([
          refreshFileDiff(svnExecutable, root, selectedFilePath),
          refreshFileContentDiff(svnExecutable, root, selectedFilePath),
        ]);
        await refreshParsedDiff(selectedFilePath);
      }
      return status;
    } catch (error) {
      if (!isCurrentStatusRequest(requestGeneration, root)) {
        return null;
      }
      update((state) => ({
        ...state,
        statusLoading: false,
        statusError: error as CommandError,
      }));
      return refreshedStatus;
    }
  }

  async function refreshFileTree(svnExecutable?: string | null, workingCopyRoot?: string) {
    const requestGeneration = ++fileTreeRefreshGeneration;
    const state = get({ subscribe });
    const root = workingCopyRoot || state.current?.working_copy_root || "";

    if (
      !root ||
      (state.current && !isSameWorkingCopyRoot(root, state.current.working_copy_root))
    ) {
      return null;
    }

    try {
      const fileTree = await listWorkspaceFiles({
        working_copy_root: root,
        svn_executable: svnExecutable || undefined,
        max_files: 5000,
      });
      if (!isCurrentFileTreeRequest(requestGeneration, root)) {
        return null;
      }
      update((state) => ({
        ...state,
        fileTree,
      }));
      return fileTree;
    } catch (error) {
      if (!isCurrentFileTreeRequest(requestGeneration, root)) {
        return null;
      }
      update((state) => ({
        ...state,
        statusError: error as CommandError,
      }));
      return null;
    }
  }

  async function loadMoreStatus(
    svnExecutable?: string | null,
  ): Promise<WorkingCopyStatus | null> {
    const state = get({ subscribe });
    const root = state.current?.working_copy_root;
    const currentStatus = state.status;
    if (!root || !currentStatus || currentStatus.files.length >= currentStatus.total) {
      return currentStatus ?? null;
    }

    const requestGeneration = ++statusRefreshGeneration;
    fileTreeRefreshGeneration += 1;

    update((current) => ({
      ...current,
      statusLoading: true,
      statusError: null,
    }));

    try {
      const nextPage = await scanWorkspaceStatus({
        working_copy_root: root,
        svn_executable: svnExecutable || undefined,
        offset: currentStatus.files.length,
        limit: 500,
      });
      if (!isCurrentStatusRequest(requestGeneration, root)) {
        return null;
      }
      const existingPaths = new Set(currentStatus.files.map((file) => file.path));
      const mergedStatus = {
        ...nextPage,
        offset: 0,
        returned:
          currentStatus.files.length +
          nextPage.files.filter((file) => !existingPaths.has(file.path)).length,
        files: [
          ...currentStatus.files,
          ...nextPage.files.filter((file) => !existingPaths.has(file.path)),
        ],
      };
      applyStatusResult(mergedStatus, get({ subscribe }).selectedFilePath, true);
      return mergedStatus;
    } catch (error) {
      if (!isCurrentStatusRequest(requestGeneration, root)) {
        return null;
      }
      update((current) => ({
        ...current,
        statusLoading: false,
        statusError: error as CommandError,
      }));
      return null;
    }
  }

  async function loadStatusUntilFile(
    path: string,
    svnExecutable: string | null | undefined,
    workingCopyRoot: string,
    selectionGeneration: number,
  ) {
    while (true) {
      const state = get({ subscribe });
      if (
        selectionGeneration !== fileSelectionGeneration ||
        !state.current ||
        !isSameWorkingCopyRoot(workingCopyRoot, state.current.working_copy_root)
      ) {
        return false;
      }
      const status = state.status;
      if (status?.files.some((file) => file.path === path)) {
        return true;
      }
      if (!status || status.files.length >= status.total) {
        return false;
      }

      const previousCount = status.files.length;
      await loadMoreStatus(svnExecutable);
      const nextStatus = get({ subscribe }).status;
      if (!nextStatus || nextStatus.files.length <= previousCount) {
        return false;
      }
    }
  }

  function markRepositoryFileTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryFileTaskId: taskId,
      repositoryFileLoading: taskId !== null,
      repositoryFileError: null,
    }));
  }

  function completeRepositoryFile(result: RepositoryFileResult) {
    update((state) => ({
      ...state,
      pendingRepositoryFileTaskId: null,
      repositoryFileLoading: false,
      repositoryFileError: null,
    }));
    return result;
  }

  function failRepositoryFile(message: string | null) {
    update((state) => ({
      ...state,
      pendingRepositoryFileTaskId: null,
      repositoryFileLoading: false,
      repositoryFileError: message ?? "仓库文件打开失败",
    }));
  }

  async function loadRepositoryFileLog(request: {
    url: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    const requestGeneration = ++repositoryFileLogGeneration;
    repositoryFileBlameGeneration += 1;
    repositoryFilePropertiesGeneration += 1;
    const revision = request.revision || null;
    update((state) => ({
      ...state,
      repositoryFileLogRevision: revision,
      repositoryFileLog: null,
      repositoryFileLogLoading: true,
      repositoryFileLogError: null,
      repositoryFileBlameRevision: null,
      repositoryFileBlame: null,
      repositoryFileBlameLoading: false,
      repositoryFileBlameError: null,
      repositoryFilePropertiesRevision: null,
      repositoryFileProperties: null,
      repositoryFilePropertiesLoading: false,
      repositoryFilePropertiesError: null,
    }));

    try {
      const log = await getRepositoryFileLog({
        url: request.url,
        revision: revision || undefined,
        svn_executable: request.svnExecutable || undefined,
        limit: 50,
      });
      if (requestGeneration !== repositoryFileLogGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        repositoryFileLog: log,
        repositoryFileLogLoading: false,
        repositoryFileLogError: null,
      }));
      return log;
    } catch (error) {
      if (requestGeneration !== repositoryFileLogGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        repositoryFileLog: null,
        repositoryFileLogLoading: false,
        repositoryFileLogError: error as CommandError,
      }));
      return null;
    }
  }

  async function loadMoreRepositoryFileLog(svnExecutable?: string | null) {
    const state = get({ subscribe });
    const startRevision = state.repositoryFileLog?.next_start_revision;
    if (
      state.repositoryFileLogLoading ||
      !state.repositoryFileLog?.has_more ||
      !startRevision
    ) {
      return null;
    }
    const requestGeneration = repositoryFileLogGeneration;
    update((current) => ({
      ...current,
      repositoryFileLogLoading: true,
      repositoryFileLogError: null,
    }));

    try {
      const next = await getRepositoryFileLog({
        url: state.repositoryFileLog.target,
        revision: state.repositoryFileLogRevision || undefined,
        svn_executable: svnExecutable || undefined,
        limit: 50,
        start_revision: startRevision,
      });
      if (requestGeneration !== repositoryFileLogGeneration) {
        return null;
      }
      update((current) => ({
        ...current,
        repositoryFileLog: current.repositoryFileLog
          ? mergeSvnLogPage(current.repositoryFileLog, next)
          : next,
        repositoryFileLogLoading: false,
        repositoryFileLogError: null,
      }));
      return next;
    } catch (error) {
      if (requestGeneration !== repositoryFileLogGeneration) {
        return null;
      }
      update((current) => ({
        ...current,
        repositoryFileLogLoading: false,
        repositoryFileLogError: error as CommandError,
      }));
      return null;
    }
  }

  function clearRepositoryFileLog() {
    repositoryFileLogGeneration += 1;
    repositoryFilePropertiesGeneration += 1;
    update((state) => ({
      ...state,
      repositoryFileLogRevision: null,
      repositoryFileLog: null,
      repositoryFileLogLoading: false,
      repositoryFileLogError: null,
    }));
  }

  async function loadRepositoryFileBlame(request: {
    url: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    const requestGeneration = ++repositoryFileBlameGeneration;
    repositoryFileLogGeneration += 1;
    repositoryFilePropertiesGeneration += 1;
    const revision = request.revision || null;
    update((state) => ({
      ...state,
      repositoryFileLogRevision: null,
      repositoryFileLog: null,
      repositoryFileLogLoading: false,
      repositoryFileLogError: null,
      repositoryFileBlameRevision: revision,
      repositoryFileBlame: null,
      repositoryFileBlameLoading: true,
      repositoryFileBlameError: null,
      repositoryFilePropertiesRevision: null,
      repositoryFileProperties: null,
      repositoryFilePropertiesLoading: false,
      repositoryFilePropertiesError: null,
    }));

    try {
      const blame = await getRepositoryFileBlame({
        url: request.url,
        revision: revision || undefined,
        svn_executable: request.svnExecutable || undefined,
        max_lines: 5000,
      });
      if (requestGeneration !== repositoryFileBlameGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        repositoryFileBlame: blame,
        repositoryFileBlameLoading: false,
        repositoryFileBlameError: null,
      }));
      return blame;
    } catch (error) {
      if (requestGeneration !== repositoryFileBlameGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        repositoryFileBlame: null,
        repositoryFileBlameLoading: false,
        repositoryFileBlameError: error as CommandError,
      }));
      return null;
    }
  }

  function clearRepositoryFileBlame() {
    repositoryFileBlameGeneration += 1;
    update((state) => ({
      ...state,
      repositoryFileBlameRevision: null,
      repositoryFileBlame: null,
      repositoryFileBlameLoading: false,
      repositoryFileBlameError: null,
    }));
  }

  async function loadRepositoryFileProperties(request: {
    url: string;
    revision?: string | null;
    svnExecutable?: string | null;
  }) {
    const requestGeneration = ++repositoryFilePropertiesGeneration;
    repositoryFileLogGeneration += 1;
    repositoryFileBlameGeneration += 1;
    const revision = request.revision || null;
    update((state) => ({
      ...state,
      repositoryFileLogRevision: null,
      repositoryFileLog: null,
      repositoryFileLogLoading: false,
      repositoryFileLogError: null,
      repositoryFileBlameRevision: null,
      repositoryFileBlame: null,
      repositoryFileBlameLoading: false,
      repositoryFileBlameError: null,
      repositoryFilePropertiesRevision: revision,
      repositoryFileProperties: null,
      repositoryFilePropertiesLoading: true,
      repositoryFilePropertiesError: null,
    }));

    try {
      const properties = await getRepositoryFileProperties({
        url: request.url,
        revision: revision || undefined,
        svn_executable: request.svnExecutable || undefined,
      });
      if (requestGeneration !== repositoryFilePropertiesGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        repositoryFileProperties: properties,
        repositoryFilePropertiesLoading: false,
        repositoryFilePropertiesError: null,
      }));
      return properties;
    } catch (error) {
      if (requestGeneration !== repositoryFilePropertiesGeneration) {
        return null;
      }
      update((state) => ({
        ...state,
        repositoryFileProperties: null,
        repositoryFilePropertiesLoading: false,
        repositoryFilePropertiesError: error as CommandError,
      }));
      return null;
    }
  }

  function clearRepositoryFileProperties() {
    repositoryFilePropertiesGeneration += 1;
    update((state) => ({
      ...state,
      repositoryFilePropertiesRevision: null,
      repositoryFileProperties: null,
      repositoryFilePropertiesLoading: false,
      repositoryFilePropertiesError: null,
    }));
  }

  function isCurrentStatusRequest(requestGeneration: number, root: string) {
    const state = get({ subscribe });
    return (
      requestGeneration === statusRefreshGeneration &&
      state.current !== null &&
      isSameWorkingCopyRoot(root, state.current.working_copy_root)
    );
  }

  function isCurrentFileTreeRequest(requestGeneration: number, root: string) {
    const state = get({ subscribe });
    return (
      requestGeneration === fileTreeRefreshGeneration &&
      state.current !== null &&
      isSameWorkingCopyRoot(root, state.current.working_copy_root)
    );
  }

  function applyStatusResult(
    status: WorkingCopyStatus,
    previousSelectedFilePath: string | null,
    preserveUnloadedSelection = false,
  ) {
    const selectedFilePath =
      preserveUnloadedSelection && previousSelectedFilePath
        ? previousSelectedFilePath
        : resolveSelectedFilePath(status.files, previousSelectedFilePath);
    update((state) => {
      const previousCommittableFiles = state.status?.files.filter(isCommittable) ?? [];
      const hadEveryFileSelected =
        state.status === null ||
        previousCommittableFiles.every((file) =>
          state.commitFiles.some((selected) => selected.path === file.path),
        );
      const commitFiles = hadEveryFileSelected
        ? buildCommitFileSelection(status.files)
        : reconcileCommitFiles(state.commitFiles, status.files);
      const reviewedFiles = reconcileReviewedFiles(state.reviewedFiles, status.files);
      const selectedHunks = reconcileSelectedHunks(state.selectedHunks, status.files);
      const safetyCheck = buildSafetyCheck(
        status.files,
        commitFiles,
        state.safetyCheck.confirmedWarningIds,
        status,
      );
      const selectedFileChanged = selectedFilePath !== state.selectedFilePath;
      const preserveScopedProperties =
        state.svnProperties !== null &&
        state.svnProperties.target !== state.selectedFilePath;
      const nextState = {
        ...state,
        status,
        selectedFilePath,
        selectedFileDiff:
          selectedFilePath === state.selectedFilePath ? state.selectedFileDiff : null,
        selectedFileContentDiff:
          selectedFilePath === state.selectedFilePath ? state.selectedFileContentDiff : null,
        commitFiles,
        safetyCheck,
        selectedHunks,
        selectedPatch: null,
        reviewedFiles,
        statusLoading: false,
        statusError: null,
        ...(selectedFileChanged ? clearSvnBlameState() : {}),
        ...(selectedFileChanged && !preserveScopedProperties
          ? clearSvnPropertiesState()
          : {}),
      };
      saveWorkspaceDraftFromState(nextState);
      return nextState;
    });
    return selectedFilePath;
  }

  function clearWorkspaceDraft() {
    update((state) => {
      if (state.current) {
        clearWorkspaceDraftStorage(state.current);
      }

      return {
        ...state,
        commitFiles: [],
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

  async function refreshSvnProperties(svnExecutable?: string | null) {
    const state = get({ subscribe });
    if (!state.current) {
      update((current) => ({
        ...current,
        svnPropertiesError: {
          code: "WORKSPACE_REQUIRED",
          message: "请先打开 SVN 工作副本",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }

    update((current) => ({
      ...current,
      svnPropertiesLoading: true,
      svnPropertiesError: null,
    }));

    try {
      const svnProperties = await getSvnProperties({
        working_copy_root: state.current.working_copy_root,
        file_path: state.selectedFilePath || undefined,
        svn_executable: svnExecutable || undefined,
      });
      update((current) => ({
        ...current,
        svnProperties,
        svnPropertiesLoading: false,
        svnPropertiesError: null,
      }));
    } catch (error) {
      update((current) => ({
        ...current,
        svnProperties: null,
        svnPropertiesLoading: false,
        svnPropertiesError: error as CommandError,
      }));
    }
  }

  function setPropertyEditForm(field: keyof WorkspaceStoreState["propertyEditForm"], value: string) {
    update((state) => ({
      ...state,
      propertyEditForm: {
        ...state.propertyEditForm,
        [field]: value,
      },
      svnPropertiesError: null,
    }));
  }

  function usePropertyForEdit(name: string, value: string) {
    update((state) => ({
      ...state,
      propertyEditForm: { name, value },
      svnPropertiesError: null,
    }));
  }

  async function saveSvnProperty(svnExecutable?: string | null) {
    const state = get({ subscribe });
    if (!state.current) {
      update((current) => ({
        ...current,
        svnPropertiesError: {
          code: "WORKSPACE_REQUIRED",
          message: "请先打开 SVN 工作副本",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }

    update((current) => ({
      ...current,
      svnPropertiesLoading: true,
      svnPropertiesError: null,
    }));

    try {
      const svnProperties = await setSvnProperty({
        working_copy_root: state.current.working_copy_root,
        file_path: state.selectedFilePath || undefined,
        name: state.propertyEditForm.name,
        value: state.propertyEditForm.value,
        svn_executable: svnExecutable || undefined,
      });
      update((current) => ({
        ...current,
        svnProperties,
        svnPropertiesLoading: false,
        svnPropertiesError: null,
      }));
    } catch (error) {
      update((current) => ({
        ...current,
        svnPropertiesLoading: false,
        svnPropertiesError: error as CommandError,
      }));
    }
  }

  async function ignorePath(
    path: string,
    svnExecutable?: string | null,
  ): Promise<SvnProperties | null> {
    const state = get({ subscribe });
    if (!state.current) {
      update((current) => ({
        ...current,
        svnPropertiesError: {
          code: "WORKSPACE_REQUIRED",
          message: "请先打开 SVN 工作副本",
          detail: null,
          recoverable: true,
        },
      }));
      return null;
    }

    const workingCopyRoot = state.current.working_copy_root;
    update((current) => ({
      ...current,
      svnPropertiesLoading: true,
      svnPropertiesError: null,
    }));

    try {
      const svnProperties = await ignoreWorkspacePath({
        working_copy_root: workingCopyRoot,
        file_path: path,
        svn_executable: svnExecutable || undefined,
      });
      const ignoreValue =
        svnProperties.properties.find((property) => property.name === "svn:ignore")?.value ?? "";
      update((current) => {
        if (
          !current.current ||
          !isSameWorkingCopyRoot(current.current.working_copy_root, workingCopyRoot)
        ) {
          return current;
        }
        return {
          ...current,
          svnProperties,
          svnPropertiesLoading: false,
          svnPropertiesError: null,
          propertyEditForm: {
            name: "svn:ignore",
            value: ignoreValue,
          },
        };
      });
      return svnProperties;
    } catch (error) {
      update((current) => {
        if (
          !current.current ||
          !isSameWorkingCopyRoot(current.current.working_copy_root, workingCopyRoot)
        ) {
          return current;
        }
        return {
          ...current,
          svnPropertiesLoading: false,
          svnPropertiesError: error as CommandError,
        };
      });
      return null;
    }
  }

  async function refreshSvnLog(svnExecutable?: string | null) {
    await fetchSvnLogPage(svnExecutable, false);
  }

  async function loadMoreSvnLog(svnExecutable?: string | null) {
    await fetchSvnLogPage(svnExecutable, true);
  }

  async function fetchSvnLogPage(svnExecutable: string | null | undefined, append: boolean) {
    const state = get({ subscribe });
    if (!state.current) {
      update((current) => ({
        ...current,
        svnLogError: {
          code: "WORKSPACE_REQUIRED",
          message: "请先打开 SVN 工作副本",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }
    const nextStartRevision = append ? state.svnLog?.next_start_revision : undefined;
    if (append && (!state.svnLog?.has_more || !nextStartRevision)) {
      return;
    }
    if (state.svnLogFileOnly && !state.selectedFilePath) {
      update((current) => ({
        ...current,
        svnLogLoading: false,
        svnLogError: {
          code: "SVN_LOG_FILE_REQUIRED",
          message: "请先选择要查看历史的文件",
          detail: null,
          recoverable: true,
        },
      }));
      return;
    }

    update((current) => ({
      ...current,
      svnLogLoading: true,
      svnLogError: null,
    }));

    try {
      const svnLog = await getSvnLog({
        working_copy_root: state.current.working_copy_root,
        file_path: state.svnLogFileOnly ? state.selectedFilePath || undefined : undefined,
        svn_executable: svnExecutable || undefined,
        limit: state.svnLogLimit,
        start_revision: nextStartRevision || undefined,
      });
      update((current) => ({
        ...current,
        svnLog: append && current.svnLog ? mergeSvnLogPage(current.svnLog, svnLog) : svnLog,
        svnLogLoading: false,
        svnLogError: null,
      }));
    } catch (error) {
      update((current) => ({
        ...current,
        svnLog: append ? current.svnLog : null,
        svnLogLoading: false,
        svnLogError: error as CommandError,
      }));
    }
  }

  function setSvnLogFilter(
    field:
      | "svnLogAuthorFilter"
      | "svnLogKeywordFilter"
      | "svnLogDateFromFilter"
      | "svnLogDateToFilter",
    value: string,
  ) {
    update((state) => ({
      ...state,
      [field]: value,
    }));
  }

  function setSvnLogFileOnly(value: boolean) {
    update((state) => ({
      ...state,
      svnLogFileOnly: value,
      svnLog: state.svnLogFileOnly === value ? state.svnLog : null,
      svnLogError: null,
    }));
  }

  function setSvnLogLimit(value: number) {
    update((state) => ({
      ...state,
      svnLogLimit: Math.min(Math.max(value, 1), 200),
    }));
  }

  function setRevisionDiffForm(
    field: keyof WorkspaceStoreState["revisionDiffForm"],
    value: string,
  ) {
    update((state) => ({
      ...state,
      revisionDiffForm: {
        ...state.revisionDiffForm,
        [field]: field === "mode" ? normalizeRevisionDiffMode(value) : value,
      },
      revisionDiffError: null,
    }));
  }

  function prepareRevisionDiffFromLog(revision: string, repositoryPath?: string) {
    const normalizedRevision = revision.trim();
    const previousRevision = /^[1-9]\d*$/.test(normalizedRevision)
      ? (BigInt(normalizedRevision) - 1n).toString()
      : null;
    let prepared = false;
    update((state) => {
      const targetUrl = repositoryPath
        ? repositoryPathUrl(state.current?.repository_root, repositoryPath)
        : "";
      if (repositoryPath && !targetUrl) {
        return {
          ...state,
          revisionDiffError: "改变路径无法映射到当前 SVN 仓库",
        };
      }
      prepared = true;
      return {
        ...state,
        revisionDiffForm: {
          ...state.revisionDiffForm,
          mode: "revisions",
          targetUrl: targetUrl || "",
          leftRevision: previousRevision ?? state.revisionDiffForm.leftRevision,
          rightRevision: normalizedRevision,
        },
        revisionDiffError: null,
      };
    });
    return prepared;
  }

  function prepareRevisionDiffRange(leftRevision: string, rightRevision: string) {
    const left = leftRevision.trim();
    const right = rightRevision.trim();
    if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
      update((state) => ({
        ...state,
        revisionDiffError: "请选择两个有效的数字 revision",
      }));
      return false;
    }
    if (left === right) {
      update((state) => ({
        ...state,
        revisionDiffError: "请选择两个不同的 revision",
      }));
      return false;
    }
    update((state) => ({
      ...state,
      revisionDiffForm: {
        ...state.revisionDiffForm,
        mode: "revisions",
        targetUrl: "",
        leftRevision: left,
        rightRevision: right,
      },
      revisionDiffError: null,
    }));
    return true;
  }

  function prepareWorkingCopyFileRevisionDiff(filePath: string, revision: string) {
    const normalizedRevision = revision.trim();
    const filePathInvalid =
      !filePath ||
      Array.from(filePath).some((character) => /[\u0000-\u001f\u007f]/.test(character));
    if (filePathInvalid) {
      update((state) => ({
        ...state,
        revisionDiffError: "请先选择一个有效的工作副本文件",
      }));
      return false;
    }
    if (!/^\d+$/.test(normalizedRevision)) {
      update((state) => ({
        ...state,
        revisionDiffError: "请选择有效的数字 revision",
      }));
      return false;
    }
    update((state) => ({
      ...state,
      revisionDiffForm: {
        ...state.revisionDiffForm,
        mode: "working_copy_to_revision",
        filePath,
        targetUrl: "",
        leftRevision: "",
        rightRevision: normalizedRevision,
      },
      revisionDiffError: null,
    }));
    return true;
  }

  function markRevisionDiffTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingRevisionDiffTaskId: taskId,
      revisionDiffLoading: taskId !== null,
      revisionDiffError: null,
    }));
  }

  function applyRevisionDiffResult(result: RevisionDiffResult) {
    update((state) => ({
      ...state,
      pendingRevisionDiffTaskId: null,
      revisionDiffLoading: false,
      revisionDiffError: null,
      revisionDiffResult: result,
    }));
  }

  function failRevisionDiffTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingRevisionDiffTaskId: null,
      revisionDiffLoading: false,
      revisionDiffError: message ?? "Revision diff 失败",
    }));
  }

  async function exportRevisionDiffPatch() {
    const result = get({ subscribe }).revisionDiffResult;
    if (!result) {
      return;
    }

    if (result.truncated) {
      if (result.patch_file_path) {
        try {
          await openGeneratedFileLocation({ path: result.patch_file_path });
        } catch (error) {
          update((state) => ({
            ...state,
            revisionDiffError:
              error instanceof Error ? error.message : "无法打开完整 patch 文件位置",
          }));
        }
      } else {
        update((state) => ({
          ...state,
          revisionDiffError: "Revision diff 预览已截断，但完整 Patch 文件位置不可用",
        }));
      }
      return;
    }

    if (!result.diff_text || typeof window === "undefined") {
      return;
    }

    const blob = new Blob([result.diff_text], {
      type: "text/x-diff;charset=utf-8",
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = revisionDiffPatchFileName(result);
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  function setMergeForm(field: keyof WorkspaceStoreState["mergeForm"], value: string | boolean) {
    const booleanFields: Array<keyof WorkspaceStoreState["mergeForm"]> = [
      "dryRun",
      "recordOnly",
      "ignoreAncestry",
      "force",
    ];
    update((state) => ({
      ...state,
      mergeForm: {
        ...state.mergeForm,
        [field]: booleanFields.includes(field) ? Boolean(value) : String(value),
      },
      mergeError: null,
    }));
  }

  function useRepositoryUrlForMerge(url: string) {
    update((state) => ({
      ...state,
      mergeForm: {
        ...state.mergeForm,
        sourceUrl: url,
      },
      mergeError: null,
    }));
  }

  function markMergeTask(taskId: string | null) {
    update((state) => ({
      ...state,
      pendingMergeTaskId: taskId,
      mergeError: null,
      mergeResult: null,
    }));
  }

  function completeMergeTask(result: MergeResult | null) {
    update((state) => ({
      ...state,
      pendingMergeTaskId: null,
      mergeError: null,
      mergeResult: result,
    }));
  }

  function failMergeTask(message: string | null) {
    update((state) => ({
      ...state,
      pendingMergeTaskId: null,
      mergeError: message ?? "Merge 执行失败",
    }));
  }

  function openApplyPatchDialog(filePath: string, workingCopyRoot: string) {
    update((state) => ({
      ...state,
      applyPatchDialogOpen: true,
      applyPatchFilePath: filePath,
      applyPatchWorkingCopyRoot: workingCopyRoot,
      applyPatchCreating: false,
      pendingApplyPatchTaskId: null,
      applyPatchResult: null,
      applyPatchError: null,
    }));
  }

  function closeApplyPatchDialog() {
    update((state) =>
      state.applyPatchCreating || state.pendingApplyPatchTaskId
        ? state
        : {
            ...state,
            ...emptyApplyPatchState(),
          },
    );
  }

  function beginApplyPatchTask(dryRun: boolean) {
    let started = false;
    update((state) => {
      if (state.applyPatchCreating || state.pendingApplyPatchTaskId) {
        return state;
      }

      started = true;
      return {
        ...state,
        applyPatchCreating: true,
        applyPatchResult: dryRun ? null : state.applyPatchResult,
        applyPatchError: null,
      };
    });
    return started;
  }

  function markApplyPatchTask(taskId: string | null, dryRun: boolean) {
    update((state) => ({
      ...state,
      applyPatchCreating: false,
      pendingApplyPatchTaskId: taskId,
      applyPatchResult: dryRun ? null : state.applyPatchResult,
      applyPatchError: null,
    }));
  }

  function completeApplyPatchTask(result: ApplyPatchResult) {
    update((state) => ({
      ...state,
      applyPatchCreating: false,
      pendingApplyPatchTaskId: null,
      applyPatchResult: result,
      applyPatchError: null,
    }));
  }

  function failApplyPatchTask(message: string | null) {
    update((state) => ({
      ...state,
      applyPatchCreating: false,
      pendingApplyPatchTaskId: null,
      applyPatchError: message ?? "Patch 执行失败",
    }));
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
    toggleAbnormalOnly,
    toggleUnreviewedOnly,
    toggleGeneratedOnly,
    toggleStatusFilter,
    focusConflictFilter,
    focusConflictResolution,
    setGroupMode,
    clearFilters,
    selectFile,
    selectPathOnly,
    selectStartupTargetFile,
    selectCommitFile,
    unselectCommitFile,
    selectCommitFiles,
    unselectCommitFiles,
    selectAllCommitFiles,
    clearCommitFiles,
    markFileReviewed,
    markFileUnreviewed,
    validateCommitFiles,
    validateSelectedHunksForPartialCommit,
    confirmSafetyWarnings,
    markCommitTask,
    failCommitTask,
    markPartialCommitTask,
    completePartialCommit,
    markSvnOperationTask,
    failSvnOperationTask,
    setRepositoryUrlInput,
    setRepositoryRevisionInput,
    useWorkspaceRepositoryRoot,
    markRepositoryListTask,
    applyRepositoryListResult,
    failRepositoryList,
    markRepositoryFileTask,
    completeRepositoryFile,
    failRepositoryFile,
    loadRepositoryFileLog,
    loadMoreRepositoryFileLog,
    clearRepositoryFileLog,
    loadRepositoryFileBlame,
    clearRepositoryFileBlame,
    loadRepositoryFileProperties,
    clearRepositoryFileProperties,
    setRepositoryLayoutPath,
    markRepositoryLayoutTask,
    applyRepositoryLayoutResult,
    failRepositoryLayoutResult,
    setRepositoryCopyForm,
    prepareRepositoryCopyTarget,
    markRepositoryCopyTask,
    completeRepositoryCopyTask,
    failRepositoryCopyTask,
    setRepositoryMkdirForm,
    prepareRepositoryMkdir,
    markRepositoryMkdirTask,
    completeRepositoryMkdirTask,
    failRepositoryMkdirTask,
    setRepositoryImportForm,
    prepareRepositoryImport,
    chooseRepositoryImportSource,
    prepareRepositoryImportFromDrop,
    markRepositoryImportTask,
    completeRepositoryImportTask,
    failRepositoryImportTask,
    setRepositoryMoveForm,
    prepareRepositoryMove,
    setRepositoryRenameForm,
    prepareRepositoryRename,
    markRepositoryMoveTask,
    completeRepositoryMoveTask,
    failRepositoryMoveTask,
    failRepositoryRenameTask,
    setRepositoryDeleteForm,
    prepareRepositoryDelete,
    markRepositoryDeleteTask,
    completeRepositoryDeleteTask,
    failRepositoryDeleteTask,
    setRepositoryCheckoutForm,
    prepareRepositoryCheckout,
    chooseRepositoryCheckoutParent,
    markRepositoryCheckoutTask,
    completeRepositoryCheckoutTask,
    failRepositoryCheckoutTask,
    setRepositoryExportForm,
    prepareRepositoryExport,
    chooseRepositoryExportParent,
    markRepositoryExportTask,
    completeRepositoryExportTask,
    failRepositoryExportTask,
    setSvnSwitchTargetUrl,
    markSvnSwitchTask,
    failSvnSwitchTask,
    exportTaskWorkspaceDraft,
    importTaskWorkspaceDraft,
    clearCommittedFiles,
    clearWorkspaceDraft,
    refreshStatus,
    refreshFileTree,
    loadMoreStatus,
    refreshFileDiff,
    refreshFileContentDiff,
    refreshSvnBlame,
    refreshParsedDiff,
    toggleHunkSelection,
    previewSelectedPatch,
    refreshShadowStatus,
    refreshSvnProperties,
    setPropertyEditForm,
    usePropertyForEdit,
    saveSvnProperty,
    ignorePath,
    refreshSvnLog,
    loadMoreSvnLog,
    setSvnLogFilter,
    setSvnLogFileOnly,
    setSvnLogLimit,
    setRevisionDiffForm,
    prepareRevisionDiffFromLog,
    prepareRevisionDiffRange,
    prepareWorkingCopyFileRevisionDiff,
    markRevisionDiffTask,
    applyRevisionDiffResult,
    failRevisionDiffTask,
    exportRevisionDiffPatch,
    setMergeForm,
    useRepositoryUrlForMerge,
    markMergeTask,
    completeMergeTask,
    failMergeTask,
    openApplyPatchDialog,
    closeApplyPatchDialog,
    beginApplyPatchTask,
    markApplyPatchTask,
    completeApplyPatchTask,
    failApplyPatchTask,
  };
}

export const workspaceStore = createWorkspaceStore();
export const appSettingsStore = createAppSettingsStore();

export function revisionDiffPatchFileName(result: Pick<RevisionDiffResult, "mode" | "target">) {
  const mode = sanitizePatchFileNamePart(String(result.mode || "revision-diff"));
  const target = sanitizePatchFileNamePart(result.target || "target");
  return `novasvn-${mode}-${target}-${Date.now()}.patch`;
}

export function repositoryPathUrl(
  repositoryRoot: string | null | undefined,
  repositoryPath: string,
) {
  const root = repositoryRoot?.trim().replace(/\/+$/, "");
  if (
    !root ||
    !repositoryPath.startsWith("/") ||
    repositoryPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(repositoryPath)
  ) {
    return null;
  }
  const segments = repositoryPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments.length > 0
    ? `${root}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
    : root;
}

export function isSameRepositoryUrl(left: string | null | undefined, right: string | null | undefined) {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").trim().replace(/\/+$/, "");

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft !== "" && normalizedLeft === normalizedRight;
}

function sanitizePatchFileNamePart(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return (normalized || "diff").slice(0, 80);
}

function emptyRepositoryLayoutTasks() {
  return {
    trunk: null,
    branches: null,
    tags: null,
  };
}

function appSettingsKey() {
  return "novasvn:app-settings";
}

function loadAppSettings(): AppSettingsState {
  if (typeof window === "undefined") {
    return initialAppSettings;
  }

  try {
    const raw = window.localStorage.getItem(appSettingsKey());
    if (!raw) {
      const commitSettings = loadCommitMessageSettings();
      return {
        ...initialAppSettings,
        commitTemplate: commitSettings.template,
      };
    }

    const parsed = JSON.parse(raw) as Partial<AppSettingsState>;
    return {
      ...initialAppSettings,
      svnExecutable: typeof parsed.svnExecutable === "string" ? parsed.svnExecutable : "",
      svnAuthenticationMode:
        parsed.svnAuthenticationMode === "password" || parsed.svnAuthenticationMode === "ssh"
          ? parsed.svnAuthenticationMode
          : "system",
      svnUsername: typeof parsed.svnUsername === "string" ? parsed.svnUsername : "",
      svnRememberPassword:
        typeof parsed.svnRememberPassword === "boolean" ? parsed.svnRememberPassword : true,
      diffMode:
        parsed.diffMode === "inline" || parsed.diffMode === "side_by_side"
          ? parsed.diffMode
          : "side_by_side",
      showWhitespace:
        typeof parsed.showWhitespace === "boolean" ? parsed.showWhitespace : false,
      themeMode:
        parsed.themeMode === "light" || parsed.themeMode === "dark"
          ? parsed.themeMode
          : "system",
      showSourceList:
        typeof parsed.showSourceList === "boolean" ? parsed.showSourceList : true,
      showInspector:
        typeof parsed.showInspector === "boolean" ? parsed.showInspector : true,
      commitTemplate:
        typeof parsed.commitTemplate === "string" ? parsed.commitTemplate : "",
      branchPoolBasePath:
        typeof parsed.branchPoolBasePath === "string" ? parsed.branchPoolBasePath : "",
      largeFileThresholdMb:
        typeof parsed.largeFileThresholdMb === "number"
          ? normalizeLargeFileThreshold(parsed.largeFileThresholdMb)
          : 20,
      externalDiffTool:
        typeof parsed.externalDiffTool === "string" ? parsed.externalDiffTool : "",
      externalMergeTool:
        typeof parsed.externalMergeTool === "string" ? parsed.externalMergeTool : "",
      diagnosticExportPath: "",
      diagnosticExportError: null,
      validationErrors: {
        svnExecutable: validateExecutableSetting(parsed.svnExecutable, "SVN 路径"),
        svnUsername: validateSvnUsername(parsed.svnUsername),
        branchPoolBasePath: validateOptionalAbsoluteOrHomePath(
          parsed.branchPoolBasePath,
          "工作副本池路径",
        ),
        externalDiffTool: validateExecutableSetting(parsed.externalDiffTool, "外部 Diff 工具"),
        externalMergeTool: validateExecutableSetting(parsed.externalMergeTool, "外部 Merge 工具"),
      },
    };
  } catch {
    return initialAppSettings;
  }
}

function emptyAppSettingsValidationErrors() {
  return {
    svnExecutable: null,
    svnUsername: null,
    branchPoolBasePath: null,
    externalDiffTool: null,
    externalMergeTool: null,
  };
}

function normalizeAppSettingValue<K extends keyof AppSettingsState>(
  field: K,
  value: AppSettingsState[K],
): AppSettingsState[K] {
  if (field === "largeFileThresholdMb") {
    return normalizeLargeFileThreshold(value) as AppSettingsState[K];
  }

  return value;
}

function normalizeLargeFileThreshold(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return initialAppSettings.largeFileThresholdMb;
  }

  return Math.min(Math.max(Math.round(value), 1), 2048);
}

function validateAppSettingsField<K extends keyof AppSettingsState>(
  current: AppSettingsState["validationErrors"],
  field: K,
  value: AppSettingsState[K],
) {
  if (
    field !== "svnExecutable" &&
    field !== "svnUsername" &&
    field !== "branchPoolBasePath" &&
    field !== "externalDiffTool" &&
    field !== "externalMergeTool"
  ) {
    return current;
  }

  const settingField = field as keyof AppSettingsState["validationErrors"];
  const labels: Record<keyof AppSettingsState["validationErrors"], string> = {
    svnExecutable: "SVN 路径",
    svnUsername: "SVN 用户名",
    branchPoolBasePath: "工作副本池路径",
    externalDiffTool: "外部 Diff 工具",
    externalMergeTool: "外部 Merge 工具",
  };

  if (field === "branchPoolBasePath") {
    return {
      ...current,
      branchPoolBasePath: validateOptionalAbsoluteOrHomePath(value, labels.branchPoolBasePath),
    };
  }

  if (field === "svnUsername") {
    return {
      ...current,
      svnUsername: validateSvnUsername(value),
    };
  }

  return {
    ...current,
    [settingField]: validateExecutableSetting(value, labels[settingField]),
  };
}

function validateSvnUsername(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const trimmed = value.trim();
  if (hasControlCharacter(trimmed)) {
    return "SVN 用户名不能包含控制字符";
  }
  if (new TextEncoder().encode(trimmed).length > 256) {
    return "SVN 用户名不能超过 256 字节";
  }
  return null;
}

function validateOptionalAbsoluteOrHomePath(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return validateAbsoluteOrHomePath(value, label);
}

function validateExecutableSetting(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const trimmed = value.trim();
  if (hasControlCharacter(trimmed)) {
    return `${label}不能包含控制字符`;
  }
  if (isSimpleCommandName(trimmed) || isAbsoluteOrHomePath(trimmed)) {
    return null;
  }

  return `${label}需要是命令名、绝对路径或 ~/ 开头路径`;
}

function validateAbsoluteOrHomePath(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return `${label}不能为空`;
  }
  if (hasControlCharacter(trimmed)) {
    return `${label}不能包含控制字符`;
  }
  if (!isAbsoluteOrHomePath(trimmed)) {
    return `${label}需要是绝对路径或 ~/ 开头路径`;
  }
  return null;
}

function suggestBranchPoolLocalPath(branchUrl: string, basePath: string) {
  return suggestCheckoutLocalPath(branchUrl, basePath);
}

function suggestCheckoutLocalPath(repositoryUrl: string, basePath: string) {
  const base = basePath.trim();
  const localPathError = validateOptionalAbsoluteOrHomePath(base, "工作副本池路径");
  if (!repositoryUrl.trim() || !base || localPathError) {
    return "";
  }

  const pathSegments = repositoryUrl
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const branchName = pathSegments.at(-1) ?? "checkout";
  const parentName = pathSegments.at(-2);
  const rawDirectoryName =
    parentName && !["branches", "tags", "trunk"].includes(parentName.toLowerCase())
      ? `${parentName}-${branchName}`
      : branchName;
  const safeName = rawDirectoryName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const directoryName = safeName || "checkout";
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${directoryName}`;
}

function hasControlCharacter(value: string) {
  return /[\u0000-\u001f]/.test(value);
}

function isSimpleCommandName(value: string) {
  return /^[A-Za-z0-9._-]+(?:\.exe)?$/.test(value);
}

function isAbsoluteOrHomePath(value: string) {
  return (
    /^~[\\/]/.test(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\[^\\/]+[\\/][^\\/]+/.test(value) ||
    value.startsWith("/")
  );
}

function saveAppSettings(settings: AppSettingsState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(appSettingsKey(), JSON.stringify(settings));
  } catch {
    // 设置保存失败不应阻断当前操作。
  }
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

function emptyRepositoryMkdirForm() {
  return {
    targetUrl: "",
    message: "",
  };
}

function emptyRepositoryImportForm() {
  return {
    sourcePath: "",
    targetUrl: "",
    message: "",
  };
}

function emptyRepositoryMoveForm() {
  return {
    sourceUrl: "",
    targetUrl: "",
    message: "",
  };
}

function emptyRepositoryRenameForm() {
  return {
    sourceUrl: "",
    targetUrl: "",
    message: "",
  };
}

function emptyRepositoryDeleteForm() {
  return {
    url: "",
    message: "",
  };
}

function emptyRepositoryCheckoutForm() {
  return {
    url: "",
    localPath: "",
    revision: "",
  };
}

function emptyRepositoryExportForm() {
  return {
    url: "",
    localPath: "",
    revision: "",
  };
}

function emptyPropertyEditForm() {
  return {
    name: "",
    value: "",
  };
}

function emptyApplyPatchState() {
  return {
    applyPatchDialogOpen: false,
    applyPatchFilePath: "",
    applyPatchWorkingCopyRoot: "",
    applyPatchCreating: false,
    pendingApplyPatchTaskId: null,
    applyPatchResult: null,
    applyPatchError: null,
  };
}

function clearSvnBlameState() {
  return {
    svnBlame: null,
    svnBlameLoading: false,
    svnBlameError: null,
  };
}

function clearSvnPropertiesState() {
  return {
    svnProperties: null,
    svnPropertiesLoading: false,
    svnPropertiesError: null,
    propertyEditForm: emptyPropertyEditForm(),
  };
}

function normalizeRevisionDiffMode(value: string): RevisionDiffMode {
  if (value === "working_copy_to_revision" || value === "urls") {
    return value;
  }

  return "revisions";
}

function taskWorkspaceDraftKey(branchPoolEntryId: string, name: string) {
  const normalizedName = name.trim().replace(/\s+/g, "-").toLowerCase();
  return `novasvn:task-workspace-draft:${branchPoolEntryId}:${normalizedName}:${Date.now()}`;
}

function branchNameFromUrl(url: string) {
  return url.replace(/\/+$/, "").split("/").pop() || "新任务";
}

function buildTaskWorkspaceDraftSnapshot(state: WorkspaceStoreState) {
  return {
    selectedHunks: state.selectedHunks,
    reviewedFiles: state.reviewedFiles,
    confirmedWarningIds: state.safetyCheck.confirmedWarningIds,
    commitMessage: state.commitMessage,
    updatedAt: Date.now(),
  };
}

function saveTaskWorkspaceDraft(key: string, draft: TaskWorkspaceDraftSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // 任务草稿保存失败不影响 SVN 工作副本本身。
  }
}

function loadTaskWorkspaceDraft(key: string): Partial<WorkspaceDraft> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<WorkspaceDraft>) : {};
  } catch {
    return {};
  }
}

function removeTaskWorkspaceDraft(key: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // 删除任务草稿失败不应阻断任务工作区删除。
  }
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

function resolveStartupTargetFilePath(
  targetPath: string,
  workspace: WorkspaceSummary,
  files: ChangedFile[],
) {
  const windowsSeparators = isWindowsAbsoluteSystemPath(workspace.working_copy_root);
  const normalizedTarget = normalizeSystemPath(targetPath, windowsSeparators);
  const normalizedRoot = normalizeSystemPath(workspace.working_copy_root, windowsSeparators);
  if (!normalizedTarget || !normalizedRoot || normalizedTarget === normalizedRoot) {
    return null;
  }

  const rootPrefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  if (!normalizedTarget.startsWith(rootPrefix)) {
    return null;
  }

  const relativePath = normalizedTarget.slice(rootPrefix.length);
  return files.find((file) => normalizeWorkspacePath(file.path) === relativePath)?.path ?? relativePath;
}

function normalizeSystemPath(path: string, windowsSeparators: boolean) {
  const normalized = windowsSeparators ? path.replace(/\\/g, "/") : path;
  return normalized.replace(/\/+/g, "/").replace(/\/$/, "");
}

function isWindowsAbsoluteSystemPath(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}

function isCommittable(file: ChangedFile) {
  return ![
    "normal",
    "missing",
    "conflicted",
    "obstructed",
    "unversioned",
    "external",
  ].includes(file.status);
}

function buildCommitFileSelection(files: ChangedFile[]) {
  return files.filter(isCommittable).map((file) => ({
    path: file.path,
    status: file.status,
    contentDigest: file.content_digest,
  }));
}

function reconcileCommitFiles(
  commitFiles: Array<{ path: string; status: string; contentDigest: string }>,
  currentFiles: ChangedFile[],
) {
  return commitFiles.flatMap((commitFile) => {
    const current = currentFiles.find((file) => file.path === commitFile.path);
    if (!current || current.status !== commitFile.status || !isCommittable(current)) {
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

function selectedHunkFilesForSafety(
  selectedHunks: Array<{ filePath: string; fileDigest: string; hunkId: string }>,
  currentFiles: ChangedFile[],
) {
  const paths = new Set(selectedHunks.map((item) => item.filePath));
  return currentFiles.flatMap((file) => {
    if (!paths.has(file.path)) {
      return [];
    }

    const hasCurrentHunk = selectedHunks.some(
      (item) => item.filePath === file.path && item.fileDigest === file.content_digest,
    );

    if (!hasCurrentHunk || !isCommittable(file)) {
      return [];
    }

    return [
      {
        path: file.path,
        status: file.status,
        contentDigest: file.content_digest,
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
  commitFiles: Array<{ path: string; status: string; contentDigest: string }>,
  confirmedWarningIds: string[] = [],
  status: WorkingCopyStatus | null = null,
): SafetyCheckSummary {
  const commitPaths = new Set(commitFiles.map((file) => file.path));
  const settings = loadAppSettings();
  const largeFileThresholdBytes = settings.largeFileThresholdMb * 1024 * 1024;
  const blockers: SafetyCheckItem[] = [];
  const warnings: SafetyCheckItem[] = [];
  const infos: SafetyCheckItem[] = [];

  for (const file of files) {
    if (!commitPaths.has(file.path)) {
      continue;
    }

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

    if (file.file_size !== null && file.file_size >= largeFileThresholdBytes) {
      warnings.push({
        id: `warning:large-file:${file.path}:${file.content_digest}`,
        severity: "warning",
        title: "大文件变更",
        detail: `${file.path} 大小为 ${formatFileSize(file.file_size)}，超过当前 ${
          settings.largeFileThresholdMb
        }MB 阈值。`,
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

    if (file.status === "external") {
      infos.push({
        id: `info:external:${file.path}:${file.content_digest}`,
        severity: "info",
        title: "SVN externals",
        detail: `${file.path} 来自 svn:externals，提交、更新和清理时请确认它的独立工作副本状态。`,
        filePath: file.path,
      });
    }
  }

  if (commitFiles.some((file) => !files.some((current) => current.path === file.path))) {
    blockers.push({
      id: "blocker:commit-target-missing",
      severity: "blocker",
      title: "提交目标已失效",
      detail: "部分已选文件不在当前状态扫描结果中，请刷新后重新选择提交目标。",
      filePath: null,
    });
  }

  if (status?.mixed_revision) {
    warnings.push({
      id: `warning:mixed-revision:${status.revision_range ?? "unknown"}`,
      severity: "warning",
      title: "Mixed revision 工作副本",
      detail: `当前工作副本 revision 范围为 ${
        status.revision_range ?? "未知"
      }，部分提交或合并前请确认是否需要先 update。`,
      filePath: null,
    });
  } else if (status?.revision_range) {
    infos.push({
      id: `info:single-revision:${status.revision_range}`,
      severity: "info",
      title: "工作副本 revision 一致",
      detail: `当前工作副本 revision 为 ${status.revision_range}。`,
      filePath: null,
    });
  }

  if (status && status.files.length < status.total) {
    infos.push({
      id: `info:status-partial:${status.files.length}:${status.total}`,
      severity: "info",
      title: "状态列表尚未全部加载",
      detail: `当前已检查 ${status.files.length}/${status.total} 个改动文件，提交前建议加载更多改动以覆盖完整安全检查。`,
      filePath: null,
    });
  }

  const warningIds = new Set(warnings.map((item) => item.id));
  const commitDigestIds = new Set(
    commitFiles.map((file) => `${file.path}:${file.contentDigest}`),
  );

  return {
    blockers,
    warnings,
    infos,
    confirmedWarningIds: confirmedWarningIds.filter((id) => {
      if (warningIds.has(id)) {
        return true;
      }

      return commitDigestIds.has(id);
    }),
  };
}

function normalizeWorkspacePath(path: string) {
  return path.replace(/^\/+/, "");
}

function reconcileSafetyWarningConfirmations(
  safetyCheck: SafetyCheckSummary,
  commitFiles: Array<{ path: string; status: string; contentDigest: string }>,
) {
  const commitPaths = new Set(commitFiles.map((file) => file.path));
  return {
    ...safetyCheck,
    confirmedWarningIds: safetyCheck.confirmedWarningIds.filter((id) => {
      const item = safetyCheck.warnings.find((warning) => warning.id === id);
      return !item?.filePath || commitPaths.has(item.filePath);
    }),
  };
}

function unconfirmedWarnings(safetyCheck: SafetyCheckSummary) {
  const confirmed = new Set(safetyCheck.confirmedWarningIds);
  return safetyCheck.warnings.filter((item) => !confirmed.has(item.id));
}

function mergeSvnLogPage(current: SvnLog, next: SvnLog): SvnLog {
  const revisions = new Set(current.entries.map((entry) => entry.revision));
  const appendedEntries = next.entries.filter((entry) => {
    if (revisions.has(entry.revision)) {
      return false;
    }
    revisions.add(entry.revision);
    return true;
  });

  return {
    ...next,
    target: current.target,
    entries: [...current.entries, ...appendedEntries],
  };
}

function labelSafetyStatus(status: string) {
  const labels: Record<string, string> = {
    conflicted: "冲突文件",
    missing: "缺失文件",
    obstructed: "阻塞文件",
    external: "SVN externals",
  };

  return labels[status] ?? status;
}

function looksLikeGeneratedOrTemporary(path: string) {
  const normalized = path.toLowerCase();
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? normalized;

  return (
    segments.some((segment) =>
      [
        "dist",
        "build",
        "target",
        "node_modules",
        ".cache",
        "coverage",
        "library",
        "temp",
        "logs",
        "obj",
      ].includes(segment),
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
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
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

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${bytes}B`;
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
    selectedHunks: [],
    reviewedFiles: [],
    confirmedWarningIds: [],
    commitMessage: "",
    updatedAt: 0,
  };
}

function normalizeWorkspaceDraftInput(
  draft: Partial<WorkspaceDraft>,
  fallbackCommitMessage: string,
): WorkspaceDraft {
  return {
    version: 1,
    selectedHunks: Array.isArray(draft.selectedHunks)
      ? draft.selectedHunks.filter(isSelectedHunkDraft)
      : [],
    reviewedFiles: Array.isArray(draft.reviewedFiles)
      ? draft.reviewedFiles.filter(isReviewedFileState)
      : [],
    confirmedWarningIds: Array.isArray(draft.confirmedWarningIds)
      ? draft.confirmedWarningIds.filter((item): item is string => typeof item === "string")
      : [],
    commitMessage:
      typeof draft.commitMessage === "string" ? draft.commitMessage : fallbackCommitMessage,
    updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : 0,
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
