<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import MainWorkspace from "./components/workbench/MainWorkspace.svelte";
  import {
    callBackend,
    choosePatchFile,
    getStartupIntent,
    launchExternalTool,
    openFileLocation,
    openWorkspaceFile,
  } from "./lib/api";
  import {
    consumePendingSvnOperationCompletion,
    createSvnOperationCreationCoordinator,
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
    SvnBatchOperationKind,
    SvnOperationKind,
    Task,
    TaskSnapshot,
    WorkingCopyStatus,
  } from "./types/api";

  let backendMessage = "等待连接后端";
  let commandError: CommandError | null = null;
  let unlistenAppMenu: UnlistenFn | null = null;
  let activeWorkspacePath: string | null = null;
  let appMenuState: AppMenuState;
  let queuedAppMenuState: AppMenuState | null = null;
  let appMenuStateSignature = "";
  let appMenuSyncRunning = false;
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
  $: queueAppMenuStateSync(appMenuState);

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
    return $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable;
  }

  function hasTauriRuntime() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  function preventNativeContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function queueAppMenuStateSync(state: AppMenuState) {
    if (!hasTauriRuntime()) {
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

  async function syncCurrentBranchPoolEntry() {
    const workspace = $workspaceStore.current;
    const status = $workspaceStore.status;
    if (!workspace || !status) {
      return;
    }

    const branchEntry = $branchPoolStore.pool.entries.find(
      (entry) =>
        normalizeLocalPath(entry.local_path) === normalizeLocalPath(workspace.working_copy_root),
    );
    if (!branchEntry) {
      return;
    }

    const revision = status.revision_range ?? workspace.revision;
    if (branchEntry.revision === revision && branchEntry.local_changes === status.total) {
      return;
    }

    await branchPoolStore.saveExisting({
      branchUrl: branchEntry.branch_url,
      localPath: branchEntry.local_path,
      revision,
      localChanges: status.total,
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

    workspaceStore.markCommitTask(task.task_id);
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
  ) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    if (
      !workingCopyRoot ||
      svnOperationCreationCoordinator.isCreating() ||
      $workspaceStore.pendingSvnOperationTaskId !== null
    ) {
      return;
    }

    if (kind === "revert_file") {
      const confirmed = window.confirm(`确定要撤销文件改动吗？\n${filePath ?? ""}`);
      if (!confirmed) {
        return;
      }
    }

    if (kind === "update_path") {
      const file = $workspaceStore.status?.files.find((item) => item.path === filePath);
      if (file?.change_scope === "both") {
        const confirmed = window.confirm(
          `此路径同时包含本地改动和远端更新，Update 可能产生合并或冲突。是否继续？\n${filePath ?? ""}`,
        );
        if (!confirmed) {
          return;
        }
      }
    }

    if (kind === "delete_path") {
      const confirmed = window.confirm(
        `确定要从工作副本删除此路径吗？\n${filePath ?? ""}\n\n这会删除本地内容并安排 SVN 删除。\n未提交改动和目录内未版本控制内容可能丢失。`,
      );
      if (!confirmed) {
        return;
      }
    }

    if (kind.startsWith("resolve_")) {
      const confirmed = window.confirm(`确定要标记或选择冲突解决结果吗？\n${filePath ?? ""}`);
      if (!confirmed) {
        return;
      }
    }

    await svnOperationCreationCoordinator.create(
      () => $workspaceStore.pendingSvnOperationTaskId !== null,
      () =>
        taskStore.createSvnOperation({
          workingCopyRoot,
          kind,
          filePath,
          targetPath,
          svnExecutable: currentSvnExecutable(),
        }),
      (task) => workspaceStore.markSvnOperationTask(task.task_id, kind, workingCopyRoot),
    );
  }

  async function loadRepositoryUrl(url?: string) {
    const targetUrl = (url ?? $workspaceStore.repositoryUrlInput).trim();
    if (!targetUrl) {
      workspaceStore.failRepositoryList("请输入仓库 URL");
      return;
    }

    const task = await taskStore.createRepositoryList({
      url: targetUrl,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRepositoryList($taskStore.error?.message ?? "仓库目录加载任务创建失败");
      return;
    }

    workspaceStore.markRepositoryListTask(task.task_id, targetUrl);
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
    const normalizedPath = path.trim().replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) {
      return root.replace(/\/+$/, "");
    }

    return `${root.replace(/\/+$/, "")}/${normalizedPath}`;
  }

  async function createRepositoryCopy() {
    const form = $workspaceStore.repositoryCopyForm;
    if (!form.sourceUrl.trim() || !form.targetUrl.trim()) {
      workspaceStore.failRepositoryCopyTask("请输入源 URL 和目标 URL");
      return;
    }

    if (!form.message.trim()) {
      workspaceStore.failRepositoryCopyTask("请输入创建分支或标签的提交信息");
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
        $taskStore.error?.message ?? "创建分支或标签任务创建失败",
      );
      return;
    }

    workspaceStore.markRepositoryCopyTask(task.task_id);
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
    workspaceStore.setPathInput(localPath);
    await workspaceStore.openPath(currentSvnExecutable());
    await syncCurrentBranchPoolEntry();
    setCurrentView("changes");
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
          `确定只从分支池移除该项吗？\n\n不会删除本地目录：\n${entry.local_path}`,
        );
    if (!confirmed) {
      return;
    }

    await branchPoolStore.remove(entry, deleteLocalCopy);
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

  async function runRevisionDiff() {
    const form = $workspaceStore.revisionDiffForm;
    const task = await taskStore.createRevisionDiff({
      mode: form.mode,
      workingCopyRoot: $workspaceStore.current?.working_copy_root,
      targetUrl: form.targetUrl,
      leftRevision: form.leftRevision,
      rightRevision: form.rightRevision,
      leftUrl: form.leftUrl,
      rightUrl: form.rightUrl,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      workspaceStore.failRevisionDiffTask(
        $taskStore.error?.message ?? "Revision diff 任务创建失败",
      );
      return;
    }

    workspaceStore.markRevisionDiffTask(task.task_id);
  }

  async function setSvnLogFileOnlyAndRefresh(value: boolean) {
    workspaceStore.setSvnLogFileOnly(value);
    await workspaceStore.refreshSvnLog(currentSvnExecutable());
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

    const task = await taskStore.createMerge({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      sourceUrl: form.sourceUrl,
      startRevision: form.startRevision,
      endRevision: form.endRevision,
      dryRun: form.dryRun,
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

  async function handleStartupIntent() {
    const intent = await getStartupIntent();
    const targetPath = intent.path?.trim();
    let startupFileSelected = false;
    if (targetPath) {
      workspaceStore.setPathInput(targetPath);
      const workspace = await workspaceStore.openPath(currentSvnExecutable());
      if (workspace) {
        startupFileSelected = await workspaceStore.selectStartupTargetFile(
          targetPath,
          currentSvnExecutable(),
        );
      }
    }

    switch (intent.action) {
      case "commit":
        setCurrentView("changes");
        break;
      case "update":
        setCurrentView("changes");
        if ($workspaceStore.current) {
          await runSvnOperation("update");
        }
        break;
      case "diff":
        setCurrentView("changes");
        break;
      case "cleanup":
        setCurrentView("changes");
        if ($workspaceStore.current) {
          await runSvnOperation("cleanup");
        }
        break;
      case "log":
        setCurrentView("history");
        if (startupFileSelected) {
          workspaceStore.setSvnLogFileOnly(true);
        }
        await workspaceStore.refreshSvnLog(currentSvnExecutable());
        break;
      case "revert":
        setCurrentView("changes");
        break;
      case "branch-workspace":
        setCurrentView("branches");
        break;
      default:
        if (targetPath) {
          setCurrentView("changes");
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
        setCurrentView("changes");
        if (selected) {
          workspaceStore.unselectCommitFile(path);
        } else {
          workspaceStore.selectCommitFile(path);
        }
      },
      update: (path) => runSvnOperation("update_path", path),
      add: (path) => runSvnOperation("add_file", path),
      resolve: async (path) => {
        setCurrentView("changes");
        await workspaceStore.selectFile(path, currentSvnExecutable());
      },
      revert: (path) => runSvnOperation("revert_file", path),
      move: moveWorkspacePath,
      copy: copyWorkspacePath,
      ignore: ignoreWorkspacePath,
      delete: (path) => runSvnOperation("delete_path", path),
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
        setCurrentView("changes");
        break;
      case "view_history":
        setCurrentView("history");
        break;
      case "view_repository":
        setCurrentView("repository");
        break;
      case "view_branches":
        setCurrentView("branches");
        break;
      case "view_settings":
        setCurrentView("settings");
        break;
      case "update_workspace":
        await runSvnOperation("update");
        break;
      case "cleanup_workspace":
        await runSvnOperation("cleanup");
        break;
      case "refresh_log":
        setCurrentView("history");
        await workspaceStore.refreshSvnLog(currentSvnExecutable());
        break;
      case "prepare_commit":
        setCurrentView("changes");
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

  async function deleteWorkspacePaths(paths: string[]) {
    const confirmed = window.confirm(
      `确定从工作副本删除 ${paths.length} 个路径吗？\n\n${formatBatchPathList(paths)}\n\n这会删除本地内容并安排 SVN 删除。目录内未版本控制内容和未提交改动可能丢失。`,
    );
    if (!confirmed) {
      return;
    }
    await runSvnBatchOperation("delete_paths", paths);
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

  $: consumePendingTask($workspaceStore.pendingCommitTaskId, $taskStore.snapshot, (task) => {
    if (task.status === "success") {
      const committedPaths = $workspaceStore.commitFiles.map((file) => file.path);
      const workingCopyRoot = $workspaceStore.current?.working_copy_root;
      workspaceStore.clearCommittedFiles(committedPaths);
      if (workingCopyRoot) {
        void refreshStatusAndSyncBranchPool(workingCopyRoot);
      }
      return;
    }

    workspaceStore.markCommitTask(null);
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
    $workspaceStore.pendingRepositoryCopyTaskId,
    $taskStore.snapshot,
    (task) => {
      if (task.status === "success") {
        workspaceStore.completeRepositoryCopyTask();
      } else {
        workspaceStore.failRepositoryCopyTask(task.error ?? "创建分支或标签失败");
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
            setCurrentView("changes");
            workspaceStore.focusConflictFilter();
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
                setCurrentView("changes");
                workspaceStore.focusConflictFilter();
              }
            });
          }
        }
        return;
      }

      if (task.status === "failed" || task.status === "cancelled") {
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
        patchTask.status === "cancelled")
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

    if (task.status === "failed" || task.status === "cancelled") {
      workspaceStore.failRepositoryLayoutResult(kind, task.error ?? "仓库布局识别失败");
    }
  }

  $: for (const kind of ["trunk", "branches", "tags"] as const) {
    const taskId = $workspaceStore.repositoryLayoutTasks[kind];
    if (taskId) {
      void checkRepositoryLayoutTask(kind, taskId);
    }
  }

  onMount(() => {
    appSettingsStore.load();
    if (hasTauriRuntime()) {
      window.addEventListener("contextmenu", preventNativeContextMenu);
      void listen<string>("novasvn-menu", (event) => {
        void handleAppMenuCommand(event.payload);
      }).then((unlisten) => {
        unlistenAppMenu = unlisten;
      });
      taskStore.startPolling();
      void svnStore.detectWithInputFallback();
      void workspaceStore.loadRecent().then(() => handleStartupIntent());
      void branchPoolStore.load();
      void taskWorkspaceStore.load();
      void pingBackend();
    } else {
      backendMessage = "浏览器预览模式";
    }
  });

  onDestroy(() => {
    window.removeEventListener("contextmenu", preventNativeContextMenu);
    unlistenAppMenu?.();
    taskStore.stopPolling();
  });
</script>

<MainWorkspace
  view={activeView}
  workspace={$workspaceStore.current}
  workspacePathInput={$workspaceStore.pathInput}
  workspaceLoading={$workspaceStore.loading}
  workspaceError={$workspaceStore.error}
  workingCopyStatus={$workspaceStore.status}
  workspaceFileTree={$workspaceStore.fileTree}
  searchText={$workspaceStore.searchText}
  selectedFilePath={$workspaceStore.selectedFilePath}
  selectedFile={selectedFile}
  selectedFileReviewed={selectedFileReviewed}
  commitFiles={$workspaceStore.commitFiles}
  reviewedFiles={$workspaceStore.reviewedFiles}
  statusLoading={$workspaceStore.statusLoading}
  statusError={$workspaceStore.statusError}
  repositoryUrlInput={$workspaceStore.repositoryUrlInput}
  repositoryList={$workspaceStore.repositoryList}
  repositoryLoading={$workspaceStore.repositoryLoading}
  repositoryError={$workspaceStore.repositoryError}
  repositoryLayout={$workspaceStore.repositoryLayout}
  repositoryLayoutResults={$workspaceStore.repositoryLayoutResults}
  repositoryLayoutErrors={$workspaceStore.repositoryLayoutErrors}
  repositoryLayoutLoading={$workspaceStore.repositoryLayoutLoading}
  repositoryCopyForm={$workspaceStore.repositoryCopyForm}
  repositoryCopyError={$workspaceStore.repositoryCopyError}
  repositoryCopyRunning={$workspaceStore.pendingRepositoryCopyTaskId !== null}
  svnLog={$workspaceStore.svnLog}
  svnLogLoading={$workspaceStore.svnLogLoading}
  svnLogError={$workspaceStore.svnLogError}
  svnLogAuthorFilter={$workspaceStore.svnLogAuthorFilter}
  svnLogKeywordFilter={$workspaceStore.svnLogKeywordFilter}
  svnLogDateFromFilter={$workspaceStore.svnLogDateFromFilter}
  svnLogDateToFilter={$workspaceStore.svnLogDateToFilter}
  svnLogFileOnly={$workspaceStore.svnLogFileOnly}
  svnLogLimit={$workspaceStore.svnLogLimit}
  revisionDiffForm={$workspaceStore.revisionDiffForm}
  revisionDiffLoading={$workspaceStore.revisionDiffLoading}
  revisionDiffError={$workspaceStore.revisionDiffError}
  revisionDiffResult={$workspaceStore.revisionDiffResult}
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
  selectedPatchLoading={$workspaceStore.selectedPatchLoading}
  diffError={$workspaceStore.diffError}
  contentDiffError={$workspaceStore.contentDiffError}
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
  pendingSvnOperationKind={$workspaceStore.pendingSvnOperationKind}
  taskError={$taskStore.error}
  backendMessage={backendMessage}
  commandError={commandError}
  svnDetection={$svnStore.detection}
  svnError={$svnStore.error}
  svnExecutableInput={$svnStore.executableInput}
  svnLoading={$svnStore.loading}
  appSettings={$appSettingsStore}
  svnSwitchTargetUrl={$workspaceStore.svnSwitchTargetUrl}
  svnSwitchError={$workspaceStore.svnSwitchError}
  svnSwitchRunning={$workspaceStore.pendingSvnSwitchTaskId !== null}
  onSelectView={setCurrentView}
  onChooseWorkspace={() =>
    workspaceStore
      .chooseAndOpen(currentSvnExecutable())
      .then(() => syncCurrentBranchPoolEntry())}
  onOpenWorkspace={() =>
    workspaceStore.openPath(currentSvnExecutable()).then(() => syncCurrentBranchPoolEntry())}
  onRefreshStatus={() => refreshStatusAndSyncBranchPool()}
  onUpdateWorkspace={() => runSvnOperation("update")}
  onUpdatePath={(path) => runSvnOperation("update_path", path)}
  onCleanupWorkspace={() => runSvnOperation("cleanup")}
  onChooseApplyPatch={chooseAndPreflightPatch}
  onRunApplyPatch={runApplyPatch}
  onCloseApplyPatch={workspaceStore.closeApplyPatchDialog}
  onLoadMoreStatus={() => workspaceStore.loadMoreStatus(currentSvnExecutable())}
  onWorkspacePathInput={workspaceStore.setPathInput}
  onSearchTextInput={workspaceStore.setSearchText}
  onClearFilters={workspaceStore.clearFilters}
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
  onDeletePath={(path) => runSvnOperation("delete_path", path)}
  onMovePath={moveWorkspacePath}
  onCopyPath={copyWorkspacePath}
  onRevertFile={(path) => runSvnOperation("revert_file", path)}
  onRevertPaths={revertWorkspacePaths}
  onDeletePaths={deleteWorkspacePaths}
  onMovePaths={moveWorkspacePaths}
  onLockFile={(path) => runSvnOperation("lock_file", path)}
  onUnlockFile={(path) => runSvnOperation("unlock_file", path)}
  onForceUnlockFile={(path) => runSvnOperation("force_unlock_file", path)}
  onResolveWorking={(path) => runSvnOperation("resolve_working", path)}
  onResolveMineFull={(path) => runSvnOperation("resolve_mine_full", path)}
  onResolveTheirsFull={(path) => runSvnOperation("resolve_theirs_full", path)}
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
  onUseWorkspaceRepositoryRoot={workspaceStore.useWorkspaceRepositoryRoot}
  onLoadRepositoryUrl={loadRepositoryUrl}
  onRepositoryLayoutPathInput={workspaceStore.setRepositoryLayoutPath}
  onDetectRepositoryLayout={detectRepositoryLayout}
  onRepositoryCopyFormInput={workspaceStore.setRepositoryCopyForm}
  onPrepareRepositoryCopyTarget={workspaceStore.prepareRepositoryCopyTarget}
  onCreateRepositoryCopy={createRepositoryCopy}
  onRefreshSvnLog={() => workspaceStore.refreshSvnLog(currentSvnExecutable())}
  onSvnLogFilterInput={workspaceStore.setSvnLogFilter}
  onSvnLogFileOnlyInput={setSvnLogFileOnlyAndRefresh}
  onSvnLogLimitInput={workspaceStore.setSvnLogLimit}
  onLoadMoreSvnLog={() => workspaceStore.loadMoreSvnLog(currentSvnExecutable())}
  onRevisionDiffFormInput={workspaceStore.setRevisionDiffForm}
  onRunRevisionDiff={runRevisionDiff}
  onPrepareRevisionDiffFromLog={workspaceStore.prepareRevisionDiffFromLog}
  onPrepareRevisionDiffRange={workspaceStore.prepareRevisionDiffRange}
  onExportRevisionDiffPatch={workspaceStore.exportRevisionDiffPatch}
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
  onMergeFormInput={workspaceStore.setMergeForm}
  onUseRepositoryUrlForMerge={workspaceStore.useRepositoryUrlForMerge}
  onRunMerge={runMerge}
  onRunSvnSwitch={runSvnSwitch}
  onSvnSwitchTargetInput={workspaceStore.setSvnSwitchTargetUrl}
  onDetectSvn={svnStore.detect}
  onDetectSvnWithInput={detectSvnWithInputAndSave}
  onSvnExecutableInput={svnStore.setExecutableInput}
  onAppSettingInput={appSettingsStore.setField}
  onExportDiagnosticLog={appSettingsStore.exportDiagnosticLog}
/>
