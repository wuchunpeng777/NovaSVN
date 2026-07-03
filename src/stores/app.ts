import { get, writable } from "svelte/store";
import {
  cancelTask,
  chooseWorkspaceDirectory,
  createBranchCheckoutTask,
  createCommitTask,
  createMergeTask,
  createMockTask,
  createPartialCommitTask,
  createRepositoryCopyTask,
  createRepositoryListTask,
  createRevisionDiffTask,
  createShadowWorkspaceTask,
  createSvnOperationTask,
  createSvnSwitchTask,
  detectSvn,
  exportDiagnostics,
  getFileContentDiff,
  getFileDiff,
  getBranchPool,
  getSvnLog,
  getSvnProperties,
  getTaskWorkspaces,
  generateSelectedPatch,
  getShadowWorkspaceStatus,
  getRecentWorkspace,
  getTask,
  listTasks,
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
  WorkspaceStageFilter,
} from "../types/app";
import type {
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
  RepositoryCopyKind,
  RevisionDiffMode,
  RevisionDiffResult,
  SelectedPatch,
  ShadowWorkspaceOperationKind,
  ShadowWorkspaceStatus,
  SvnOperationKind,
  SvnDetection,
  SvnLog,
  SvnProperties,
  Task,
  TaskSnapshot,
  TaskWorkspaceEntry,
  TaskWorkspaceList,
  WorkingCopyStatus,
  WorkspaceSummary,
} from "../types/api";

export const currentView = writable<AppView>("changes");

export function setCurrentView(view: AppView) {
  currentView.set(view);
}

