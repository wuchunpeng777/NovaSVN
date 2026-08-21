<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { startDrag } from "@crabnebula/tauri-plugin-drag";
  import dragPreviewIcon from "../src-tauri/icons/icon.png?inline";
  import StandaloneBlameWindow from "./components/StandaloneBlameWindow.svelte";
  import StandaloneCheckoutWindow from "./components/StandaloneCheckoutWindow.svelte";
  import StandaloneCleanupWindow from "./components/StandaloneCleanupWindow.svelte";
  import StandaloneCommitWindow from "./components/StandaloneCommitWindow.svelte";
  import StandaloneConflictWindow from "./components/StandaloneConflictWindow.svelte";
  import StandaloneInfoWindow from "./components/StandaloneInfoWindow.svelte";
  import StandaloneLogWindow from "./components/StandaloneLogWindow.svelte";
  import StandaloneMergePreviewWindow from "./components/StandaloneMergePreviewWindow.svelte";
  import StandaloneRepoBrowserWindow from "./components/StandaloneRepoBrowserWindow.svelte";
  import StandaloneRevertWindow from "./components/StandaloneRevertWindow.svelte";
  import StandaloneUpdateWindow from "./components/StandaloneUpdateWindow.svelte";
  import MainWorkspace from "./components/workbench/MainWorkspace.svelte";
  import {
    callBackend,
    chooseExportDirectory,
    choosePatchFile,
    clearSvnCertificateTrust,
    configureSvnAuthentication,
    configureSvnCertificateTrust,
    getStartupIntent,
    launchExternalTool,
    launchRepoBrowserWindow,
    openFileLocation,
    openLocalPathLocation,
    openRepositoryTempFile,
    openWorkspaceFile,
    resolveTextConflict,
    setWorkspaceChangelist,
  } from "./lib/api";
  import { suggestExportLocalPath } from "./lib/svn-log";
  import {
    consumePendingSvnOperationCompletion,
    createSvnOperationCreationCoordinator,
    isSameWorkingCopyRoot,
  } from "./lib/svn-operation-completion";
  import { buildAppMenuState, dispatchAppMenuPathCommand } from "./lib/app-menu";
  import { createPendingTaskCompletionCoordinator } from "./lib/pending-task-completion";
  import { workbenchViews } from "./lib/workbench";
  import {
    appSettingsStore,
    branchPoolStore,
    currentView,
    isSameRepositoryUrl,
    setCurrentView,
    svnStore,
    taskStore,
    taskWorkspaceStore,
    workspaceStore,
  } from "./stores/app";
  import type {
    AppMenuState,
    ChangedFile,
    CommandError,
    ExternalToolKind,
    HealthPayload,
    PendingSvnOperationKind,
    RepositoryExportResult,
    StartupIntent,
    SvnAuthenticationStatus,
    SvnBatchOperationKind,
    SvnCertificateFailure,
    SvnCertificateTrustStatus,
    SvnOperationKind,
    Task,
    TaskSnapshot,
    WorkingCopyStatus,
  } from "./types/api";
  import type { AppView, SvnOperationFeedback } from "./types/app";

  let backendMessage = "等待连接后端";
  let commandError: CommandError | null = null;
  let startupSurface: "loading" | "main" | "blame" | "browse" | "checkout" | "cleanup" | "commit" | "log" | "merge-preview" | "revert" | "update" | "resolve" | "info" =
    hasTauriRuntime() ? "loading" : "main";
  let standaloneBlamePath = "";
  let standaloneBlameRevision: string | undefined = undefined;
  let standaloneBlameReady = false;
  let standaloneBrowsePath = "";
  let standaloneBrowseRevision: string | undefined = undefined;
  let standaloneBrowseReady = false;
  let standaloneCheckoutPath = "";
  let standaloneCheckoutReady = false;
  let standaloneCleanupPath = "";
  let standaloneCleanupReady = false;
  let standaloneCommitPath = "";
  let standaloneCommitReady = false;
  let standaloneLogPath = "";
  let standaloneLogRepositoryRoot: string | undefined = undefined;
  let standaloneLogRevision: string | undefined = undefined;
  let standaloneLogReady = false;
  let standaloneMergePreviewId = "";
  let standaloneMergePreviewReady = false;
  let standaloneRevertPath = "";
  let standaloneRevertReady = false;
  let standaloneUpdatePath = "";
  let standaloneUpdateReady = false;
  let standaloneUpdateReturnAction: string | null = null;
  let standaloneConflictPath = "";
  let standaloneConflictReady = false;
  let standaloneInfoPath = "";
  let standaloneInfoReady = false;
  let unlistenAppMenu: UnlistenFn | null = null;
  let unlistenDragDrop: UnlistenFn | null = null;
  let repositoryImportDropActive = false;
  let pendingRepositoryDragExportTaskId: string | null = null;
  let repositoryDragExportPrepared: RepositoryExportResult | null = null;
  let repositoryDragExportError: string | null = null;
  let repositoryDragExportStarting = false;
  let repositoryDragExportRunningName: string | null = null;
  let activeWorkspacePath: string | null = null;
  const workspaceViews = new Map<string, AppView>();
  let appMenuState: AppMenuState;
  let queuedAppMenuState: AppMenuState | null = null;
  let appMenuStateSignature = "";
  let appMenuSyncRunning = false;
  let repositoryFileCreating = false;
  let svnAuthenticationPassword = "";
  let svnAuthenticationStatus: SvnAuthenticationStatus | null = null;
  let svnAuthenticationError: CommandError | null = null;
  let svnAuthenticationLoading = false;
  let svnCertificateTrustStatus: SvnCertificateTrustStatus | null = null;
  let svnCertificateTrustError: CommandError | null = null;
  let svnCertificateTrustLoading = false;
  let conflictResolutionSaving = false;
  let conflictResolutionError: CommandError | null = null;
  let svnOperationFeedback: SvnOperationFeedback | null = null;
  let changelistRunning = false;
  let workspaceAdding = false;
  let svnOperationFeedbackTimer: ReturnType<typeof window.setTimeout> | null = null;
  let inlineUpdateRoot: string | null = null;
  let inlineUpdateTaskId: string | null = null;
  let inlineUpdateTask: Task | null = null;
  let inlineUpdateMinimized = false;
  let inlineUpdateRefreshSignature = "";
  let inlineUpdateRefreshGeneration = 0;
  const repositoryLayoutTaskChecks = new Set<string>();
  const applyPatchTaskChecks = new Set<string>();
  const missingSvnOperationTaskChecks = new Set<string>();
  const svnOperationCreationCoordinator = createSvnOperationCreationCoordinator();
  const pendingTaskCompletionCoordinator = createPendingTaskCompletionCoordinator();

  $: activeView = workbenchViews[$currentView];
  $: selectedFile =
    $workspaceStore.status?.files.find(
      (file) => file.path === $workspaceStore.selectedFilePath,
    ) ?? null;
  $: selectedFileReviewed =
    selectedFile !== null &&
    $workspaceStore.reviewedFiles.some((file) => file.path === selectedFile.path);
  $: unconfirmedSafetyWarnings =
    $workspaceStore.safetyCheck.warnings.filter(
      (item) => !$workspaceStore.safetyCheck.confirmedWarningIds.includes(item.id),
    ).length;
  $: commitSafetyBlocked =
    $workspaceStore.safetyCheck.blockers.length > 0 || unconfirmedSafetyWarnings > 0;
  $: committableChangeCount =
    $workspaceStore.status?.files.filter(
      (file) =>
        ![
          "normal",
          "missing",
          "conflicted",
          "obstructed",
          "unversioned",
          "external",
        ].includes(file.status),
    ).length ?? 0;
  $: inlineUpdateVisible =
    inlineUpdateRoot !== null &&
    $workspaceStore.current !== null &&
    isSameWorkingCopyRoot(
      inlineUpdateRoot,
      $workspaceStore.current.working_copy_root,
    );
  $: currentPendingSvnOperationKind =
    $workspaceStore.pendingSvnOperationKind !== null &&
    $workspaceStore.pendingSvnOperationWorkingCopyRoot !== null &&
    $workspaceStore.current !== null &&
    isSameWorkingCopyRoot(
      $workspaceStore.pendingSvnOperationWorkingCopyRoot,
      $workspaceStore.current.working_copy_root,
    )
      ? $workspaceStore.pendingSvnOperationKind
      : null;
  $: if (inlineUpdateTaskId) {
    const summary = $taskStore.snapshot.tasks.find(
      (task) => task.task_id === inlineUpdateTaskId,
    );
    const selectedTask =
      $taskStore.selectedTask?.task_id === inlineUpdateTaskId
        ? $taskStore.selectedTask
        : null;
    const signature = `${inlineUpdateTaskId}:${summary?.updated_at ?? "missing"}:${selectedTask?.updated_at ?? "unselected"}`;
    if (signature !== inlineUpdateRefreshSignature) {
      inlineUpdateRefreshSignature = signature;
      if (selectedTask && (!summary || selectedTask.updated_at >= summary.updated_at)) {
        inlineUpdateTask = selectedTask;
      } else {
        void refreshInlineUpdateTask(inlineUpdateTaskId);
      }
    }
  }
  $: selectedHunkIds =
    selectedFile === null
      ? []
      : $workspaceStore.selectedHunks
          .filter(
            (item) =>
              item.filePath === selectedFile.path &&
              item.fileDigest === selectedFile.content_digest,
          )
          .map((item) => item.hunkId);
  $: appMenuState = buildAppMenuState({
    viewId: activeView.id,
    workspaceOpen: $workspaceStore.current !== null,
    activePath: activeWorkspacePath,
    fileTree: $workspaceStore.fileTree,
    status: $workspaceStore.status,
    commitFiles: $workspaceStore.commitFiles,
    statusLoading: $workspaceStore.statusLoading,
    workspaceLocked:
      $taskStore.snapshot.running_task_id !== null ||
      $workspaceStore.pendingSvnOperationKind !== null ||
      $workspaceStore.applyPatchCreating ||
      $workspaceStore.pendingApplyPatchTaskId !== null,
  });
  $: queueAppMenuStateSync(appMenuState, startupSurface);

  async function pingBackend() {
    commandError = null;
    try {
      const health = await callBackend<HealthPayload>("ping");
      backendMessage = `${health.message} (${health.backend})`;
    } catch (error) {
      commandError = error as CommandError;
    }
  }

  async function detectSvnWithInputAndSave() {
    const detection = await svnStore.detectWithInput();
    if (!detection) {
      return;
    }

    appSettingsStore.setField(
      "svnExecutable",
      $svnStore.executableInput || detection.resolved_path || detection.executable,
    );
  }

  function currentSvnExecutable() {
    const executable =
      $svnStore.detection?.resolved_path ??
      $svnStore.detection?.executable ??
      $svnStore.executableInput.trim();
    return executable || undefined;
  }
  function rememberCurrentWorkspaceView() {
    const localPath = $workspaceStore.current?.local_path;
    if (localPath) {
      workspaceViews.set(normalizeLocalPath(localPath), $currentView);
    }
  }

  function setActiveWorkspaceView(view: AppView) {
    setCurrentView(view);
    const localPath = $workspaceStore.current?.local_path;
    if (localPath) {
      workspaceViews.set(normalizeLocalPath(localPath), view);
    }
  }

  async function selectView(view: AppView) {
    const shouldRefreshStatus =
      view === "changes" &&
      $currentView !== "changes" &&
      $workspaceStore.current !== null &&
      $workspaceStore.status === null &&
      !$workspaceStore.statusLoading;
    const shouldRefreshLog =
      view === "history" &&
      $currentView !== "history" &&
      $workspaceStore.current !== null &&
      !$workspaceStore.svnLogLoading;

    setActiveWorkspaceView(view);
    if (shouldRefreshStatus) {
      await refreshStatusAndSyncBranchPool();
    } else if (shouldRefreshLog) {
      await workspaceStore.refreshSvnLog(currentSvnExecutable());
    }
  }

  function trackedOperationTitle(kind: PendingSvnOperationKind) {
    if (kind === "cleanup") {
      return "清理工作副本";
    }
    if (kind === "update_path") {
      return "更新所选路径";
    }
    return "更新工作副本";
  }

  function tracksOperationFeedback(
    kind: PendingSvnOperationKind | null,
  ): kind is "update_path" | "cleanup" {
    return kind === "update_path" || kind === "cleanup";
  }

  function showSvnOperationFeedback(feedback: SvnOperationFeedback) {
    if (svnOperationFeedbackTimer !== null) {
      window.clearTimeout(svnOperationFeedbackTimer);
      svnOperationFeedbackTimer = null;
    }
    svnOperationFeedback = feedback;
    backendMessage = `${feedback.title}：${feedback.detail}`;
    if (feedback.phase !== "running") {
      svnOperationFeedbackTimer = window.setTimeout(
        () => {
          svnOperationFeedback = null;
          svnOperationFeedbackTimer = null;
        },
        feedback.phase === "success" ? 5000 : 8000,
      );
    }
  }

  function dismissSvnOperationFeedback() {
    if (svnOperationFeedbackTimer !== null) {
      window.clearTimeout(svnOperationFeedbackTimer);
      svnOperationFeedbackTimer = null;
    }
    svnOperationFeedback = null;
  }

  async function restoreRememberedSvnAuthentication() {
    const username = $appSettingsStore.svnUsername.trim();
    if (
      $appSettingsStore.svnAuthenticationMode !== "password" ||
      !$appSettingsStore.svnRememberPassword ||
      !username
    ) {
      return;
    }
    try {
      svnAuthenticationStatus = await configureSvnAuthentication({
        mode: "password",
        username,
        remember_password: true,
      });
    } catch {
      // 未保存或系统凭据库暂不可用时，沿用认证失败后的登录流程。
      svnAuthenticationStatus = null;
    }
  }
  async function applySvnAuthentication() {
    svnAuthenticationLoading = true;
    svnAuthenticationError = null;
    const mode = $appSettingsStore.svnAuthenticationMode;
    try {
      svnAuthenticationStatus = await configureSvnAuthentication({
        mode,
        username: $appSettingsStore.svnUsername.trim() || undefined,
        password: mode === "password" ? svnAuthenticationPassword : undefined,
        remember_password:
          mode === "password" && $appSettingsStore.svnRememberPassword,
      });
      svnAuthenticationPassword = "";
      return true;
    } catch (error) {
      svnAuthenticationError = error as CommandError;
      return false;
    } finally {
      svnAuthenticationLoading = false;
    }
  }

  async function applyPromptedSvnAuthentication(
    username: string,
    password: string,
    rememberPassword: boolean,
  ) {
    appSettingsStore.setField("svnAuthenticationMode", "password");
    appSettingsStore.setField("svnUsername", username);
    appSettingsStore.setField("svnRememberPassword", rememberPassword);
    svnAuthenticationPassword = password;
    return applySvnAuthentication();
  }

  async function confirmSvnCertificateTrust(failures: SvnCertificateFailure[]) {
    svnCertificateTrustLoading = true;
    svnCertificateTrustError = null;
    try {
      svnCertificateTrustStatus = await configureSvnCertificateTrust({
        failures,
        confirmed: true,
      });
      return true;
    } catch (error) {
      svnCertificateTrustError = error as CommandError;
      return false;
    } finally {
      svnCertificateTrustLoading = false;
    }
  }

  async function clearCurrentSvnCertificateTrust() {
    svnCertificateTrustLoading = true;
    svnCertificateTrustError = null;
    try {
      svnCertificateTrustStatus = await clearSvnCertificateTrust();
    } catch (error) {
      svnCertificateTrustError = error as CommandError;
    } finally {
      svnCertificateTrustLoading = false;
    }
  }

  function hasTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function preventNativeContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function preventBrowserFindShortcut(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function queueAppMenuStateSync(
    state: AppMenuState,
    surface: typeof startupSurface,
  ) {
    if (!hasTauriRuntime() || surface !== "main") {
      return;
    }
    const signature = JSON.stringify(state);
    if (signature === appMenuStateSignature) {
      return;
    }
    appMenuStateSignature = signature;
    queuedAppMenuState = state;
    if (!appMenuSyncRunning) {
      void flushAppMenuStateSync();
    }
  }

  async function flushAppMenuStateSync() {
    appMenuSyncRunning = true;
    while (queuedAppMenuState) {
      const state = queuedAppMenuState;
      queuedAppMenuState = null;
      try {
        await callBackend<void>("sync_app_menu_state", { state });
      } catch (error) {
        commandError = error as CommandError;
        appMenuStateSignature = "";
      }
    }
    appMenuSyncRunning = false;
  }

  async function refreshStatusAndSyncBranchPool(
    workingCopyRoot?: string | null,
  ): Promise<WorkingCopyStatus | null> {
    const root = workingCopyRoot ?? $workspaceStore.current?.working_copy_root;
    if (!root) {
      return null;
    }

    const status = await workspaceStore.refreshStatus(currentSvnExecutable(), root);
    await syncCurrentBranchPoolEntry();
    return status;
  }

  async function syncCurrentBranchPoolEntry(addMissing = false) {
    const workspace = $workspaceStore.current;
    const status = $workspaceStore.status;
    if (!workspace) {
      return;
    }

    const branchEntry = $branchPoolStore.pool.entries.find(
      (entry) =>
        normalizeLocalPath(entry.local_path) === normalizeLocalPath(workspace.local_path),
    );
    if (!branchEntry && !addMissing) {
      return;
    }
    const revision = status?.revision_range ?? workspace.revision;
    const localChanges = status?.total ?? branchEntry?.local_changes ?? 0;
    if (
      branchEntry &&
      branchEntry.revision === revision &&
      branchEntry.local_changes === localChanges
    ) {
      return;
    }

    await branchPoolStore.saveExisting({
      branchUrl: branchEntry?.branch_url ?? workspace.repository_url,
      localPath: branchEntry?.local_path ?? workspace.local_path,
      revision,
      localChanges,
    });
  }

  function normalizeLocalPath(path: string) {
    const windowsPath = /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
    const normalized = windowsPath
      ? path.replaceAll("\\", "/")
      : path;
    const withoutTrailingSeparator = normalized.replace(/\/+$/, "");
    return windowsPath ? withoutTrailingSeparator.toLowerCase() : withoutTrailingSeparator;
  }

  async function openExternalTool(kind: ExternalToolKind, filePath: string) {
    commandError = null;
    const toolPath =
      kind === "diff" ? $appSettingsStore.externalDiffTool : $appSettingsStore.externalMergeTool;
    const toolError =
      kind === "diff"
        ? $appSettingsStore.validationErrors.externalDiffTool
        : $appSettingsStore.validationErrors.externalMergeTool;
    if (toolError) {
      commandError = {
        code: "EXTERNAL_TOOL_SETTING_INVALID",
        message: "外部工具配置无效",
        detail: toolError,
        recoverable: true,
      };
      return;
    }

    const root = $workspaceStore.current?.working_copy_root;
    if (!root) {
      commandError = {
        code: "WORKSPACE_REQUIRED",
        message: "请先打开 SVN 工作副本",
        detail: null,
        recoverable: true,
      };
      return;
    }

    try {
      const result = await launchExternalTool({
        kind,
        tool_path: toolPath,
        working_copy_root: root,
        file_path: filePath,
      });
      backendMessage = `已启动外部 ${kind === "diff" ? "Diff" : "Merge"} 工具：${result.target_path}`;
    } catch (error) {
      commandError = error as CommandError;
    }
  }

  async function saveConflictResolution(filePath: string, resolvedText: string) {
    const root = $workspaceStore.current?.working_copy_root;
    if (!root) {
      conflictResolutionError = {
        code: "WORKSPACE_REQUIRED",
        message: "请先打开 SVN 工作副本",
        detail: null,
        recoverable: true,
      };
      return false;
    }

    conflictResolutionSaving = true;
    conflictResolutionError = null;
    try {
      await resolveTextConflict({
        working_copy_root: root,
        file_path: filePath,
        resolved_text: resolvedText,
        svn_executable: currentSvnExecutable(),
      });
      const status = await refreshStatusAndSyncBranchPool(root);
      const nextConflict = status?.files.find(
        (file) => file.status === "conflicted" || file.conflict_kind,
      );
      const refreshedFile = status?.files.find((file) => file.path === filePath);
      if (nextConflict) {
        await workspaceStore.selectFile(nextConflict.path, currentSvnExecutable());
      } else if (refreshedFile) {
        await workspaceStore.selectFile(refreshedFile.path, currentSvnExecutable());
      }
      backendMessage = nextConflict
        ? `已解决 ${filePath}，还有 ${status?.conflicted ?? 0} 个冲突待处理`
        : `已解决 ${filePath}，当前工作副本没有文本冲突`;
      return true;
    } catch (error) {
      conflictResolutionError = error as CommandError;
      return false;
    } finally {
      conflictResolutionSaving = false;
    }
  }

  async function openSelectedFileLocation(filePath: string) {
    commandError = null;
    const root = $workspaceStore.current?.working_copy_root;
    if (!root) {
      commandError = {
        code: "WORKSPACE_REQUIRED",
        message: "请先打开 SVN 工作副本",
        detail: null,
        recoverable: true,
      };
      return;
    }

    try {
      const result = await openFileLocation({
        working_copy_root: root,
        file_path: filePath,
      });
      backendMessage = `已打开文件位置：${result.target_path}`;
    } catch (error) {
      commandError = error as CommandError;
    }
  }

  async function openSelectedFile(filePath: string) {
    commandError = null;
    const root = $workspaceStore.current?.working_copy_root;
    if (!root) {
      commandError = {
        code: "WORKSPACE_REQUIRED",
        message: "请先打开 SVN 工作副本",
        detail: null,
        recoverable: true,
      };
      return;
    }

    try {
      const result = await openWorkspaceFile({
        working_copy_root: root,
        file_path: filePath,
      });
      backendMessage = `已打开文件：${result.target_path}`;
    } catch (error) {
      commandError = error as CommandError;
    }
  }

  async function saveSvnPropertyWithConfirm() {
    const propertyName = $workspaceStore.propertyEditForm.name.trim();
    if (!propertyName) {
      return;
    }

    const target = $workspaceStore.selectedFilePath || "工作副本根目录";
    const deletingProperty = !$workspaceStore.propertyEditForm.value.trim();
    const confirmed = window.confirm(
      `确定${deletingProperty ? "删除" : "保存"} SVN 属性吗？\n${target}\n${propertyName}`,
    );
    if (!confirmed) {
      return;
    }

    await workspaceStore.saveSvnProperty(currentSvnExecutable());
  }

  async function submitCommitFiles() {
    if (!workspaceStore.validateCommitFiles() || !$workspaceStore.current) {
      return;
    }

    const files = $workspaceStore.commitFiles.map((file) => file.path);
    const task = await taskStore.createCommit({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      message: $workspaceStore.commitMessage,
      files,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      return;
    }

    workspaceStore.markCommitTask(
      task.task_id,
      files,
      $workspaceStore.current.working_copy_root,
    );
  }

  async function submitSelectedPatch() {
    if (
      !$workspaceStore.current ||
      !$workspaceStore.selectedPatch ||
      !workspaceStore.validateSelectedHunksForPartialCommit()
    ) {
      return;
    }

    const files = selectedCurrentHunkFiles(
      $workspaceStore.selectedHunks,
      $workspaceStore.status?.files ?? [],
    );
    const task = await taskStore.createPartialCommit({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      repositoryUrl: $workspaceStore.current.repository_url,
      revision: $workspaceStore.current.revision,
      message: $workspaceStore.commitMessage,
      selectedPatch: $workspaceStore.selectedPatch.text,
      files,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      return;
    }

    workspaceStore.markPartialCommitTask(task.task_id);
  }

  function selectedCurrentHunkFiles(
    selectedHunks: Array<{ filePath: string; fileDigest: string }>,
    currentFiles: ChangedFile[],
  ) {
    return currentFiles.flatMap((file) => {
      const hasCurrentHunk = selectedHunks.some(
        (item) => item.filePath === file.path && item.fileDigest === file.content_digest,
      );

      return hasCurrentHunk ? [file.path] : [];
    });
  }

  async function runSvnOperation(
    kind: SvnOperationKind,
    filePath?: string,
    targetPath?: string,
  ): Promise<Task | null> {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (
      !workingCopyRoot ||
      svnOperationCreationCoordinator.isCreating() ||
      $workspaceStore.pendingSvnOperationTaskId !== null
    ) {
      return null;
    }

    if (kind === "revert_file") {
      const confirmed = window.confirm(`确定要撤销文件改动吗？\n${filePath ?? ""}`);
      if (!confirmed) {
        return null;
      }
    }

    if (kind === "update_path") {
      const file = $workspaceStore.status?.files.find((item) => item.path === filePath);
      if (file?.change_scope === "both") {
        const confirmed = window.confirm(
          `此路径同时包含本地改动和远端更新，Update 可能产生合并或冲突。是否继续？\n${filePath ?? ""}`,
        );
        if (!confirmed) {
          return null;
        }
      }
    }

    if (kind === "delete_path") {
      const confirmed = window.confirm(
        `确定要从工作副本删除此路径吗？\n${filePath ?? ""}\n\n这会删除本地内容并安排 SVN 删除。\n未提交改动和目录内未版本控制内容可能丢失。`,
      );
      if (!confirmed) {
        return null;
      }
    }

    if (kind === "delete_unversioned_file") {
      const confirmed = window.confirm(
        `确定永久删除未版本控制文件吗？\n${filePath ?? ""}\n\n该文件将从磁盘删除，NovaSVN 无法撤销此操作。`,
      );
      if (!confirmed) {
        return null;
      }
    }

    if (kind.startsWith("resolve_")) {
      const confirmed = window.confirm(`确定要标记或选择冲突解决结果吗？\n${filePath ?? ""}`);
      if (!confirmed) {
        return null;
      }
    }

    if (tracksOperationFeedback(kind)) {
      showSvnOperationFeedback({
        kind,
        phase: "running",
        title: trackedOperationTitle(kind),
        detail:
          kind === "cleanup"
            ? "正在检查锁定并清理工作副本..."
            : "正在从仓库读取并应用最新变更...",
      });
    }

    let createdTask: Task | null = null;
    const created = await svnOperationCreationCoordinator.create(
      () => $workspaceStore.pendingSvnOperationTaskId !== null,
      () =>
        taskStore.createSvnOperation({
          workingCopyRoot,
          kind,
          filePath,
          targetPath,
          svnExecutable: currentSvnExecutable(),
        }),
      (task) => {
        createdTask = task;
        workspaceStore.markSvnOperationTask(task.task_id, kind, workingCopyRoot);
      },
    );
    if (!created && tracksOperationFeedback(kind) && $workspaceStore.pendingSvnOperationTaskId === null) {
      showSvnOperationFeedback({
        kind,
        phase: "error",
        title: trackedOperationTitle(kind),
        detail: $taskStore.error?.message ?? "任务创建失败，请重试",
      });
    }
    return createdTask;
  }

  async function loadRepositoryUrl(url?: string) {
    const targetUrl = (url ?? $workspaceStore.repositoryUrlInput).trim();
    if (!targetUrl) {
      workspaceStore.failRepositoryList("请输入仓库 URL");
      return;
    }

    const task = await taskStore.createRepositoryList({
      url: targetUrl,
      revision: $workspaceStore.repositoryRevisionInput,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRepositoryList($taskStore.error?.message ?? "仓库目录加载任务创建失败");
      return;
    }

    workspaceStore.markRepositoryListTask(task.task_id, targetUrl);
  }

  async function openRepositoryFile(fileName: string) {
    const repositoryList = $workspaceStore.repositoryList;
    if (
      !repositoryList ||
      !fileName.trim() ||
      repositoryFileCreating ||
      $workspaceStore.pendingRepositoryFileTaskId !== null
    ) {
      return;
    }

    repositoryFileCreating = true;
    const url = joinRepositoryUrl(repositoryList.url, fileName);
    const task = await taskStore.createRepositoryFile({
      url,
      revision: repositoryList.revision ?? $workspaceStore.repositoryRevisionInput,
      svnExecutable: currentSvnExecutable(),
    });
    repositoryFileCreating = false;

    if (!task) {
      workspaceStore.failRepositoryFile(
        $taskStore.error?.message ?? "仓库文件下载任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryFileTask(task.task_id);
  }

  function loadRepositoryFileLog(fileName: string) {
    const repositoryList = $workspaceStore.repositoryList;
    if (!repositoryList || !fileName.trim()) {
      return;
    }
    void workspaceStore.loadRepositoryFileLog({
      url: joinRepositoryUrl(repositoryList.url, fileName),
      revision: repositoryList.revision ?? $workspaceStore.repositoryRevisionInput,
      svnExecutable: currentSvnExecutable(),
    });
  }

  function loadRepositoryFileBlame(fileName: string) {
    const repositoryList = $workspaceStore.repositoryList;
    if (!repositoryList || !fileName.trim()) {
      return;
    }
    void workspaceStore.loadRepositoryFileBlame({
      url: joinRepositoryUrl(repositoryList.url, fileName),
      revision: repositoryList.revision ?? $workspaceStore.repositoryRevisionInput,
      svnExecutable: currentSvnExecutable(),
    });
  }

  function loadRepositoryFileProperties(fileName: string) {
    const repositoryList = $workspaceStore.repositoryList;
    if (!repositoryList || !fileName.trim()) {
      return;
    }
    void workspaceStore.loadRepositoryFileProperties({
      url: joinRepositoryUrl(repositoryList.url, fileName),
      revision: repositoryList.revision ?? $workspaceStore.repositoryRevisionInput,
      svnExecutable: currentSvnExecutable(),
    });
  }

  async function detectRepositoryLayout() {
    const root = ($workspaceStore.repositoryUrlInput || $workspaceStore.current?.repository_root || "")
      .trim()
      .replace(/\/+$/, "");
    if (!root) {
      workspaceStore.failRepositoryList("请输入仓库 URL 或先打开 SVN 工作副本");
      return;
    }

    const layout = $workspaceStore.repositoryLayout;
    const targets: Array<{
      kind: "trunk" | "branches" | "tags";
      path: string;
    }> = [
      { kind: "trunk", path: layout.trunkPath },
      { kind: "branches", path: layout.branchesPath },
      { kind: "tags", path: layout.tagsPath },
    ];

    for (const target of targets) {
      const url = joinRepositoryUrl(root, target.path);
      const task = await taskStore.createRepositoryList({
        url,
        revision: $workspaceStore.repositoryRevisionInput,
        svnExecutable: currentSvnExecutable(),
      });

      if (task) {
        workspaceStore.markRepositoryLayoutTask(target.kind, task.task_id);
      } else {
        workspaceStore.failRepositoryLayoutResult(
          target.kind,
          $taskStore.error?.message ?? "仓库布局识别任务创建失败",
        );
      }
    }
  }

  function joinRepositoryUrl(root: string, path: string) {
    const normalizedPath = path
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    if (!normalizedPath) {
      return root.replace(/\/+$/, "");
    }

    return `${root.replace(/\/+$/, "")}/${normalizedPath}`;
  }

  function parentRepositoryUrl(url: string) {
    const normalized = url.trim().replace(/\/+$/, "");
    const separatorIndex = normalized.lastIndexOf("/");
    return separatorIndex > normalized.indexOf("://") + 2
      ? normalized.slice(0, separatorIndex)
      : normalized;
  }

  function refreshRepositoryAfterWrite(url: string) {
    workspaceStore.setRepositoryRevisionInput("");
    void loadRepositoryUrl(url);
  }

  async function createRepositoryCopy() {
    const form = $workspaceStore.repositoryCopyForm;
    if (!form.sourceUrl.trim() || !form.targetUrl.trim()) {
      workspaceStore.failRepositoryCopyTask("请输入源 URL 和目标 URL");
      return;
    }

    if (!form.message.trim()) {
      workspaceStore.failRepositoryCopyTask("请输入 Repository Copy 的提交信息");
      return;
    }
    if ($workspaceStore.pendingRepositoryCopyTaskId !== null) {
      return;
    }
    const operation =
      form.kind === "branch" ? "创建分支" : form.kind === "tag" ? "创建标签" : "复制仓库条目";
    const confirmed = window.confirm(
      `确定${operation}吗？\n\n源：${form.sourceUrl}\n目标：${form.targetUrl}\n提交信息：${form.message.trim()}`,
    );
    if (!confirmed) {
      return;
    }

    const task = await taskStore.createRepositoryCopy({
      kind: form.kind,
      sourceUrl: form.sourceUrl,
      targetUrl: form.targetUrl,
      revision: form.revision,
      message: form.message,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRepositoryCopyTask(
        $taskStore.error?.message ?? "Repository Copy 任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryCopyTask(task.task_id, parentRepositoryUrl(form.targetUrl));
  }

  async function createRepositoryMkdir() {
    const form = $workspaceStore.repositoryMkdirForm;
    const targetUrl = form.targetUrl.trim();
    const message = form.message.trim();
    if (!targetUrl) {
      workspaceStore.failRepositoryMkdirTask("请输入新目录 URL");
      return;
    }
    if (!message) {
      workspaceStore.failRepositoryMkdirTask("请输入创建仓库目录的提交信息");
      return;
    }
    if ($workspaceStore.pendingRepositoryMkdirTaskId !== null) {
      return;
    }
    const confirmed = window.confirm(
      `确定创建仓库目录吗？\n\n目标：${targetUrl}\n提交信息：${message}`,
    );
    if (!confirmed) {
      return;
    }

    const task = await taskStore.createRepositoryMkdir({
      url: targetUrl,
      message,
      svnExecutable: currentSvnExecutable(),
    });
    if (!task) {
      workspaceStore.failRepositoryMkdirTask(
        $taskStore.error?.message ?? "创建仓库目录任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryMkdirTask(task.task_id, parentRepositoryUrl(targetUrl));
  }

  async function createRepositoryImport() {
    const form = $workspaceStore.repositoryImportForm;
    const sourcePath = form.sourcePath.trim();
    const targetUrl = form.targetUrl.trim();
    const message = form.message.trim();
    if (!sourcePath || !targetUrl) {
      workspaceStore.failRepositoryImportTask("请选择本地源并输入目标 URL");
      return;
    }
    if (!message) {
      workspaceStore.failRepositoryImportTask("请输入 Repository Import 的提交信息");
      return;
    }
    if ($workspaceStore.pendingRepositoryImportTaskId !== null) {
      return;
    }
    const confirmed = window.confirm(
      `确定 Import 到仓库吗？\n\n本地源：${sourcePath}\n目标：${targetUrl}\n提交信息：${message}`,
    );
    if (!confirmed) {
      return;
    }

    const task = await taskStore.createRepositoryImport({
      sourcePath,
      targetUrl,
      message,
      svnExecutable: currentSvnExecutable(),
    });
    if (!task) {
      workspaceStore.failRepositoryImportTask(
        $taskStore.error?.message ?? "Repository Import 任务创建失败",
      );
      return;
    }
    workspaceStore.markRepositoryImportTask(task.task_id, parentRepositoryUrl(targetUrl));
  }

  async function createRepositoryMove() {
    const form = $workspaceStore.repositoryMoveForm;
    const sourceUrl = form.sourceUrl.trim();
    const targetUrl = form.targetUrl.trim();
    const message = form.message.trim();
    if (!sourceUrl || !targetUrl) {
      workspaceStore.failRepositoryMoveTask("请输入 Move 源 URL 和目标 URL");
      return;
    }
    if (!message) {
      workspaceStore.failRepositoryMoveTask("请输入 Repository Move 的提交信息");
      return;
    }
    if ($workspaceStore.pendingRepositoryMoveTaskId !== null) {
      return;
    }
    const confirmed = window.confirm(
      `确定移动仓库条目吗？\n\n源：${sourceUrl}\n目标：${targetUrl}\n提交信息：${message}`,
    );
    if (!confirmed) {
      return;
    }

    const task = await taskStore.createRepositoryMove({
      sourceUrl,
      targetUrl,
      message,
      svnExecutable: currentSvnExecutable(),
    });
    if (!task) {
      workspaceStore.failRepositoryMoveTask(
        $taskStore.error?.message ?? "Repository Move 任务创建失败",
      );
      return;
    }
    workspaceStore.markRepositoryMoveTask(
      task.task_id,
      parentRepositoryUrl(sourceUrl),
      parentRepositoryUrl(targetUrl),
    );
  }

  async function createRepositoryRename() {
    const form = $workspaceStore.repositoryRenameForm;
    const sourceUrl = form.sourceUrl.trim();
    const targetUrl = form.targetUrl.trim();
    const message = form.message.trim();
    if (!sourceUrl || !targetUrl) {
      workspaceStore.failRepositoryRenameTask("请输入 Rename 源 URL 和目标 URL");
      return;
    }
    if (!message) {
      workspaceStore.failRepositoryRenameTask("请输入 Repository Rename 的提交信息");
      return;
    }
    if ($workspaceStore.pendingRepositoryMoveTaskId !== null) {
      return;
    }
    const confirmed = window.confirm(
      `确定重命名仓库条目吗？\n\n源：${sourceUrl}\n目标：${targetUrl}\n提交信息：${message}`,
    );
    if (!confirmed) {
      return;
    }

    const task = await taskStore.createRepositoryMove({
      kind: "rename",
      sourceUrl,
      targetUrl,
      message,
      svnExecutable: currentSvnExecutable(),
    });
    if (!task) {
      workspaceStore.failRepositoryRenameTask(
        $taskStore.error?.message ?? "Repository Rename 任务创建失败",
      );
      return;
    }
    workspaceStore.markRepositoryMoveTask(
      task.task_id,
      parentRepositoryUrl(sourceUrl),
      parentRepositoryUrl(targetUrl),
      "rename",
    );
  }

  async function createRepositoryDelete() {
    const form = $workspaceStore.repositoryDeleteForm;
    const url = form.url.trim();
    const message = form.message.trim();
    if (!url) {
      workspaceStore.failRepositoryDeleteTask("请输入要删除的仓库 URL");
      return;
    }
    if (!message) {
      workspaceStore.failRepositoryDeleteTask("请输入 Repository Delete 的提交信息");
      return;
    }
    if ($workspaceStore.pendingRepositoryDeleteTaskId !== null) {
      return;
    }
    const confirmed = window.confirm(
      `确定永久删除仓库条目吗？\n\n目标：${url}\n提交信息：${message}\n\n该操作会直接提交到远端仓库。`,
    );
    if (!confirmed) {
      return;
    }

    const task = await taskStore.createRepositoryDelete({
      url,
      message,
      svnExecutable: currentSvnExecutable(),
    });
    if (!task) {
      workspaceStore.failRepositoryDeleteTask(
        $taskStore.error?.message ?? "Repository Delete 任务创建失败",
      );
      return;
    }
    workspaceStore.markRepositoryDeleteTask(task.task_id, parentRepositoryUrl(url));
  }

  async function createRepositoryCheckout() {
    const form = $workspaceStore.repositoryCheckoutForm;
    if (!form.url.trim()) {
      workspaceStore.failRepositoryCheckoutTask("请输入仓库 URL");
      return;
    }
    if (!form.localPath.trim()) {
      workspaceStore.failRepositoryCheckoutTask("请输入本地工作副本路径");
      return;
    }
    if ($workspaceStore.pendingRepositoryCheckoutTaskId !== null) {
      return;
    }

    const task = await taskStore.createRepositoryCheckout({
      url: form.url,
      localPath: form.localPath,
      revision: form.revision,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRepositoryCheckoutTask(
        $taskStore.error?.message ?? "仓库 Checkout 任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryCheckoutTask(task.task_id, form.localPath);
  }

  async function createRepositoryExport() {
    const form = $workspaceStore.repositoryExportForm;
    if (!form.url.trim()) {
      workspaceStore.failRepositoryExportTask("请输入仓库 URL");
      return;
    }
    if (!form.localPath.trim()) {
      workspaceStore.failRepositoryExportTask("请输入本地导出路径");
      return;
    }
    if ($workspaceStore.pendingRepositoryExportTaskId !== null) {
      return;
    }

    const task = await taskStore.createRepositoryExport({
      url: form.url,
      localPath: form.localPath,
      revision: form.revision,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRepositoryExportTask(
        $taskStore.error?.message ?? "仓库 Export 任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryExportTask(task.task_id, form.localPath);
  }

  async function exportLogRevision(revision: string) {
    const url = $workspaceStore.svnLog?.repository_url?.trim() ?? "";
    const selectedRevision = revision.trim();
    if (!url) {
      workspaceStore.failRepositoryExportTask("当前日志没有可用的仓库 URL，无法 Export");
      return;
    }
    if (!selectedRevision) {
      workspaceStore.failRepositoryExportTask("请选择要 Export 的 Revision");
      return;
    }
    if ($workspaceStore.pendingRepositoryExportTaskId !== null) {
      return;
    }

    const parentDirectory = await chooseExportDirectory();
    if (!parentDirectory) {
      return;
    }

    const localPath = suggestExportLocalPath(url, parentDirectory, selectedRevision);
    if (!localPath) {
      workspaceStore.failRepositoryExportTask("无法生成 Export 本地路径");
      return;
    }

    if (
      !window.confirm(
        `确定 Export r${selectedRevision} 吗？\n\n源：${url}\n目标：${localPath}\n\n导出结果不含 .svn 元数据。`,
      )
    ) {
      return;
    }

    workspaceStore.setRepositoryExportForm("url", url);
    workspaceStore.setRepositoryExportForm("localPath", localPath);
    workspaceStore.setRepositoryExportForm("revision", selectedRevision);

    const task = await taskStore.createRepositoryExport({
      url,
      localPath,
      revision: selectedRevision,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRepositoryExportTask(
        $taskStore.error?.message ?? "仓库 Export 任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryExportTask(task.task_id, localPath);
  }

  async function startRepositoryEntryDrag(result: RepositoryExportResult) {
    repositoryDragExportError = null;
    try {
      await startDrag({
        item: [result.local_path],
        icon: dragPreviewIcon,
        mode: "copy",
      });
    } catch (error) {
      repositoryDragExportPrepared = null;
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : String(error);
      repositoryDragExportError = message || "无法启动系统文件拖拽";
    }
  }

  async function dragRepositoryEntry(name: string) {
    const repositoryList = $workspaceStore.repositoryList;
    if (!repositoryList || repositoryDragExportStarting || pendingRepositoryDragExportTaskId) {
      return;
    }
    const url = joinRepositoryUrl(repositoryList.url, name);
    const revision = repositoryList.revision;
    if (
      repositoryDragExportPrepared?.url === url &&
      repositoryDragExportPrepared.revision === revision
    ) {
      await startRepositoryEntryDrag(repositoryDragExportPrepared);
      return;
    }

    repositoryDragExportStarting = true;
    repositoryDragExportRunningName = name;
    repositoryDragExportError = null;
    const task = await taskStore.createRepositoryDragExport({
      url,
      name,
      revision,
      svnExecutable: currentSvnExecutable(),
    });
    repositoryDragExportStarting = false;
    if (!task) {
      repositoryDragExportRunningName = null;
      repositoryDragExportError = $taskStore.error?.message ?? "仓库拖出 Export 任务创建失败";
      return;
    }
    pendingRepositoryDragExportTaskId = task.task_id;
  }

  async function checkoutBranchPoolEntry() {
    const form = $branchPoolStore.form;
    if (!form.branchUrl.trim() || !form.localPath.trim()) {
      branchPoolStore.failCheckoutTask("请输入分支 URL 和本地路径");
      return;
    }
    if (!branchPoolStore.validateForm()) {
      return;
    }

    const task = await taskStore.createBranchCheckout({
      branchUrl: form.branchUrl,
      localPath: form.localPath,
      revision: form.revision,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      branchPoolStore.failCheckoutTask($taskStore.error?.message ?? "分支 checkout 任务创建失败");
      return;
    }

    branchPoolStore.markCheckoutTask(task.task_id);
  }

  async function reuseBranchPoolEntry() {
    const form = $branchPoolStore.form;
    if (!form.branchUrl.trim() || !form.localPath.trim()) {
      branchPoolStore.failCheckoutTask("请输入分支 URL 和已有工作副本路径");
      return;
    }

    await branchPoolStore.saveExisting({
      branchUrl: form.branchUrl,
      localPath: form.localPath,
      revision: form.revision,
      localChanges: 0,
    });
  }

  async function openBranchPoolEntry(localPath: string) {
    rememberCurrentWorkspaceView();
    const targetView = workspaceViews.get(normalizeLocalPath(localPath)) ?? "changes";
    setCurrentView(targetView);
    const preserveCurrentWorkspace = syncCurrentBranchPoolEntry(true);
    const content =
      targetView === "changes" ? "status" : targetView === "history" ? "log" : "none";
    const workspace = await workspaceStore.openPath(
      currentSvnExecutable(),
      localPath,
      content,
    );
    await preserveCurrentWorkspace;
    if (workspace) {
      setActiveWorkspaceView(targetView);
      if (content === "status") {
        await syncCurrentBranchPoolEntry();
      }
    }
  }

  async function addWorkspaceCopy() {
    if (workspaceAdding) {
      return;
    }
    workspaceAdding = true;
    const previousWorkspace = $workspaceStore.current;
    const previousStatus = $workspaceStore.status;
    try {
      const workspace = await workspaceStore.chooseAndOpen(currentSvnExecutable());
      if (!workspace) {
        return;
      }

      await branchPoolStore.saveExistingMany([
        ...(previousWorkspace
          ? [{
              branchUrl: previousWorkspace.repository_url,
              localPath: previousWorkspace.local_path,
              revision: previousStatus?.revision_range ?? previousWorkspace.revision,
              localChanges: previousStatus?.total ?? 0,
            }]
          : []),
        {
          branchUrl: workspace.repository_url,
          localPath: workspace.local_path,
          revision: $workspaceStore.status?.revision_range ?? workspace.revision,
          localChanges: $workspaceStore.status?.total ?? 0,
        },
      ]);
      setActiveWorkspaceView("changes");
    } finally {
      workspaceAdding = false;
    }
  }

  async function removeBranchPoolEntry(entryId: string, deleteLocalCopy = false) {
    const entry = $branchPoolStore.pool.entries.find((item) => item.id === entryId);
    if (!entry) {
      return;
    }

    const confirmed = deleteLocalCopy
      ? window.confirm(
          `确定清理该分支工作副本吗？\n\n将删除本地目录并从分支池移除：\n${entry.local_path}`,
        )
      : window.confirm(
          `确定从项目列表移除该项目吗？\n\n不会删除本地目录：\n${entry.local_path}`,
        );
    if (!confirmed) {
      return;
    }

    await branchPoolStore.remove(entry, deleteLocalCopy);
  }

  function reorderBranchPoolEntries(entryIds: string[]) {
    void branchPoolStore.reorder(entryIds);
  }

  function renameBranchPoolEntry(entryId: string, displayName: string) {
    void branchPoolStore.rename(entryId, displayName);
  }

  async function runSvnSwitch() {
    if (!$workspaceStore.current) {
      workspaceStore.failSvnSwitchTask("请先打开 SVN 工作副本");
      return;
    }

    const targetUrl = $workspaceStore.svnSwitchTargetUrl.trim();
    if (!targetUrl) {
      workspaceStore.failSvnSwitchTask("请输入 switch 目标 URL");
      return;
    }

    const localChanges = $workspaceStore.status?.files.length ?? 0;
    let allowLocalChanges = false;
    if (localChanges > 0) {
      const confirmed = window.confirm(
        `当前工作副本有 ${localChanges} 个本地改动。继续 svn switch 可能产生冲突，确定执行吗？`,
      );
      if (!confirmed) {
        return;
      }
      allowLocalChanges = true;
    }

    const task = await taskStore.createSvnSwitch({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      targetUrl,
      allowLocalChanges,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failSvnSwitchTask($taskStore.error?.message ?? "svn switch 任务创建失败");
      return;
    }

    workspaceStore.markSvnSwitchTask(task.task_id);
  }

  async function setSvnLogFileOnlyAndRefresh(value: boolean) {
    workspaceStore.setSvnLogFileOnly(value);
    await workspaceStore.refreshSvnLog(currentSvnExecutable());
  }

  async function openWorkspaceUpdatePage() {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (!workingCopyRoot) {
      return;
    }

    if (
      inlineUpdateRoot &&
      inlineUpdateTaskId &&
      isSameWorkingCopyRoot(inlineUpdateRoot, workingCopyRoot)
    ) {
      inlineUpdateMinimized = false;
      return;
    }

    const task = await runSvnOperation("update");
    if (!task) {
      commandError = $taskStore.error;
      return;
    }

    inlineUpdateRoot = workingCopyRoot;
    inlineUpdateTaskId = task.task_id;
    inlineUpdateTask = task;
    inlineUpdateMinimized = false;
    inlineUpdateRefreshSignature = "";
  }

  async function refreshInlineUpdateTask(taskId: string) {
    const generation = ++inlineUpdateRefreshGeneration;
    const task = await taskStore.getTaskById(taskId);
    if (
      generation === inlineUpdateRefreshGeneration &&
      inlineUpdateTaskId === taskId &&
      task
    ) {
      inlineUpdateTask = task;
    }
  }

  function closeInlineUpdate() {
    inlineUpdateRefreshGeneration += 1;
    inlineUpdateRoot = null;
    inlineUpdateTaskId = null;
    inlineUpdateTask = null;
    inlineUpdateMinimized = false;
    inlineUpdateRefreshSignature = "";
  }

  async function runMerge() {
    if (!$workspaceStore.current) {
      workspaceStore.failMergeTask("请先打开 SVN 工作副本");
      return;
    }

    const form = $workspaceStore.mergeForm;
    if (!form.sourceUrl.trim()) {
      workspaceStore.failMergeTask("请输入 merge 源 URL");
      return;
    }
    if (isSameRepositoryUrl(form.sourceUrl, $workspaceStore.current.repository_url)) {
      workspaceStore.failMergeTask("Merge 源 URL 不能和当前工作副本 URL 相同");
      return;
    }
    if (form.recordOnly && form.ignoreAncestry) {
      workspaceStore.failMergeTask("Record only 不能与 Ignore ancestry 同时使用");
      return;
    }

    const task = await taskStore.createMerge({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      sourceUrl: form.sourceUrl,
      startRevision: form.startRevision,
      endRevision: form.endRevision,
      dryRun: form.dryRun,
      recordOnly: form.recordOnly,
      ignoreAncestry: form.ignoreAncestry,
      force: form.force,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failMergeTask($taskStore.error?.message ?? "Merge 任务创建失败");
      return;
    }

    workspaceStore.markMergeTask(task.task_id);
  }

  async function chooseAndPreflightPatch() {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (!workingCopyRoot) {
      return;
    }

    commandError = null;
    try {
      const patchFilePath = await choosePatchFile();
      if (!patchFilePath) {
        return;
      }
      if ($workspaceStore.current?.working_copy_root !== workingCopyRoot) {
        commandError = {
          code: "PATCH_WORKSPACE_CHANGED",
          message: "工作副本已发生切换，请重新选择 Patch",
          detail: null,
          recoverable: true,
        };
        return;
      }
      workspaceStore.openApplyPatchDialog(patchFilePath, workingCopyRoot);
      await runApplyPatch(true);
    } catch (error) {
      commandError = {
        code: "PATCH_FILE_PICKER_FAILED",
        message: error instanceof Error ? error.message : "无法选择 Patch 文件",
        detail: null,
        recoverable: true,
      };
    }
  }

  async function runApplyPatch(dryRun: boolean) {
    const current = $workspaceStore.current;
    const patchFilePath = $workspaceStore.applyPatchFilePath;
    const workingCopyRoot = $workspaceStore.applyPatchWorkingCopyRoot;
    if (
      !current ||
      !patchFilePath ||
      !workingCopyRoot ||
      current.working_copy_root !== workingCopyRoot
    ) {
      workspaceStore.failApplyPatchTask("请先选择 Patch 文件和 SVN 工作副本");
      return;
    }

    const preflightResult = $workspaceStore.applyPatchResult;
    if (
      !dryRun &&
      (!preflightResult?.dry_run ||
        !preflightResult.patch_digest ||
        preflightResult.applied === 0 ||
        preflightResult.rejected > 0 ||
        preflightResult.skipped > 0 ||
        preflightResult.conflicted > 0 ||
        $workspaceStore.applyPatchError)
    ) {
      workspaceStore.failApplyPatchTask("Patch 预检结果已失效，请重新预检");
      return;
    }

    if (!workspaceStore.beginApplyPatchTask(dryRun)) {
      return;
    }

    const task = await taskStore.createApplyPatch({
      workingCopyRoot,
      patchFilePath,
      dryRun,
      expectedPatchDigest: dryRun ? undefined : preflightResult?.patch_digest,
      svnExecutable: currentSvnExecutable(),
    });
    if (!task) {
      workspaceStore.failApplyPatchTask($taskStore.error?.message ?? "Patch 任务创建失败");
      return;
    }

    workspaceStore.markApplyPatchTask(task.task_id, dryRun);
  }

  async function handleStartupIntent(intent: StartupIntent) {
    const targetPath = intent.path?.trim();
    if (targetPath) {
      workspaceStore.setPathInput(targetPath);
      const workspace = await workspaceStore.openPath(currentSvnExecutable());
      if (workspace) {
        await workspaceStore.selectStartupTargetFile(
          targetPath,
          currentSvnExecutable(),
        );
      }
    }

    switch (intent.action) {
      case "diff":
        setActiveWorkspaceView("changes");
        break;
      case "cleanup":
        setActiveWorkspaceView("changes");
        if ($workspaceStore.current) {
          await runSvnOperation("cleanup");
        }
        break;
      case "revert":
        setActiveWorkspaceView("changes");
        break;
      case "delete":
        setActiveWorkspaceView("changes");
        if ($workspaceStore.selectedFilePath) {
          await deleteWorkspacePath($workspaceStore.selectedFilePath);
        }
        break;
      case "ignore":
        setActiveWorkspaceView("changes");
        if ($workspaceStore.selectedFilePath) {
          await ignoreWorkspacePath($workspaceStore.selectedFilePath);
        }
        break;
      case "branch-workspace":
        setActiveWorkspaceView("branches");
        break;
      default:
        if (targetPath) {
          setActiveWorkspaceView("changes");
        }
        break;
    }
  }

  async function handleAppMenuCommand(command: string) {
    const patchBusy =
      $workspaceStore.applyPatchCreating || $workspaceStore.pendingApplyPatchTaskId !== null;
    if (
      patchBusy &&
      ["open_workspace", "update_workspace", "cleanup_workspace"].includes(command)
    ) {
      backendMessage = "Patch 任务运行中，完成后才能切换或修改工作副本";
      return;
    }

    const handledPathCommand = await dispatchAppMenuPathCommand(command, appMenuState, {
      open: openSelectedFile,
      show: openSelectedFileLocation,
      commit: (path, selected) => {
        setActiveWorkspaceView("changes");
        if (selected) {
          workspaceStore.unselectCommitFile(path);
        } else {
          workspaceStore.selectCommitFile(path);
        }
      },
      update: (path) => runSvnOperation("update_path", path),
      add: (path) => runSvnOperation("add_file", path),
      resolve: async (path) => {
        setActiveWorkspaceView("changes");
        await workspaceStore.selectFile(path, currentSvnExecutable());
      },
      revert: (path) => runSvnOperation("revert_file", path),
      move: moveWorkspacePath,
      copy: copyWorkspacePath,
      ignore: ignoreWorkspacePath,
      delete: deleteWorkspacePath,
    });
    if (handledPathCommand) {
      return;
    }

    switch (command) {
      case "open_workspace":
        await workspaceStore.chooseAndOpen(currentSvnExecutable());
        await syncCurrentBranchPoolEntry();
        break;
      case "refresh_status":
        await refreshStatusAndSyncBranchPool();
        break;
      case "view_changes":
        setActiveWorkspaceView("changes");
        break;
      case "view_history":
        await selectView("history");
        break;
      case "view_repository":
        setActiveWorkspaceView("repository");
        break;
      case "view_branches":
        setActiveWorkspaceView("branches");
        break;
      case "view_settings":
        setActiveWorkspaceView("settings");
        break;
      case "update_workspace":
        openWorkspaceUpdatePage();
        break;
      case "cleanup_workspace":
        await runSvnOperation("cleanup");
        break;
      case "refresh_log":
        setActiveWorkspaceView("history");
        await workspaceStore.refreshSvnLog(currentSvnExecutable());
        break;
      case "prepare_commit":
        setActiveWorkspaceView("changes");
        break;
      case "export_diagnostics":
        await appSettingsStore.exportDiagnosticLog();
        break;
      case "about":
        backendMessage = "NovaSVN 0.1.0";
        break;
    }
  }

  function consumePendingTask(
    taskId: string | null,
    snapshot: TaskSnapshot,
    handleTask: (task: Task) => void | Promise<void>,
  ) {
    void pendingTaskCompletionCoordinator.consume(
      taskId,
      snapshot,
      (pendingTaskId) => taskStore.getTaskById(pendingTaskId),
      handleTask,
    );
  }

  async function revertWorkspaceRevisions(revisions: string[], wholeWorkspace = false) {
    const selectedRevisions = [...new Set(revisions.map((revision) => revision.trim()))]
      .filter((revision) => /^\d+$/.test(revision))
      .sort((left, right) => Number(left) - Number(right));
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    const targetPath = $workspaceStore.svnLogFileOnly
      ? $workspaceStore.selectedFilePath?.trim()
      : undefined;
    const sourceUrl = $workspaceStore.svnLog?.repository_url?.trim();
    if (
      !workingCopyRoot ||
      selectedRevisions.length === 0 ||
      (wholeWorkspace && selectedRevisions.length !== 1) ||
      ($workspaceStore.svnLogFileOnly && !targetPath) ||
      svnOperationCreationCoordinator.isCreating() ||
      $workspaceStore.pendingSvnOperationTaskId !== null
    ) {
      return false;
    }

    const revisionLabel = selectedRevisions.map((revision) => `r${revision}`).join("、");
    const batch = selectedRevisions.length > 1;
    const confirmed = window.confirm(
      wholeWorkspace
        ? `确定要把${targetPath ? "当前日志目标" : "整个工作区"}回退到 ${revisionLabel} 吗？\n${targetPath ?? workingCopyRoot}\n\n这会反向应用该目标在 ${revisionLabel} 之后的全部提交并生成本地改动，不会自动提交。\n现有本地改动会保留；如果修改了相同内容，SVN 可能产生冲突。`
        : `确定要撤销${batch ? "选中的多个 Revision" : ` ${revisionLabel}`}对当前日志目标造成的改动吗？\n${targetPath ?? workingCopyRoot}\n${batch ? `\n选中：${revisionLabel}` : ""}\n\n这会按从新到旧的顺序反向应用${batch ? "这些提交" : "该次提交"}并生成本地改动，不会自动提交，也不会回退其他 Revision。\n现有本地改动会保留；如果修改了相同内容，SVN 可能产生冲突。`,
    );
    if (!confirmed) {
      return false;
    }

    return svnOperationCreationCoordinator.create(
      () => $workspaceStore.pendingSvnOperationTaskId !== null,
      () =>
        taskStore.createRevertRevision({
          workingCopyRoot,
          targetPath,
          sourceUrl,
          ...(batch
            ? { targetRevisions: selectedRevisions }
            : { targetRevision: selectedRevisions[0] }),
          wholeWorkspace,
          svnExecutable: currentSvnExecutable(),
        }),
      (task) =>
        workspaceStore.markSvnOperationTask(
          task.task_id,
          "revert_to_revision",
          workingCopyRoot,
        ),
    );
  }

  function revertWorkspaceToRevision(revision: string, wholeWorkspace = false) {
    return revertWorkspaceRevisions([revision], wholeWorkspace);
  }

  function revertWholeWorkspaceToRevision(revision: string) {
    return revertWorkspaceToRevision(revision, true);
  }

  function revertSelectedWorkspaceRevisions(revisions: string[]) {
    return revertWorkspaceRevisions(revisions);
  }

  async function runSvnBatchOperation(
    kind: SvnBatchOperationKind,
    filePaths: string[],
    targetPath?: string,
  ) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (
      !workingCopyRoot ||
      filePaths.length === 0 ||
      svnOperationCreationCoordinator.isCreating() ||
      $workspaceStore.pendingSvnOperationTaskId !== null
    ) {
      return false;
    }

    return svnOperationCreationCoordinator.create(
      () => $workspaceStore.pendingSvnOperationTaskId !== null,
      () =>
        taskStore.createSvnBatchOperation({
          workingCopyRoot,
          kind,
          filePaths,
          targetPath,
          svnExecutable: currentSvnExecutable(),
        }),
      (task) => workspaceStore.markSvnOperationTask(task.task_id, kind, workingCopyRoot),
    );
  }

  async function moveWorkspacePath(sourcePath: string) {
    const targetPath = window.prompt(
      "请输入 Move 目标路径（相对于当前工作副本）",
      sourcePath,
    );
    if (targetPath === null || !targetPath.trim()) {
      return;
    }
    const confirmed = window.confirm(
      `确定移动工作副本路径吗？\n\n源：${sourcePath}\n目标：${targetPath}\n\n本地内容和未提交改动会一同移动，并生成可提交的 SVN Move 变更。`,
    );
    if (!confirmed) {
      return;
    }

    await runSvnOperation("move_path", sourcePath, targetPath);
  }

  function formatBatchPathList(paths: string[]) {
    const visiblePaths = paths.slice(0, 20).map((path) => `- ${path}`);
    if (paths.length > visiblePaths.length) {
      visiblePaths.push(`- 以及其他 ${paths.length - visiblePaths.length} 个路径`);
    }
    return visiblePaths.join("\n");
  }

  async function revertWorkspacePaths(paths: string[]) {
    const confirmed = window.confirm(
      `确定撤销 ${paths.length} 个工作副本路径的本地改动吗？\n\n${formatBatchPathList(paths)}\n\n这些未提交改动将无法恢复。`,
    );
    if (!confirmed) {
      return;
    }
    await runSvnBatchOperation("revert_paths", paths);
  }

  function isUnversionedWorkspacePath(filePath: string) {
    return (
      $workspaceStore.status?.files.some(
        (file) => file.path === filePath && file.status === "unversioned",
      ) ?? false
    );
  }

  function deleteKindForPath(filePath: string): SvnOperationKind {
    return isUnversionedWorkspacePath(filePath) ? "delete_unversioned_file" : "delete_path";
  }

  async function deleteWorkspacePath(filePath: string) {
    await runSvnOperation(deleteKindForPath(filePath), filePath);
  }

  async function deleteWorkspacePaths(paths: string[]) {
    const unversionedPaths = paths.filter((path) => isUnversionedWorkspacePath(path));
    const versionedPaths = paths.filter((path) => !isUnversionedWorkspacePath(path));
    const confirmMessage =
      unversionedPaths.length > 0 && versionedPaths.length > 0
        ? `确定删除 ${paths.length} 个路径吗？\n\n${formatBatchPathList(paths)}\n\n已版本控制路径会安排 SVN 删除；未版本控制文件将从磁盘永久删除，NovaSVN 无法撤销。`
        : unversionedPaths.length > 0
          ? `确定永久删除 ${unversionedPaths.length} 个未版本控制文件吗？\n\n${formatBatchPathList(unversionedPaths)}\n\n这些文件将从磁盘删除，NovaSVN 无法撤销此操作。`
          : `确定从工作副本删除 ${paths.length} 个路径吗？\n\n${formatBatchPathList(paths)}\n\n这会删除本地内容并安排 SVN 删除。目录内未版本控制内容和未提交改动可能丢失。`;
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }

    if (versionedPaths.length > 0 && unversionedPaths.length === 0) {
      await runSvnBatchOperation("delete_paths", versionedPaths);
      return;
    }

    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (
      !workingCopyRoot ||
      svnOperationCreationCoordinator.isCreating() ||
      $workspaceStore.pendingSvnOperationTaskId !== null
    ) {
      return;
    }

    await svnOperationCreationCoordinator.create(
      () => $workspaceStore.pendingSvnOperationTaskId !== null,
      async () => {
        let lastTask: Task | null = null;
        if (versionedPaths.length > 0) {
          lastTask = await taskStore.createSvnBatchOperation({
            workingCopyRoot,
            kind: "delete_paths",
            filePaths: versionedPaths,
            svnExecutable: currentSvnExecutable(),
          });
          if (!lastTask) {
            return null;
          }
        }
        for (const filePath of unversionedPaths) {
          lastTask = await taskStore.createSvnOperation({
            workingCopyRoot,
            kind: "delete_unversioned_file",
            filePath,
            svnExecutable: currentSvnExecutable(),
          });
          if (!lastTask) {
            return null;
          }
        }
        return lastTask;
      },
      (task) =>
        workspaceStore.markSvnOperationTask(
          task.task_id,
          unversionedPaths.length > 0 ? "delete_unversioned_file" : "delete_paths",
          workingCopyRoot,
        ),
    );
  }

  async function moveWorkspacePaths(paths: string[]) {
    const targetDirectory = window.prompt(
      "请输入批量 Move 目标目录（相对于当前工作副本，使用 . 表示根目录）",
      ".",
    );
    if (targetDirectory === null || !targetDirectory.trim()) {
      return;
    }
    const confirmed = window.confirm(
      `确定把 ${paths.length} 个工作副本路径移动到 ${targetDirectory} 吗？\n\n${formatBatchPathList(paths)}\n\n各路径会保留原名称，本地内容和未提交改动会一同移动。`,
    );
    if (!confirmed) {
      return;
    }
    await runSvnBatchOperation("move_paths", paths, targetDirectory);
  }

  async function copyWorkspacePath(sourcePath: string) {
    const targetPath = window.prompt(
      "请输入 Copy 目标路径（相对于当前工作副本）",
      sourcePath,
    );
    if (targetPath === null || !targetPath.trim()) {
      return;
    }
    const confirmed = window.confirm(
      `确定复制工作副本路径吗？\n\n源：${sourcePath}\n目标：${targetPath}\n\n源内容保持不变，目标会成为带历史的 SVN 新增项并进入提交目标。`,
    );
    if (!confirmed) {
      return;
    }

    await runSvnOperation("copy_path", sourcePath, targetPath);
  }

  async function ignoreWorkspacePath(path: string) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (!workingCopyRoot || $workspaceStore.svnPropertiesLoading) {
      return;
    }
    const separatorIndex = path.lastIndexOf("/");
    const ruleDirectory = separatorIndex >= 0 ? path.slice(0, separatorIndex) || "." : ".";
    const confirmed = window.confirm(
      `确定 Ignore 此工作副本路径吗？\n\n目标：${path}\n规则作用目录：${ruleDirectory}\n\nNovaSVN 会把名称追加到该目录的 svn:ignore 属性，已有规则会保留。`,
    );
    if (!confirmed) {
      return;
    }

    const properties = await workspaceStore.ignorePath(path, currentSvnExecutable());
    if (!properties) {
      return;
    }
    await refreshStatusAndSyncBranchPool(workingCopyRoot);
  }

  async function applyWorkspaceChangelist(paths: string[], changelist: string | null) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (!workingCopyRoot || changelistRunning || paths.length === 0) {
      return;
    }

    changelistRunning = true;
    commandError = null;
    try {
      await setWorkspaceChangelist({
        working_copy_root: workingCopyRoot,
        file_paths: paths,
        changelist: changelist ?? undefined,
        svn_executable: currentSvnExecutable(),
      });
      await refreshStatusAndSyncBranchPool(workingCopyRoot);
    } catch (error) {
      commandError = error as CommandError;
    } finally {
      changelistRunning = false;
    }
  }

  function assignWorkspaceChangelist(paths: string[]) {
    const currentNames = new Set(
      paths.flatMap((path) => {
        const name = $workspaceStore.status?.files.find((file) => file.path === path)?.changelist;
        return name ? [name] : [];
      }),
    );
    const defaultName = currentNames.size === 1 ? [...currentNames][0] : "";
    const name = window.prompt("请输入 Changelist 名称", defaultName);
    if (name === null) {
      return;
    }
    if (!name.trim()) {
      commandError = {
        code: "SVN_CHANGELIST_NAME_EMPTY",
        message: "Changelist 名称不能为空",
        detail: null,
        recoverable: true,
      };
      return;
    }
    void applyWorkspaceChangelist(paths, name.trim());
  }

  function removeWorkspaceChangelist(paths: string[]) {
    void applyWorkspaceChangelist(paths, null);
  }

  $: consumePendingTask($workspaceStore.pendingCommitTaskId, $taskStore.snapshot, (task) => {
    if (task.status === "success") {
      const committedPaths = $workspaceStore.pendingCommitFiles;
      const workingCopyRoot = $workspaceStore.pendingCommitWorkingCopyRoot;
      const isCurrentWorkspace =
        !!workingCopyRoot &&
        workingCopyRoot === $workspaceStore.current?.working_copy_root;
      if (isCurrentWorkspace) {
        workspaceStore.clearCommittedFiles(committedPaths);
        void refreshStatusAndSyncBranchPool(workingCopyRoot);
      } else {
        workspaceStore.markCommitTask(null);
      }
      return;
    }

    if (task.status === "cancelled") {
      workspaceStore.failCommitTask(task.error ?? "提交任务已取消");
      return;
    }
    if (task.status === "interrupted") {
      workspaceStore.failCommitTask(
        task.error ?? "提交任务已中断，请检查工作副本状态后重试",
      );
      return;
    }
    workspaceStore.failCommitTask(task.error ?? "提交任务失败");
  });

  $: consumePendingTask(
    $workspaceStore.pendingPartialCommitTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status === "success") {
        const workingCopyRoot = $workspaceStore.current?.working_copy_root;
        workspaceStore.completePartialCommit();
        if (workingCopyRoot) {
          void refreshStatusAndSyncBranchPool(workingCopyRoot);
        }
        return;
      }

      workspaceStore.markPartialCommitTask(null);
    },
  );

  $: consumePendingSvnOperationCompletion(
    $workspaceStore.pendingSvnOperationTaskId,
    $workspaceStore.pendingSvnOperationKind,
    $workspaceStore.pendingSvnOperationWorkingCopyRoot,
    $workspaceStore.current?.working_copy_root ?? null,
    $taskStore,
    {
      clearPending: () => workspaceStore.markSvnOperationTask(null, null, null),
      refreshWorkspace: (workingCopyRoot) => {
        void workspaceStore
          .openPath(currentSvnExecutable(), workingCopyRoot)
          .then(() => syncCurrentBranchPoolEntry());
      },
      refreshStatus: (workingCopyRoot) => {
        void refreshStatusAndSyncBranchPool(workingCopyRoot);
      },
      notifyCompletion: (completion) => {
        if (!tracksOperationFeedback(completion.operationKind)) {
          return;
        }
        const successful = completion.status === "success";
        showSvnOperationFeedback({
          kind: completion.operationKind,
          phase: successful ? "success" : "error",
          title: trackedOperationTitle(completion.operationKind),
          detail: successful
            ? "操作已完成，工作副本状态正在刷新"
            : completion.error ??
              (completion.status === "cancelled" ? "操作已取消" : "操作未完成，请检查任务日志"),
        });
      },
    },
  );

  async function checkMissingSvnOperationTask(taskId: string) {
    if (missingSvnOperationTaskChecks.has(taskId)) {
      return;
    }

    missingSvnOperationTaskChecks.add(taskId);
    const missing = await taskStore.confirmTaskMissing(taskId);
    missingSvnOperationTaskChecks.delete(taskId);
    if (!missing || $workspaceStore.pendingSvnOperationTaskId !== taskId) {
      return;
    }

    workspaceStore.failSvnOperationTask(
      "运行中的 SVN 操作已从任务队列中消失，可能是后端已重启；请刷新工作副本后重试",
    );
  }

  $: if (
    $workspaceStore.pendingSvnOperationTaskId &&
    !$taskStore.loading &&
    !$taskStore.error &&
    !$taskStore.snapshot.tasks.some(
      (task) => task.task_id === $workspaceStore.pendingSvnOperationTaskId,
    )
  ) {
    void checkMissingSvnOperationTask($workspaceStore.pendingSvnOperationTaskId);
  }

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryListTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryList(task.error ?? "仓库目录加载失败");
        return;
      }

      const result = task.result?.repository_list;
      if (result) {
        workspaceStore.applyRepositoryListResult(result);
      } else {
        workspaceStore.failRepositoryList("仓库目录任务没有返回结果");
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryFileTaskId,
    $taskStore.snapshot,
    async (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryFile(task.error ?? "仓库文件下载失败");
        return;
      }

      const result = task.result?.repository_file;
      if (!result) {
        workspaceStore.failRepositoryFile("仓库文件任务没有返回结果");
        return;
      }

      try {
        await openRepositoryTempFile({ path: result.file_path });
        workspaceStore.completeRepositoryFile(result);
      } catch (error) {
        workspaceStore.failRepositoryFile(
          (error as CommandError).message ?? "仓库文件临时副本打开失败",
        );
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryCopyTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status === "success") {
        const parentUrl = get(workspaceStore).pendingRepositoryCopyParentUrl;
        workspaceStore.completeRepositoryCopyTask();
        if (parentUrl) {
          refreshRepositoryAfterWrite(parentUrl);
        }
      } else {
        workspaceStore.failRepositoryCopyTask(task.error ?? "Repository Copy 失败");
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryMkdirTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryMkdirTask(task.error ?? "创建仓库目录失败");
        return;
      }
      const parentUrl = get(workspaceStore).pendingRepositoryMkdirParentUrl;
      workspaceStore.completeRepositoryMkdirTask();
      if (parentUrl) {
        refreshRepositoryAfterWrite(parentUrl);
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryImportTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryImportTask(task.error ?? "Repository Import 失败");
        return;
      }
      const parentUrl = get(workspaceStore).pendingRepositoryImportParentUrl;
      workspaceStore.completeRepositoryImportTask();
      if (parentUrl) {
        refreshRepositoryAfterWrite(parentUrl);
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryMoveTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryMoveTask(task.error ?? "Repository Move 失败");
        return;
      }
      const state = get(workspaceStore);
      const sourceParentUrl = state.pendingRepositoryMoveSourceParentUrl;
      const targetParentUrl = state.pendingRepositoryMoveTargetParentUrl;
      const refreshUrl = isSameRepositoryUrl(state.repositoryCurrentUrl, sourceParentUrl)
        ? sourceParentUrl
        : targetParentUrl || sourceParentUrl;
      workspaceStore.completeRepositoryMoveTask();
      if (refreshUrl) {
        refreshRepositoryAfterWrite(refreshUrl);
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryDeleteTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryDeleteTask(task.error ?? "Repository Delete 失败");
        return;
      }
      const parentUrl = get(workspaceStore).pendingRepositoryDeleteParentUrl;
      workspaceStore.completeRepositoryDeleteTask();
      if (parentUrl) {
        refreshRepositoryAfterWrite(parentUrl);
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryCheckoutTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryCheckoutTask(task.error ?? "仓库 Checkout 失败");
        return;
      }

      const localPath = get(workspaceStore).pendingRepositoryCheckoutLocalPath;
      workspaceStore.completeRepositoryCheckoutTask();
      if (localPath) {
        void workspaceStore.openPath(currentSvnExecutable(), localPath);
        setActiveWorkspaceView("changes");
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRepositoryExportTaskId,
    $taskStore.snapshot,
    async (task) => {
      if (task.status !== "success") {
        workspaceStore.failRepositoryExportTask(task.error ?? "仓库 Export 失败");
        return;
      }

      const localPath = get(workspaceStore).pendingRepositoryExportLocalPath;
      workspaceStore.completeRepositoryExportTask();
      if (!localPath) {
        return;
      }

      try {
        await openLocalPathLocation({ path: localPath });
      } catch (error) {
        workspaceStore.failRepositoryExportTask(
          (error as CommandError).message ?? "导出成功，但无法打开本地路径位置",
        );
      }
    },
  );

  $: consumePendingTask(
    pendingRepositoryDragExportTaskId,
    $taskStore.snapshot,
    async (task) => {
      pendingRepositoryDragExportTaskId = null;
      repositoryDragExportRunningName = null;
      if (task.status !== "success") {
        repositoryDragExportError = task.error ?? "仓库拖出 Export 失败";
        return;
      }
      const result = task.result?.repository_export;
      if (!result) {
        repositoryDragExportError = "仓库拖出 Export 任务没有返回本地产物";
        return;
      }
      repositoryDragExportPrepared = result;
      repositoryDragExportError = null;
      if ($currentView === "repository") {
        await startRepositoryEntryDrag(result);
      }
    },
  );

  $: consumePendingTask(
    $branchPoolStore.pendingCheckoutTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status === "success") {
        void branchPoolStore.completeCheckoutTask();
      } else {
        branchPoolStore.failCheckoutTask(task.error ?? "分支 checkout 失败");
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingSvnSwitchTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status === "success") {
        workspaceStore.markSvnSwitchTask(null);
        void workspaceStore.openPath(currentSvnExecutable());
      } else {
        workspaceStore.failSvnSwitchTask(task.error ?? "svn switch 失败");
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingRevisionDiffTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failRevisionDiffTask(task.error ?? "Revision diff 失败");
        return;
      }

      const result = task.result?.revision_diff;
      if (result) {
        workspaceStore.applyRevisionDiffResult(result);
      } else {
        workspaceStore.failRevisionDiffTask("Revision diff 任务没有返回结果");
      }
    },
  );

  $: consumePendingTask(
    $workspaceStore.pendingMergeTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status !== "success") {
        workspaceStore.failMergeTask(task.error ?? "Merge 执行失败");
        return;
      }

      const workingCopyRoot = $workspaceStore.current?.working_copy_root;
      const mergeResult = task.result?.merge_result;
      if (!mergeResult) {
        workspaceStore.failMergeTask("Merge 任务没有返回结果");
        return;
      }

      workspaceStore.completeMergeTask(mergeResult);
      if (workingCopyRoot && !mergeResult.dry_run) {
        void refreshStatusAndSyncBranchPool(workingCopyRoot).then((status) => {
          if ((status?.conflicted ?? 0) > 0) {
            setActiveWorkspaceView("changes");
            workspaceStore.focusConflictResolution();
          }
        });
      }
    },
  );

  async function checkApplyPatchTask(taskId: string) {
    if (applyPatchTaskChecks.has(taskId)) {
      return;
    }

    applyPatchTaskChecks.add(taskId);
    try {
      const task = await taskStore.getTaskById(taskId);
      if (!task) {
        return;
      }

      if (task.status === "success") {
        const result = task.result?.apply_patch_result;
        if (!result) {
          workspaceStore.failApplyPatchTask("Patch 任务没有返回结果");
          return;
        }

        workspaceStore.completeApplyPatchTask(result);
        if (!result.dry_run) {
          const workingCopyRoot = $workspaceStore.applyPatchWorkingCopyRoot;
          if (workingCopyRoot) {
            void refreshStatusAndSyncBranchPool(workingCopyRoot).then((status) => {
              if ((status?.conflicted ?? 0) > 0 || result.conflicted > 0) {
                setActiveWorkspaceView("changes");
                workspaceStore.focusConflictFilter();
              }
            });
          }
        }
        return;
      }

      if (
        task.status === "failed" ||
        task.status === "cancelled" ||
        task.status === "interrupted"
      ) {
        const result = task.result?.apply_patch_result;
        if (result) {
          workspaceStore.completeApplyPatchTask(result);
        }
        workspaceStore.failApplyPatchTask(task.error ?? "Patch 执行失败");
        if (result && !result.dry_run) {
          const workingCopyRoot = $workspaceStore.applyPatchWorkingCopyRoot;
          if (workingCopyRoot) {
            void refreshStatusAndSyncBranchPool(workingCopyRoot);
          }
        }
      }
    } finally {
      applyPatchTaskChecks.delete(taskId);
    }
  }

  $: if ($workspaceStore.pendingApplyPatchTaskId) {
    const patchTask = $taskStore.snapshot.tasks.find(
      (task) => task.task_id === $workspaceStore.pendingApplyPatchTaskId,
    );
    if (
      patchTask &&
      (patchTask.status === "success" ||
        patchTask.status === "failed" ||
        patchTask.status === "cancelled" ||
        patchTask.status === "interrupted")
    ) {
      void checkApplyPatchTask(patchTask.task_id);
    }
  }

  async function checkRepositoryLayoutTask(
    kind: "trunk" | "branches" | "tags",
    taskId: string,
  ) {
    if (repositoryLayoutTaskChecks.has(taskId)) {
      return;
    }

    repositoryLayoutTaskChecks.add(taskId);
    const task = await taskStore.getTaskById(taskId);
    repositoryLayoutTaskChecks.delete(taskId);
    if (!task) {
      return;
    }

    if (task.status === "success") {
      const result = task.result?.repository_list;
      if (result) {
        workspaceStore.applyRepositoryLayoutResult(kind, result);
      } else {
        workspaceStore.failRepositoryLayoutResult(kind, "仓库布局任务没有返回结果");
      }
      return;
    }

    if (
      task.status === "failed" ||
      task.status === "cancelled" ||
      task.status === "interrupted"
    ) {
      workspaceStore.failRepositoryLayoutResult(kind, task.error ?? "仓库布局识别失败");
    }
  }

  $: for (const kind of ["trunk", "branches", "tags"] as const) {
    const taskId = $workspaceStore.repositoryLayoutTasks[kind];
    if (taskId) {
      void checkRepositoryLayoutTask(kind, taskId);
    }
  }

  async function initializeTauriApp() {
    await restoreRememberedSvnAuthentication();
    await svnStore.detectWithInputFallback();
    let intent: StartupIntent;
    try {
      intent = await getStartupIntent();
    } catch (error) {
      commandError = error as CommandError;
      intent = {
        action: null,
        path: null,
        repository_root: null,
        revision: null,
        return_action: null,
        preview_id: null,
      };
    }

    window.addEventListener("contextmenu", preventNativeContextMenu, true);

    if (intent.action === "blame") {
      standaloneBlamePath = intent.path?.trim() ?? "";
      standaloneBlameRevision = intent.revision?.trim() || undefined;
      startupSurface = "blame";
      standaloneBlameReady = true;
      return;
    }

    if (intent.action === "browse") {
      standaloneBrowsePath = intent.path?.trim() ?? "";
      standaloneBrowseRevision = intent.revision?.trim() || undefined;
      startupSurface = "browse";
      standaloneBrowseReady = true;
      return;
    }

    if (intent.action === "log") {
      standaloneLogPath = intent.path?.trim() ?? "";
      standaloneLogRepositoryRoot = intent.repository_root?.trim() || undefined;
      standaloneLogRevision = intent.revision?.trim() || undefined;
      startupSurface = "log";
      standaloneLogReady = true;
      return;
    }

    if (intent.action === "commit") {
      standaloneCommitPath = intent.path?.trim() ?? "";
      startupSurface = "commit";
      standaloneCommitReady = true;
      return;
    }

    if (intent.action === "cleanup") {
      standaloneCleanupPath = intent.path?.trim() ?? "";
      startupSurface = "cleanup";
      standaloneCleanupReady = true;
      return;
    }

    if (intent.action === "merge-preview") {
      standaloneMergePreviewId = intent.preview_id?.trim() ?? "";
      startupSurface = "merge-preview";
      standaloneMergePreviewReady = true;
      return;
    }

    if (intent.action === "revert") {
      standaloneRevertPath = intent.path?.trim() ?? "";
      startupSurface = "revert";
      standaloneRevertReady = true;
      return;
    }

    if (intent.action === "info") {
      standaloneInfoPath = intent.path?.trim() ?? "";
      startupSurface = "info";
      standaloneInfoReady = true;
      return;
    }

    if (intent.action === "checkout") {
      standaloneCheckoutPath = intent.path?.trim() ?? "";
      startupSurface = "checkout";
      standaloneCheckoutReady = true;
      return;
    }

    if (intent.action === "update") {
      standaloneUpdatePath = intent.path?.trim() ?? "";
      standaloneUpdateReturnAction = intent.return_action?.trim() || null;
      startupSurface = "update";
      standaloneUpdateReady = true;
      return;
    }

    if (intent.action === "resolve") {
      standaloneConflictPath = intent.path?.trim() ?? "";
      startupSurface = "resolve";
      standaloneConflictReady = true;
      return;
    }

    startupSurface = "main";
    void listen<string>("novasvn-menu", (event) => {
      void handleAppMenuCommand(event.payload);
    }).then((unlisten) => {
      unlistenAppMenu = unlisten;
    });
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if ($currentView !== "repository") {
          repositoryImportDropActive = false;
          return;
        }
        if (event.payload.type === "enter" || event.payload.type === "over") {
          repositoryImportDropActive = true;
          return;
        }
        repositoryImportDropActive = false;
        if (event.payload.type !== "drop") {
          return;
        }
        if (event.payload.paths.length !== 1) {
          workspaceStore.failRepositoryImportTask("每次只能拖入一个文件或目录");
          return;
        }
        workspaceStore.prepareRepositoryImportFromDrop(event.payload.paths[0]);
      })
      .then((unlisten) => {
        unlistenDragDrop = unlisten;
      });
    taskStore.startPolling();
    void branchPoolStore.load();
    void taskWorkspaceStore.load();
    void pingBackend();
    if (intent.path?.trim()) {
      await handleStartupIntent(intent);
    } else {
      await workspaceStore.loadRecent(currentSvnExecutable());
      await handleStartupIntent(intent);
    }
  }

  function startupSurfaceIsLoading() {
    return startupSurface === "loading" ||
      (startupSurface === "blame" && !standaloneBlameReady) ||
      (startupSurface === "browse" && !standaloneBrowseReady) ||
      (startupSurface === "checkout" && !standaloneCheckoutReady) ||
      (startupSurface === "cleanup" && !standaloneCleanupReady) ||
      (startupSurface === "commit" && !standaloneCommitReady) ||
      (startupSurface === "log" && !standaloneLogReady) ||
      (startupSurface === "merge-preview" && !standaloneMergePreviewReady) ||
      (startupSurface === "revert" && !standaloneRevertReady) ||
      (startupSurface === "update" && !standaloneUpdateReady) ||
      (startupSurface === "resolve" && !standaloneConflictReady) ||
      (startupSurface === "info" && !standaloneInfoReady);
  }

  async function openStandaloneRepoBrowser() {
    const target =
      $workspaceStore.repositoryList?.url?.trim() ||
      $workspaceStore.repositoryUrlInput.trim() ||
      $workspaceStore.current?.repository_url?.trim() ||
      $workspaceStore.current?.repository_root?.trim() ||
      "";
    if (!target) {
      workspaceStore.failRepositoryList("请输入仓库 URL 或先打开 SVN 工作副本");
      return;
    }
    try {
      await launchRepoBrowserWindow({
        target_path: target,
        revision: $workspaceStore.repositoryRevisionInput.trim() || undefined,
      });
    } catch (error) {
      workspaceStore.failRepositoryList(
        (error as CommandError)?.message ?? "无法打开独立 Repository Browser",
      );
    }
  }

  function handleStartupEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented || !startupSurfaceIsLoading()) {
      return;
    }
    event.preventDefault();
    void getCurrentWindow().close();
  }

  onMount(() => {
    window.addEventListener("keydown", preventBrowserFindShortcut, true);
    window.addEventListener("keydown", handleStartupEscape);
    appSettingsStore.load();
    if (hasTauriRuntime()) {
      void initializeTauriApp();
    } else {
      backendMessage = "浏览器预览模式";
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", preventBrowserFindShortcut, true);
    window.removeEventListener("keydown", handleStartupEscape);
    window.removeEventListener("contextmenu", preventNativeContextMenu, true);
    unlistenAppMenu?.();
    unlistenDragDrop?.();
    taskStore.stopPolling();
    if (svnOperationFeedbackTimer !== null) {
      window.clearTimeout(svnOperationFeedbackTimer);
    }
  });
</script>

{#if startupSurface === "loading" ||
  (startupSurface === "blame" && !standaloneBlameReady) ||
  (startupSurface === "browse" && !standaloneBrowseReady) ||
  (startupSurface === "checkout" && !standaloneCheckoutReady) ||
  (startupSurface === "cleanup" && !standaloneCleanupReady) ||
  (startupSurface === "commit" && !standaloneCommitReady) ||
  (startupSurface === "log" && !standaloneLogReady) ||
  (startupSurface === "merge-preview" && !standaloneMergePreviewReady) ||
  (startupSurface === "revert" && !standaloneRevertReady) ||
  (startupSurface === "update" && !standaloneUpdateReady) ||
  (startupSurface === "resolve" && !standaloneConflictReady) ||
  (startupSurface === "info" && !standaloneInfoReady)}
  <main class="startup-loading" aria-label="NovaSVN 启动中" role="status">
    <span></span>
    <p>
      {startupSurface === "blame"
        ? "正在准备 SVN Blame..."
        : startupSurface === "browse"
        ? "正在准备 Repository Browser..."
        : startupSurface === "checkout"
        ? "正在准备 SVN Checkout..."
        : startupSurface === "commit"
        ? "正在准备 SVN Commit..."
        : startupSurface === "cleanup"
        ? "正在准备 SVN Clean Up..."
        : startupSurface === "log"
        ? "正在准备 SVN Log..."
        : startupSurface === "merge-preview"
        ? "正在准备 Merge Preview..."
        : startupSurface === "revert"
        ? "正在准备 SVN Revert..."
        : startupSurface === "update"
          ? "正在准备 SVN Update..."
        : startupSurface === "resolve"
          ? "正在准备冲突处理..."
        : startupSurface === "info"
          ? "正在准备 SVN Info..."
        : "正在启动 NovaSVN..."}
    </p>
  </main>
{:else if startupSurface === "blame"}
  <StandaloneBlameWindow
    targetPath={standaloneBlamePath}
    repositoryRevision={standaloneBlameRevision}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "browse"}
  <StandaloneRepoBrowserWindow
    targetPath={standaloneBrowsePath}
    repositoryRevision={standaloneBrowseRevision}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "checkout"}
  <StandaloneCheckoutWindow
    targetPath={standaloneCheckoutPath}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "cleanup"}
  <StandaloneCleanupWindow
    targetPath={standaloneCleanupPath}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "commit"}
  <StandaloneCommitWindow
    targetPath={standaloneCommitPath}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    diffMode={$appSettingsStore.diffMode}
    showWhitespace={$appSettingsStore.showWhitespace}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "log"}
  <StandaloneLogWindow
    targetPath={standaloneLogPath}
    repositoryRoot={standaloneLogRepositoryRoot}
    repositoryRevision={standaloneLogRevision}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    diffMode={$appSettingsStore.diffMode}
    showWhitespace={$appSettingsStore.showWhitespace}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "merge-preview"}
  <StandaloneMergePreviewWindow
    previewId={standaloneMergePreviewId}
    themeMode={$appSettingsStore.themeMode}
    diffMode={$appSettingsStore.diffMode}
    showWhitespace={$appSettingsStore.showWhitespace}
  />
{:else if startupSurface === "revert"}
  <StandaloneRevertWindow
    targetPath={standaloneRevertPath}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "update"}
  <StandaloneUpdateWindow
    targetPath={standaloneUpdatePath}
    returnToCommit={standaloneUpdateReturnAction === "commit"}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "resolve"}
  <StandaloneConflictWindow
    targetPath={standaloneConflictPath}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    externalMergeTool={$appSettingsStore.externalMergeTool}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else if startupSurface === "info"}
  <StandaloneInfoWindow
    targetPath={standaloneInfoPath}
    svnExecutable={currentSvnExecutable()}
    themeMode={$appSettingsStore.themeMode}
    svnAuthenticationUsername={$appSettingsStore.svnUsername}
    svnRememberPassword={$appSettingsStore.svnRememberPassword}
    {svnAuthenticationLoading}
    {svnAuthenticationError}
    onSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  />
{:else}
<MainWorkspace
  view={activeView}
  workspace={$workspaceStore.current}
  workspacePathInput={$workspaceStore.pathInput}
  workspaceLoading={$workspaceStore.loading || workspaceAdding}
  workspaceError={$workspaceStore.error}
  workingCopyStatus={$workspaceStore.status}
  workspaceFileTree={$workspaceStore.fileTree}
  svnExecutable={currentSvnExecutable()}
  searchText={$workspaceStore.searchText}
  selectedFilePath={$workspaceStore.selectedFilePath}
  selectedFile={selectedFile}
  selectedFileReviewed={selectedFileReviewed}
  commitFiles={$workspaceStore.commitFiles}
  reviewedFiles={$workspaceStore.reviewedFiles}
  statusLoading={$workspaceStore.statusLoading}
  statusError={$workspaceStore.statusError}
  {changelistRunning}
  repositoryUrlInput={$workspaceStore.repositoryUrlInput}
  repositoryRevisionInput={$workspaceStore.repositoryRevisionInput}
  repositoryList={$workspaceStore.repositoryList}
  repositoryLoading={$workspaceStore.repositoryLoading}
  repositoryError={$workspaceStore.repositoryError}
  repositoryFileLoading={
    repositoryFileCreating || $workspaceStore.repositoryFileLoading
  }
  repositoryFileError={$workspaceStore.repositoryFileError}
  repositoryFileLog={$workspaceStore.repositoryFileLog}
  repositoryFileLogRevision={$workspaceStore.repositoryFileLogRevision}
  repositoryFileLogLoading={$workspaceStore.repositoryFileLogLoading}
  repositoryFileLogError={$workspaceStore.repositoryFileLogError}
  repositoryFileBlame={$workspaceStore.repositoryFileBlame}
  repositoryFileBlameRevision={$workspaceStore.repositoryFileBlameRevision}
  repositoryFileBlameLoading={$workspaceStore.repositoryFileBlameLoading}
  repositoryFileBlameError={$workspaceStore.repositoryFileBlameError}
  repositoryFileProperties={$workspaceStore.repositoryFileProperties}
  repositoryFilePropertiesRevision={$workspaceStore.repositoryFilePropertiesRevision}
  repositoryFilePropertiesLoading={$workspaceStore.repositoryFilePropertiesLoading}
  repositoryFilePropertiesError={$workspaceStore.repositoryFilePropertiesError}
  repositoryLayout={$workspaceStore.repositoryLayout}
  repositoryLayoutResults={$workspaceStore.repositoryLayoutResults}
  repositoryLayoutErrors={$workspaceStore.repositoryLayoutErrors}
  repositoryLayoutLoading={$workspaceStore.repositoryLayoutLoading}
  repositoryCopyForm={$workspaceStore.repositoryCopyForm}
  repositoryCopyError={$workspaceStore.repositoryCopyError}
  repositoryCopyRunning={$workspaceStore.pendingRepositoryCopyTaskId !== null}
  repositoryMkdirForm={$workspaceStore.repositoryMkdirForm}
  repositoryMkdirError={$workspaceStore.repositoryMkdirError}
  repositoryMkdirRunning={$workspaceStore.pendingRepositoryMkdirTaskId !== null}
  repositoryImportForm={$workspaceStore.repositoryImportForm}
  repositoryImportError={$workspaceStore.repositoryImportError}
  repositoryImportRunning={$workspaceStore.pendingRepositoryImportTaskId !== null}
  repositoryImportDropActive={repositoryImportDropActive}
  repositoryDragExportRunning={
    repositoryDragExportStarting || pendingRepositoryDragExportTaskId !== null
  }
  repositoryDragExportError={repositoryDragExportError}
  repositoryDragExportRunningName={repositoryDragExportRunningName}
  repositoryMoveForm={$workspaceStore.repositoryMoveForm}
  repositoryMoveError={$workspaceStore.repositoryMoveError}
  repositoryMoveRunning={$workspaceStore.pendingRepositoryMoveTaskId !== null}
  repositoryRenameForm={$workspaceStore.repositoryRenameForm}
  repositoryRenameError={$workspaceStore.repositoryRenameError}
  repositoryRenameRunning={
    $workspaceStore.pendingRepositoryMoveTaskId !== null &&
    $workspaceStore.pendingRepositoryMoveKind === "rename"
  }
  repositoryDeleteForm={$workspaceStore.repositoryDeleteForm}
  repositoryDeleteError={$workspaceStore.repositoryDeleteError}
  repositoryDeleteRunning={$workspaceStore.pendingRepositoryDeleteTaskId !== null}
  repositoryCheckoutForm={$workspaceStore.repositoryCheckoutForm}
  repositoryCheckoutError={$workspaceStore.repositoryCheckoutError}
  repositoryCheckoutRunning={$workspaceStore.pendingRepositoryCheckoutTaskId !== null}
  repositoryExportForm={$workspaceStore.repositoryExportForm}
  repositoryExportError={$workspaceStore.repositoryExportError}
  repositoryExportRunning={$workspaceStore.pendingRepositoryExportTaskId !== null}
  svnLog={$workspaceStore.svnLog}
  svnLogLoading={$workspaceStore.svnLogLoading}
  svnLogError={$workspaceStore.svnLogError}
  svnLogAuthorFilter={$workspaceStore.svnLogAuthorFilter}
  svnLogKeywordFilter={$workspaceStore.svnLogKeywordFilter}
  svnLogDateFromFilter={$workspaceStore.svnLogDateFromFilter}
  svnLogDateToFilter={$workspaceStore.svnLogDateToFilter}
  svnLogFileOnly={$workspaceStore.svnLogFileOnly}
  svnLogLimit={$workspaceStore.svnLogLimit}
  branchPool={$branchPoolStore.pool}
  branchPoolForm={$branchPoolStore.form}
  branchPoolFormErrors={$branchPoolStore.formErrors}
  branchPoolLoading={$branchPoolStore.loading}
  branchPoolError={$branchPoolStore.error}
  branchCheckoutError={$branchPoolStore.checkoutError}
  branchCheckoutRunning={$branchPoolStore.pendingCheckoutTaskId !== null}
  mergeForm={$workspaceStore.mergeForm}
  mergeRunning={$workspaceStore.pendingMergeTaskId !== null}
  mergeError={$workspaceStore.mergeError}
  mergeResult={$workspaceStore.mergeResult}
  applyPatchDialogOpen={$workspaceStore.applyPatchDialogOpen}
  applyPatchFilePath={$workspaceStore.applyPatchFilePath}
  applyPatchRunning={
    $workspaceStore.applyPatchCreating || $workspaceStore.pendingApplyPatchTaskId !== null
  }
  applyPatchResult={$workspaceStore.applyPatchResult}
  applyPatchError={$workspaceStore.applyPatchError}
  taskWorkspaces={$taskWorkspaceStore.list}
  activeTaskWorkspaceId={$taskWorkspaceStore.activeTaskId}
  selectedFileDiff={$workspaceStore.selectedFileDiff}
  selectedFileContentDiff={$workspaceStore.selectedFileContentDiff}
  selectedFileParsedDiff={$workspaceStore.selectedFileParsedDiff}
  selectedHunkIds={selectedHunkIds}
  selectedPatch={$workspaceStore.selectedPatch}
  svnBlame={$workspaceStore.svnBlame}
  svnBlameLoading={$workspaceStore.svnBlameLoading}
  svnBlameError={$workspaceStore.svnBlameError}
  diffLoading={$workspaceStore.diffLoading}
  contentDiffLoading={$workspaceStore.contentDiffLoading}
  {conflictResolutionSaving}
  selectedPatchLoading={$workspaceStore.selectedPatchLoading}
  diffError={$workspaceStore.diffError}
  contentDiffError={$workspaceStore.contentDiffError}
  {conflictResolutionError}
  parsedDiffError={$workspaceStore.parsedDiffError}
  selectedPatchError={$workspaceStore.selectedPatchError}
  safetyCheck={$workspaceStore.safetyCheck}
  svnProperties={$workspaceStore.svnProperties}
  svnPropertiesLoading={$workspaceStore.svnPropertiesLoading}
  svnPropertiesError={$workspaceStore.svnPropertiesError}
  propertyEditForm={$workspaceStore.propertyEditForm}
  commitTemplate={$workspaceStore.commitTemplate}
  commitHistory={$workspaceStore.commitHistory}
  commitMessage={$workspaceStore.commitMessage}
  commitError={$workspaceStore.commitError}
  commitFormOpenDisabled={
    committableChangeCount === 0 ||
    $taskStore.snapshot.running_task_id !== null
  }

  commitDisabled={
    $workspaceStore.commitFiles.length === 0 ||
    commitSafetyBlocked ||
    $taskStore.snapshot.running_task_id !== null
  }
  partialCommitDisabled={
    !$workspaceStore.selectedPatch ||
    commitSafetyBlocked ||
    $taskStore.snapshot.running_task_id !== null
  }
  tasks={$taskStore.snapshot.tasks}
  selectedTask={$taskStore.selectedTask}
  runningTaskId={$taskStore.snapshot.running_task_id}
  pendingSvnOperationKind={currentPendingSvnOperationKind}
  inlineUpdateRoot={inlineUpdateVisible ? inlineUpdateRoot : null}
  inlineUpdateTask={inlineUpdateVisible ? inlineUpdateTask : null}
  inlineUpdateSvnExecutable={currentSvnExecutable()}
  inlineUpdateTarget={inlineUpdateVisible && $workspaceStore.current
    ? {
        target_path: $workspaceStore.current.working_copy_root,
        working_copy_root: $workspaceStore.current.working_copy_root,
        relative_path: null,
        repository_url: $workspaceStore.current.repository_url,
        repository_root: $workspaceStore.current.repository_root,
        revision: $workspaceStore.current.revision,
        kind: "dir",
      }
    : null}
  {inlineUpdateMinimized}
  {svnOperationFeedback}
  taskError={$taskStore.error}
  commandError={commandError}
  svnDetection={$svnStore.detection}
  svnError={$svnStore.error}
  svnExecutableInput={$svnStore.executableInput}
  svnLoading={$svnStore.loading}
  {svnAuthenticationPassword}
  {svnAuthenticationStatus}
  {svnAuthenticationError}
  {svnAuthenticationLoading}
  onInlineSvnAuthenticationSubmit={applyPromptedSvnAuthentication}
  {svnCertificateTrustStatus}
  {svnCertificateTrustError}
  {svnCertificateTrustLoading}
  appSettings={$appSettingsStore}
  svnSwitchTargetUrl={$workspaceStore.svnSwitchTargetUrl}
  svnSwitchError={$workspaceStore.svnSwitchError}
  svnSwitchRunning={$workspaceStore.pendingSvnSwitchTaskId !== null}
  onSelectView={selectView}
  onAddWorkspace={addWorkspaceCopy}
  onChooseWorkspace={() =>
    workspaceStore
      .chooseAndOpen(currentSvnExecutable())
      .then(() => syncCurrentBranchPoolEntry(true))}
  onOpenWorkspace={() =>
    workspaceStore.openPath(currentSvnExecutable()).then(() => syncCurrentBranchPoolEntry(true))}
  onRefreshStatus={() => refreshStatusAndSyncBranchPool()}
  onUpdateWorkspace={openWorkspaceUpdatePage}
  onUpdatePath={(path) => runSvnOperation("update_path", path)}
  onCleanupWorkspace={() => runSvnOperation("cleanup")}
  onToggleInlineUpdate={() => (inlineUpdateMinimized = !inlineUpdateMinimized)}
  onCloseInlineUpdate={closeInlineUpdate}
  onDismissSvnOperationFeedback={dismissSvnOperationFeedback}
  onChooseApplyPatch={chooseAndPreflightPatch}
  onRunApplyPatch={runApplyPatch}
  onCloseApplyPatch={workspaceStore.closeApplyPatchDialog}
  onLoadMoreStatus={() => workspaceStore.loadMoreStatus(currentSvnExecutable())}
  onWorkspacePathInput={workspaceStore.setPathInput}
  onSearchTextInput={workspaceStore.setSearchText}
  onRefreshSvnBlame={() => workspaceStore.refreshSvnBlame(currentSvnExecutable())}
  onSelectFile={(path) => workspaceStore.selectFile(path, currentSvnExecutable())}
  onSelectWorkspacePath={workspaceStore.selectPathOnly}
  onActiveWorkspacePathChange={(path) => (activeWorkspacePath = path)}
  onSelectCommitFile={workspaceStore.selectCommitFile}
  onUnselectCommitFile={workspaceStore.unselectCommitFile}
  onSelectCommitFiles={workspaceStore.selectCommitFiles}
  onUnselectCommitFiles={workspaceStore.unselectCommitFiles}
  onSelectAllCommitFiles={workspaceStore.selectAllCommitFiles}
  onClearCommitFiles={workspaceStore.clearCommitFiles}
  onAddFile={(path) => runSvnOperation("add_file", path)}
  onIgnorePath={ignoreWorkspacePath}
  onDeletePath={deleteWorkspacePath}
  onMovePath={moveWorkspacePath}
  onCopyPath={copyWorkspacePath}
  onRevertFile={(path) => runSvnOperation("revert_file", path)}
  onRevertPaths={revertWorkspacePaths}
  onDeletePaths={deleteWorkspacePaths}
  onMovePaths={moveWorkspacePaths}
  onAssignChangelist={assignWorkspaceChangelist}
  onRemoveChangelist={removeWorkspaceChangelist}
  onLockFile={(path) => runSvnOperation("lock_file", path)}
  onUnlockFile={(path) => runSvnOperation("unlock_file", path)}
  onForceUnlockFile={(path) => runSvnOperation("force_unlock_file", path)}
  onResolveWorking={(path) => runSvnOperation("resolve_working", path)}
  onResolveMineFull={(path) => runSvnOperation("resolve_mine_full", path)}
  onResolveTheirsFull={(path) => runSvnOperation("resolve_theirs_full", path)}
  onSaveConflictResolution={saveConflictResolution}
  onOpenFileLocation={openSelectedFileLocation}
  onOpenWorkspaceFile={openSelectedFile}
  onLaunchExternalTool={openExternalTool}
  onMarkFileReviewed={workspaceStore.markFileReviewed}
  onMarkFileUnreviewed={workspaceStore.markFileUnreviewed}
  onToggleHunkSelection={workspaceStore.toggleHunkSelection}
  onPreviewSelectedPatch={workspaceStore.previewSelectedPatch}
  onRefreshSvnProperties={() => workspaceStore.refreshSvnProperties(currentSvnExecutable())}
  onPropertyEditInput={workspaceStore.setPropertyEditForm}
  onUsePropertyForEdit={workspaceStore.usePropertyForEdit}
  onSaveSvnProperty={saveSvnPropertyWithConfirm}
  onRepositoryUrlInput={workspaceStore.setRepositoryUrlInput}
  onRepositoryRevisionInput={workspaceStore.setRepositoryRevisionInput}
  onUseWorkspaceRepositoryRoot={workspaceStore.useWorkspaceRepositoryRoot}
  onOpenStandaloneRepoBrowser={openStandaloneRepoBrowser}
  onLoadRepositoryUrl={loadRepositoryUrl}
  onOpenRepositoryFile={openRepositoryFile}
  onLoadRepositoryFileLog={loadRepositoryFileLog}
  onLoadMoreRepositoryFileLog={() =>
    workspaceStore.loadMoreRepositoryFileLog(currentSvnExecutable())}
  onCloseRepositoryFileLog={workspaceStore.clearRepositoryFileLog}
  onLoadRepositoryFileBlame={loadRepositoryFileBlame}
  onCloseRepositoryFileBlame={workspaceStore.clearRepositoryFileBlame}
  onLoadRepositoryFileProperties={loadRepositoryFileProperties}
  onCloseRepositoryFileProperties={workspaceStore.clearRepositoryFileProperties}
  onRepositoryLayoutPathInput={workspaceStore.setRepositoryLayoutPath}
  onDetectRepositoryLayout={detectRepositoryLayout}
  onRepositoryCopyFormInput={workspaceStore.setRepositoryCopyForm}
  onPrepareRepositoryCopyTarget={workspaceStore.prepareRepositoryCopyTarget}
  onCreateRepositoryCopy={createRepositoryCopy}
  onRepositoryMkdirFormInput={workspaceStore.setRepositoryMkdirForm}
  onPrepareRepositoryMkdir={workspaceStore.prepareRepositoryMkdir}
  onCreateRepositoryMkdir={createRepositoryMkdir}
  onRepositoryImportFormInput={workspaceStore.setRepositoryImportForm}
  onPrepareRepositoryImport={workspaceStore.prepareRepositoryImport}
  onChooseRepositoryImportSource={workspaceStore.chooseRepositoryImportSource}
  onCreateRepositoryImport={createRepositoryImport}
  onRepositoryMoveFormInput={workspaceStore.setRepositoryMoveForm}
  onPrepareRepositoryMove={workspaceStore.prepareRepositoryMove}
  onCreateRepositoryMove={createRepositoryMove}
  onRepositoryRenameFormInput={workspaceStore.setRepositoryRenameForm}
  onPrepareRepositoryRename={workspaceStore.prepareRepositoryRename}
  onCreateRepositoryRename={createRepositoryRename}
  onRepositoryDeleteFormInput={workspaceStore.setRepositoryDeleteForm}
  onPrepareRepositoryDelete={workspaceStore.prepareRepositoryDelete}
  onCreateRepositoryDelete={createRepositoryDelete}
  onRepositoryCheckoutFormInput={workspaceStore.setRepositoryCheckoutForm}
  onPrepareRepositoryCheckout={workspaceStore.prepareRepositoryCheckout}
  onChooseRepositoryCheckoutParent={workspaceStore.chooseRepositoryCheckoutParent}
  onCreateRepositoryCheckout={createRepositoryCheckout}
  onRepositoryExportFormInput={workspaceStore.setRepositoryExportForm}
  onPrepareRepositoryExport={workspaceStore.prepareRepositoryExport}
  onChooseRepositoryExportParent={workspaceStore.chooseRepositoryExportParent}
  onCreateRepositoryExport={createRepositoryExport}
  onDragRepositoryEntry={dragRepositoryEntry}
  onRefreshSvnLog={() => workspaceStore.refreshSvnLog(currentSvnExecutable())}
  onSvnLogFilterInput={workspaceStore.setSvnLogFilter}
  onSvnLogFileOnlyInput={setSvnLogFileOnlyAndRefresh}
  onSvnLogLimitInput={workspaceStore.setSvnLogLimit}
  onLoadMoreSvnLog={() => workspaceStore.loadMoreSvnLog(currentSvnExecutable())}
  onLoadAllSvnLog={() => workspaceStore.loadAllSvnLog(currentSvnExecutable())}
  onRevertToRevision={revertWorkspaceToRevision}
  onRevertWorkspaceToRevision={revertWholeWorkspaceToRevision}
  onRevertSelectedRevisions={revertSelectedWorkspaceRevisions}
  onExportRevision={exportLogRevision}
  onCommitMessageInput={workspaceStore.setCommitMessage}
  onCommitTemplateInput={workspaceStore.setCommitTemplate}
  onUseCommitHistoryMessage={workspaceStore.useCommitHistoryMessage}
  onConfirmSafetyWarnings={workspaceStore.confirmSafetyWarnings}
  onClearWorkspaceDraft={workspaceStore.clearWorkspaceDraft}
  onCommit={submitCommitFiles}
  onPartialCommit={submitSelectedPatch}
  onSelectTask={taskStore.select}
  onCancelTask={taskStore.cancel}
  onBranchPoolFormInput={branchPoolStore.setFormField}
  onUseBranchUrlForPool={branchPoolStore.useBranchUrl}
  onCheckoutBranchPoolEntry={checkoutBranchPoolEntry}
  onReuseBranchPoolEntry={reuseBranchPoolEntry}
  onOpenBranchPoolEntry={openBranchPoolEntry}
  onRemoveBranchPoolEntry={removeBranchPoolEntry}
  onReorderBranchPoolEntries={reorderBranchPoolEntries}
  onRenameBranchPoolEntry={renameBranchPoolEntry}
  onMergeFormInput={workspaceStore.setMergeForm}
  onUseRepositoryUrlForMerge={workspaceStore.useRepositoryUrlForMerge}
  onRunMerge={runMerge}
  onRunSvnSwitch={runSvnSwitch}
  onSvnSwitchTargetInput={workspaceStore.setSvnSwitchTargetUrl}
  onDetectSvn={svnStore.detect}
  onDetectSvnWithInput={detectSvnWithInputAndSave}
  onSvnExecutableInput={svnStore.setExecutableInput}
  onSvnAuthenticationPasswordInput={(value) => (svnAuthenticationPassword = value)}
  onApplySvnAuthentication={applySvnAuthentication}
  onConfirmSvnCertificateTrust={confirmSvnCertificateTrust}
  onClearSvnCertificateTrust={clearCurrentSvnCertificateTrust}
  onAppSettingInput={appSettingsStore.setField}
  onExportDiagnosticLog={appSettingsStore.exportDiagnosticLog}
/>
{/if}

<style>
  .startup-loading {
    display: grid;
    width: 100vw;
    height: 100vh;
    align-content: center;
    justify-items: center;
    gap: 12px;
    overflow: hidden;
    background: #f5f6f7;
    color: #596674;
  }

  .startup-loading span {
    width: 24px;
    height: 24px;
    border: 2px solid #c5ccd3;
    border-top-color: #2674b9;
    border-radius: 50%;
    animation: startup-spin 800ms linear infinite;
  }

  .startup-loading p {
    margin: 0;
    font-size: 13px;
  }

  @keyframes startup-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
