<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import MainWorkspace from "./components/workbench/MainWorkspace.svelte";
  import {
    callBackend,
    getStartupIntent,
    launchExternalTool,
    openFileLocation,
    openWorkspaceFile,
  } from "./lib/api";
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
    ChangedFile,
    CommandError,
    ExternalToolKind,
    HealthPayload,
    SvnOperationKind,
    WorkingCopyStatus,
  } from "./types/api";

  let backendMessage = "等待连接后端";
  let commandError: CommandError | null = null;
  const repositoryLayoutTaskChecks = new Set<string>();

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
    return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
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

  async function submitStagedFiles() {
    if (!workspaceStore.validateStagedFilesForCommit() || !$workspaceStore.current) {
      return;
    }

    const files = $workspaceStore.stagedFiles.map((file) => file.path);
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

  async function runSvnOperation(kind: SvnOperationKind, filePath?: string) {
    if (!$workspaceStore.current) {
      return;
    }

    if (kind === "revert_file") {
      const confirmed = window.confirm(`确定要撤销文件改动吗？\n${filePath ?? ""}`);
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

    const task = await taskStore.createSvnOperation({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      kind,
      filePath,
      svnExecutable: currentSvnExecutable(),
    });

    if (!task) {
      return;
    }

    workspaceStore.markSvnOperationTask(task.task_id, kind);
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
        setCurrentView("staging");
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

  $: if (
    $workspaceStore.pendingCommitTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingCommitTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    const committedPaths = $workspaceStore.stagedFiles.map((file) => file.path);
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    workspaceStore.clearCommittedFiles(committedPaths);
    if (workingCopyRoot) {
      void refreshStatusAndSyncBranchPool(workingCopyRoot);
    }
  }

  $: if (
    $workspaceStore.pendingCommitTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingCommitTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.markCommitTask(null);
  }

  $: if (
    $workspaceStore.pendingPartialCommitTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingPartialCommitTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    workspaceStore.completePartialCommit();
    if (workingCopyRoot) {
      void refreshStatusAndSyncBranchPool(workingCopyRoot);
    }
  }

  $: if (
    $workspaceStore.pendingPartialCommitTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingPartialCommitTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.markPartialCommitTask(null);
  }

  $: if (
    $workspaceStore.pendingSvnOperationTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingSvnOperationTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    const operationKind = $workspaceStore.pendingSvnOperationKind;
    workspaceStore.markSvnOperationTask(null, null);
    if (workingCopyRoot) {
      if (operationKind === "update") {
        void workspaceStore.openPath(currentSvnExecutable()).then(() => syncCurrentBranchPoolEntry());
      } else {
        void refreshStatusAndSyncBranchPool(workingCopyRoot);
      }
    }
  }

  $: if (
    $workspaceStore.pendingSvnOperationTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingSvnOperationTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.markSvnOperationTask(null, null);
  }

  $: if (
    $workspaceStore.pendingRepositoryListTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingRepositoryListTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    const result = $taskStore.selectedTask.result?.repository_list;
    if (result) {
      workspaceStore.applyRepositoryListResult(result);
    } else {
      workspaceStore.failRepositoryList("仓库目录任务没有返回结果");
    }
  }

  $: if (
    $workspaceStore.pendingRepositoryListTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingRepositoryListTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.failRepositoryList($taskStore.selectedTask.error ?? "仓库目录加载失败");
  }

  $: if (
    $workspaceStore.pendingRepositoryCopyTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingRepositoryCopyTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    workspaceStore.completeRepositoryCopyTask();
  }

  $: if (
    $workspaceStore.pendingRepositoryCopyTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingRepositoryCopyTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.failRepositoryCopyTask($taskStore.selectedTask.error ?? "创建分支或标签失败");
  }

  $: if (
    $branchPoolStore.pendingCheckoutTaskId &&
    $taskStore.selectedTask?.task_id === $branchPoolStore.pendingCheckoutTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    void branchPoolStore.completeCheckoutTask();
  }

  $: if (
    $branchPoolStore.pendingCheckoutTaskId &&
    $taskStore.selectedTask?.task_id === $branchPoolStore.pendingCheckoutTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    branchPoolStore.failCheckoutTask($taskStore.selectedTask.error ?? "分支 checkout 失败");
  }

  $: if (
    $workspaceStore.pendingSvnSwitchTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingSvnSwitchTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    workspaceStore.markSvnSwitchTask(null);
    void workspaceStore.openPath(currentSvnExecutable());
  }

  $: if (
    $workspaceStore.pendingSvnSwitchTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingSvnSwitchTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.failSvnSwitchTask($taskStore.selectedTask.error ?? "svn switch 失败");
  }

  $: if (
    $workspaceStore.pendingRevisionDiffTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingRevisionDiffTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    const result = $taskStore.selectedTask.result?.revision_diff;
    if (result) {
      workspaceStore.applyRevisionDiffResult(result);
    } else {
      workspaceStore.failRevisionDiffTask("Revision diff 任务没有返回结果");
    }
  }

  $: if (
    $workspaceStore.pendingRevisionDiffTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingRevisionDiffTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.failRevisionDiffTask($taskStore.selectedTask.error ?? "Revision diff 失败");
  }

  $: if (
    $workspaceStore.pendingMergeTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingMergeTaskId &&
    $taskStore.selectedTask.status === "success"
  ) {
    const workingCopyRoot = $workspaceStore.current?.working_copy_root;
    const mergeResult = $taskStore.selectedTask.result?.merge_result;
    if (mergeResult) {
      workspaceStore.completeMergeTask(mergeResult);
      if (workingCopyRoot && !mergeResult.dry_run) {
        void refreshStatusAndSyncBranchPool(workingCopyRoot).then((status) => {
          if ((status?.conflicted ?? 0) > 0) {
            setCurrentView("changes");
            workspaceStore.focusConflictFilter();
          }
        });
      }
    } else {
      workspaceStore.failMergeTask("Merge 任务没有返回结果");
    }
  }

  $: if (
    $workspaceStore.pendingMergeTaskId &&
    $taskStore.selectedTask?.task_id === $workspaceStore.pendingMergeTaskId &&
    ($taskStore.selectedTask.status === "failed" ||
      $taskStore.selectedTask.status === "cancelled")
  ) {
    workspaceStore.failMergeTask($taskStore.selectedTask.error ?? "Merge 执行失败");
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
  searchText={$workspaceStore.searchText}
  stageFilter={$workspaceStore.stageFilter}
  selectedFilePath={$workspaceStore.selectedFilePath}
  selectedFile={selectedFile}
  selectedFileReviewed={selectedFileReviewed}
  stagedFiles={$workspaceStore.stagedFiles}
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
  taskWorkspaces={$taskWorkspaceStore.list}
  activeTaskWorkspaceId={$taskWorkspaceStore.activeTaskId}
  selectedFileDiff={$workspaceStore.selectedFileDiff}
  selectedFileContentDiff={$workspaceStore.selectedFileContentDiff}
  selectedFileParsedDiff={$workspaceStore.selectedFileParsedDiff}
  selectedHunkIds={selectedHunkIds}
  selectedPatch={$workspaceStore.selectedPatch}
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
    $workspaceStore.stagedFiles.length === 0 ||
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
  onCleanupWorkspace={() => runSvnOperation("cleanup")}
  onLoadMoreStatus={() => workspaceStore.loadMoreStatus(currentSvnExecutable())}
  onWorkspacePathInput={workspaceStore.setPathInput}
  onSearchTextInput={workspaceStore.setSearchText}
  onStageFilter={workspaceStore.setStageFilter}
  onClearFilters={workspaceStore.clearFilters}
  onSelectFile={(path) => workspaceStore.selectFile(path, currentSvnExecutable())}
  onStageFile={workspaceStore.stageFile}
  onUnstageFile={workspaceStore.unstageFile}
  onRevertFile={(path) => runSvnOperation("revert_file", path)}
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
  onSvnLogFileOnlyInput={workspaceStore.setSvnLogFileOnly}
  onSvnLogLimitInput={workspaceStore.setSvnLogLimit}
  onLoadMoreSvnLog={() => workspaceStore.loadMoreSvnLog(currentSvnExecutable())}
  onRevisionDiffFormInput={workspaceStore.setRevisionDiffForm}
  onRunRevisionDiff={runRevisionDiff}
  onPrepareRevisionDiffFromLog={workspaceStore.prepareRevisionDiffFromLog}
  onExportRevisionDiffPatch={workspaceStore.exportRevisionDiffPatch}
  onCommitMessageInput={workspaceStore.setCommitMessage}
  onCommitTemplateInput={workspaceStore.setCommitTemplate}
  onUseCommitHistoryMessage={workspaceStore.useCommitHistoryMessage}
  onConfirmSafetyWarnings={workspaceStore.confirmSafetyWarnings}
  onClearWorkspaceDraft={workspaceStore.clearWorkspaceDraft}
  onCommit={submitStagedFiles}
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