const initialAppSettings: AppSettingsState = {
  svnExecutable: "",
  diffMode: "side_by_side",
  showWhitespace: false,
  commitTemplate: "",
  branchPoolBasePath: "",
  largeFileThresholdMb: 20,
  unityRulesEnabled: true,
  unityGroupRules: {
    addressables: true,
    projectSettings: true,
    packages: true,
    scenes: true,
    prefabs: true,
    assets: true,
  },
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
    createBranchCheckout,
    createSvnSwitch,
    createRevisionDiff,
    createMerge,
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
  searchText: string;
  groupByStatus: boolean;
  stageFilter: WorkspaceStageFilter;
  abnormalOnly: boolean;
  unreviewedOnly: boolean;
  generatedOnly: boolean;
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
  };
  pendingMergeTaskId: string | null;
  mergeError: string | null;
  mergeResult: MergeResult | null;
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
  searchText: "",
  groupByStatus: true,
  stageFilter: "all",
  abnormalOnly: false,
  unreviewedOnly: false,
  generatedOnly: false,
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
  },
  pendingMergeTaskId: null,
  mergeError: null,
  mergeResult: null,
  svnProperties: null,
  svnPropertiesLoading: false,
  svnPropertiesError: null,
  propertyEditForm: {
    name: "",
    value: "",
  },
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
        svnSwitchTargetUrl: recent.workspace?.repository_url ?? "",
        pendingSvnSwitchTaskId: null,
        svnSwitchError: null,
        repositoryLoading: false,
        repositoryError: null,
        shadowStatus: null,
        shadowError: null,
        pathInput: state.pathInput || root || "",
        loading: false,
        error: null,
      }));
      if (root) {
        if (recent.workspace) {
          enableUnityRulesForWorkspace(recent.workspace);
        }
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

  async function openPath(svnExecutable?: string | null): Promise<WorkspaceSummary | null> {
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
        svnSwitchTargetUrl: current.repository_url,
        pendingSvnSwitchTaskId: null,
        svnSwitchError: null,
        repositoryLoading: false,
        repositoryError: null,
        shadowStatus: null,
        shadowError: null,
        pathInput: current.working_copy_root,
        loading: false,
        error: null,
      }));
      enableUnityRulesForWorkspace(current);
      await refreshStatus(svnExecutable, current.working_copy_root);
      return current;
    } catch (error) {
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
      stageFilter: "all",
      abnormalOnly: false,
      unreviewedOnly: false,
      generatedOnly: false,
      statusFilters: ["conflicted"],
      groupMode: "status",
      groupByStatus: true,
    }));
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
      generatedOnly: false,
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
        state.status,
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
        state.status,
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
        state.status,
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

    await selectFile(relativePath, svnExecutable);
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
      const reconciled = reconcileStagedFiles(state.stagedFiles, state.status?.files ?? []);
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
      const stagedFiles =
        currentFiles.length > 0
          ? reconcileStagedFiles(draftState.stagedFiles, currentFiles)
          : draftState.stagedFiles;
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
        stagedFiles,
        selectedHunks,
        reviewedFiles,
        safetyCheck: buildSafetyCheck(
          currentFiles,
          stagedFiles,
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
      const stagedFiles = state.stagedFiles.filter((file) => !committed.has(file.path));
      const commitHistory = recordCommitHistory(
        state.commitMessage,
        state.commitHistory,
        state.commitTemplate,
      );
      const nextState = {
        ...state,
        stagedFiles,
        safetyCheck: buildSafetyCheck(state.status?.files ?? [], stagedFiles, [], state.status),
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
      const selectedFilePath = applyStatusResult(status, previousSelectedFilePath);
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

  async function loadMoreStatus(svnExecutable?: string | null) {
    const state = get({ subscribe });
    const root = state.current?.working_copy_root;
    const currentStatus = state.status;
    if (!root || !currentStatus || currentStatus.files.length >= currentStatus.total) {
      return;
    }

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
      applyStatusResult(mergedStatus, state.selectedFilePath);
    } catch (error) {
      update((current) => ({
        ...current,
        statusLoading: false,
        statusError: error as CommandError,
      }));
    }
  }

  function applyStatusResult(
    status: WorkingCopyStatus,
    previousSelectedFilePath: string | null,
  ) {
    const selectedFilePath = resolveSelectedFilePath(status.files, previousSelectedFilePath);
    update((state) => {
      const stagedFiles = reconcileStagedFiles(state.stagedFiles, status.files);
      const reviewedFiles = reconcileReviewedFiles(state.reviewedFiles, status.files);
      const selectedHunks = reconcileSelectedHunks(state.selectedHunks, status.files);
      const safetyCheck = buildSafetyCheck(
        status.files,
        stagedFiles,
        state.safetyCheck.confirmedWarningIds,
        status,
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
    return selectedFilePath;
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

  function prepareRevisionDiffFromLog(revision: string) {
    const numericRevision = Number(revision);
    update((state) => ({
      ...state,
      revisionDiffForm: {
        ...state.revisionDiffForm,
        mode: "revisions",
        leftRevision:
          Number.isFinite(numericRevision) && numericRevision > 1
            ? String(numericRevision - 1)
            : state.revisionDiffForm.leftRevision,
        rightRevision: revision,
      },
      revisionDiffError: null,
    }));
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

  function exportRevisionDiffPatch() {
    const result = get({ subscribe }).revisionDiffResult;
    if (!result || result.truncated || typeof window === "undefined") {
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
    update((state) => ({
      ...state,
      mergeForm: {
        ...state.mergeForm,
        [field]: field === "dryRun" ? Boolean(value) : String(value),
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
    toggleGeneratedOnly,
    toggleStatusFilter,
    focusConflictFilter,
    setGroupMode,
    clearFilters,
    selectFile,
    selectStartupTargetFile,
    stageFile,
    unstageFile,
    markFileReviewed,
    markFileUnreviewed,
    validateStagedFilesForCommit,
    validateSelectedHunksForPartialCommit,
    confirmSafetyWarnings,
    markCommitTask,
    markPartialCommitTask,
    completePartialCommit,
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
    setSvnSwitchTargetUrl,
    markSvnSwitchTask,
    failSvnSwitchTask,
    exportTaskWorkspaceDraft,
    importTaskWorkspaceDraft,
    clearCommittedFiles,
    clearWorkspaceDraft,
    refreshStatus,
    loadMoreStatus,
    refreshFileDiff,
    refreshFileContentDiff,
    refreshParsedDiff,
    toggleHunkSelection,
    previewSelectedPatch,
    refreshShadowStatus,
    refreshSvnProperties,
    setPropertyEditForm,
    usePropertyForEdit,
    saveSvnProperty,
    refreshSvnLog,
    loadMoreSvnLog,
    setSvnLogFilter,
    setSvnLogFileOnly,
    setSvnLogLimit,
    setRevisionDiffForm,
    prepareRevisionDiffFromLog,
    markRevisionDiffTask,
    applyRevisionDiffResult,
    failRevisionDiffTask,
    exportRevisionDiffPatch,
    setMergeForm,
    useRepositoryUrlForMerge,
    markMergeTask,
    completeMergeTask,
    failMergeTask,
  };
}

export const workspaceStore = createWorkspaceStore();
export const appSettingsStore = createAppSettingsStore();

export function revisionDiffPatchFileName(result: Pick<RevisionDiffResult, "mode" | "target">) {
  const mode = sanitizePatchFileNamePart(String(result.mode || "revision-diff"));
  const target = sanitizePatchFileNamePart(result.target || "target");
  return `novasvn-${mode}-${target}-${Date.now()}.patch`;
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
      diffMode:
        parsed.diffMode === "inline" || parsed.diffMode === "side_by_side"
          ? parsed.diffMode
          : "side_by_side",
      showWhitespace:
        typeof parsed.showWhitespace === "boolean" ? parsed.showWhitespace : false,
      commitTemplate:
        typeof parsed.commitTemplate === "string" ? parsed.commitTemplate : "",
      branchPoolBasePath:
        typeof parsed.branchPoolBasePath === "string" ? parsed.branchPoolBasePath : "",
      largeFileThresholdMb:
        typeof parsed.largeFileThresholdMb === "number"
          ? normalizeLargeFileThreshold(parsed.largeFileThresholdMb)
          : 20,
      unityRulesEnabled:
        typeof parsed.unityRulesEnabled === "boolean" ? parsed.unityRulesEnabled : true,
      unityGroupRules: normalizeUnityGroupRules(parsed.unityGroupRules),
      externalDiffTool:
        typeof parsed.externalDiffTool === "string" ? parsed.externalDiffTool : "",
      externalMergeTool:
        typeof parsed.externalMergeTool === "string" ? parsed.externalMergeTool : "",
      diagnosticExportPath: "",
      diagnosticExportError: null,
      validationErrors: {
        svnExecutable: validateExecutableSetting(parsed.svnExecutable, "SVN 路径"),
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

function normalizeUnityGroupRules(value: unknown) {
  const defaults = initialAppSettings.unityGroupRules;
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const parsed = value as Partial<AppSettingsState["unityGroupRules"]>;
  return {
    addressables:
      typeof parsed.addressables === "boolean" ? parsed.addressables : defaults.addressables,
    projectSettings:
      typeof parsed.projectSettings === "boolean"
        ? parsed.projectSettings
        : defaults.projectSettings,
    packages: typeof parsed.packages === "boolean" ? parsed.packages : defaults.packages,
    scenes: typeof parsed.scenes === "boolean" ? parsed.scenes : defaults.scenes,
    prefabs: typeof parsed.prefabs === "boolean" ? parsed.prefabs : defaults.prefabs,
    assets: typeof parsed.assets === "boolean" ? parsed.assets : defaults.assets,
  };
}

function validateAppSettingsField<K extends keyof AppSettingsState>(
  current: AppSettingsState["validationErrors"],
  field: K,
  value: AppSettingsState[K],
) {
  if (
    field !== "svnExecutable" &&
    field !== "branchPoolBasePath" &&
    field !== "externalDiffTool" &&
    field !== "externalMergeTool"
  ) {
    return current;
  }

  const settingField = field as keyof AppSettingsState["validationErrors"];
  const labels: Record<keyof AppSettingsState["validationErrors"], string> = {
    svnExecutable: "SVN 路径",
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

  return {
    ...current,
    [settingField]: validateExecutableSetting(value, labels[settingField]),
  };
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
  const base = basePath.trim();
  const localPathError = validateOptionalAbsoluteOrHomePath(base, "工作副本池路径");
  if (!branchUrl.trim() || !base || localPathError) {
    return "";
  }

  const pathSegments = branchUrl
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const branchName = pathSegments.at(-1) ?? "branch";
  const parentName = pathSegments.at(-2);
  const rawDirectoryName =
    parentName && !["branches", "tags", "trunk"].includes(parentName.toLowerCase())
      ? `${parentName}-${branchName}`
      : branchName;
  const safeName = rawDirectoryName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const directoryName = safeName || "branch";
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

function enableUnityRulesForWorkspace(workspace: WorkspaceSummary) {
  if (!workspace.unity.detected) {
    return;
  }

  const settings = loadAppSettings();
  if (settings.unityRulesEnabled) {
    return;
  }

  const next = {
    ...settings,
    unityRulesEnabled: true,
  };
  saveAppSettings(next);
  appSettingsStore.setField("unityRulesEnabled", true);
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
    stagedFiles: state.stagedFiles,
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
  const normalizedTarget = normalizeSystemPath(targetPath);
  const normalizedRoot = normalizeSystemPath(workspace.working_copy_root);
  if (!normalizedTarget || !normalizedRoot || normalizedTarget === normalizedRoot) {
    return null;
  }

  const rootPrefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  if (!normalizedTarget.startsWith(rootPrefix)) {
    return null;
  }

  const relativePath = normalizedTarget.slice(rootPrefix.length);
  return files.find((file) => normalizeWorkspacePath(file.path) === relativePath)?.path ?? null;
}

function normalizeSystemPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
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

    if (!hasCurrentHunk || !isStageable(file)) {
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
  stagedFiles: Array<{ path: string; status: string; contentDigest: string }>,
  confirmedWarningIds: string[] = [],
  status: WorkingCopyStatus | null = null,
): SafetyCheckSummary {
  const stagedPaths = new Set(stagedFiles.map((file) => file.path));
  const settings = loadAppSettings();
  const largeFileThresholdBytes = settings.largeFileThresholdMb * 1024 * 1024;
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
        title: looksLikeUnityLargeAsset(file.path) ? "Unity 大资源文件" : "疑似大型二进制文件",
        detail: `${file.path} 是常见二进制或 Unity 资源类型，提交前请确认体积和必要性。`,
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

  appendUnityMetaWarnings(files, warnings);

  if (stagedFiles.some((file) => !files.some((current) => current.path === file.path))) {
    blockers.push({
      id: "blocker:staged-missing",
      severity: "blocker",
      title: "暂存项已失效",
      detail: "部分已暂存文件不在当前状态扫描结果中，请刷新状态后重新暂存。",
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

function appendUnityMetaWarnings(files: ChangedFile[], warnings: SafetyCheckItem[]) {
  if (!loadAppSettings().unityRulesEnabled) {
    return;
  }

  const unityFiles = files.filter((file) => isUnityProjectPath(file.path));
  if (unityFiles.length === 0) {
    return;
  }

  const byPath = new Map(unityFiles.map((file) => [normalizeWorkspacePath(file.path), file]));
  for (const file of unityFiles) {
    const normalized = normalizeWorkspacePath(file.path);
    if (isIgnoredUnityMetaPath(normalized)) {
      continue;
    }

    if (normalized.endsWith(".meta")) {
      const assetPath = normalized.slice(0, -5);
      const asset = byPath.get(assetPath);
      if (!asset || asset.status === "missing" || asset.status === "deleted") {
        warnings.push({
          id: `warning:unity-meta-orphan:${normalized}:${file.content_digest}`,
          severity: "warning",
          title: "Unity meta 缺少资源",
          detail: `${file.path} 对应资源未出现在当前改动中，请确认资源和 .meta 是否同步。`,
          filePath: file.path,
        });
      }
      continue;
    }

    const meta = byPath.get(`${normalized}.meta`);
    if (!meta) {
      warnings.push({
        id: `warning:unity-meta-missing:${normalized}:${file.content_digest}`,
        severity: "warning",
        title: "Unity 资源缺少 meta",
        detail: `${file.path} 没有匹配的 .meta 改动，请确认 .meta 已加入版本控制。`,
        filePath: file.path,
      });
      continue;
    }

    if (["added", "unversioned"].includes(file.status) && !["added", "unversioned"].includes(meta.status)) {
      warnings.push({
        id: `warning:unity-meta-add:${normalized}:${file.content_digest}`,
        severity: "warning",
        title: "Unity 新增资源 meta 未同步新增",
        detail: `${file.path} 是新增资源，但对应 .meta 状态为 ${meta.status}。`,
        filePath: file.path,
      });
    }

    if (["deleted", "missing"].includes(file.status) && !["deleted", "missing"].includes(meta.status)) {
      warnings.push({
        id: `warning:unity-meta-delete:${normalized}:${file.content_digest}`,
        severity: "warning",
        title: "Unity 删除资源 meta 未同步删除",
        detail: `${file.path} 是删除资源，但对应 .meta 状态为 ${meta.status}。`,
        filePath: file.path,
      });
    }
  }
}

function isUnityProjectPath(path: string) {
  const normalized = normalizeWorkspacePath(path);
  return (
    normalized.startsWith("Assets/") ||
    normalized === "Assets" ||
    normalized.startsWith("ProjectSettings/") ||
    normalized.startsWith("Packages/")
  );
}

function isIgnoredUnityMetaPath(path: string) {
  return path === "Assets" || path === "ProjectSettings" || path === "Packages";
}

function normalizeWorkspacePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
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
  const normalized = path.replaceAll("\\", "/").toLowerCase();
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
  ].includes(extension) || looksLikeUnityLargeAsset(path);
}

function looksLikeUnityLargeAsset(path: string) {
  const extension = path.replaceAll("\\", "/").split(".").pop()?.toLowerCase() ?? "";
  return [
    "anim",
    "asset",
    "blend",
    "controller",
    "fbx",
    "mat",
    "prefab",
    "scene",
    "shadergraph",
    "unity",
    "wav",
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

function normalizeWorkspaceDraftInput(
  draft: Partial<WorkspaceDraft>,
  fallbackCommitMessage: string,
): WorkspaceDraft {
  return {
    version: 1,
    stagedFiles: Array.isArray(draft.stagedFiles)
      ? draft.stagedFiles.filter(isStagedFileDraft)
      : [],
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
