<script lang="ts">
  import Sidebar from "./components/layout/Sidebar.svelte";
  import BottomPanel from "./components/workbench/BottomPanel.svelte";
  import DetailPanel from "./components/workbench/DetailPanel.svelte";
  import MainWorkspace from "./components/workbench/MainWorkspace.svelte";
  import Toolbar from "./components/workbench/Toolbar.svelte";
  import { onDestroy, onMount } from "svelte";
  import { callBackend } from "./lib/api";
  import { detailSections, navigationItems, workbenchViews } from "./lib/workbench";
  import {
    currentView,
    setCurrentView,
    svnStore,
    taskStore,
    workspaceStore,
  } from "./stores/app";
  import type { ChangedFile, CommandError, HealthPayload } from "./types/api";
  import type { SidebarFilterStats } from "./types/app";

  let backendMessage = "等待连接后端";
  let commandError: CommandError | null = null;

  $: activeView = workbenchViews[$currentView];
  $: sidebarFilterStats = buildSidebarFilterStats(
    $workspaceStore.status?.files ?? [],
    $workspaceStore.stagedFiles,
    $workspaceStore.reviewedFiles,
  );
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
    const health = await callBackend<HealthPayload>("ping");
    backendMessage = `${health.message} (${health.backend})`;
  }

  async function previewError() {
    commandError = null;
    try {
      await callBackend<void>("fail_for_preview");
    } catch (error) {
      commandError = error as CommandError;
    }
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
      svnExecutable: $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
    });

    if (!task) {
      return;
    }

    workspaceStore.markPartialCommitTask(task.task_id);
  }

  async function submitSelectedPatch() {
    if (
      !$workspaceStore.current ||
      !$workspaceStore.selectedPatch ||
      !workspaceStore.validateStagedFilesForCommit()
    ) {
      return;
    }

    const files = Array.from(
      new Set($workspaceStore.selectedHunks.map((item) => item.filePath)),
    );
    const task = await taskStore.createPartialCommit({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      repositoryUrl: $workspaceStore.current.repository_url,
      revision: $workspaceStore.current.revision,
      message: $workspaceStore.commitMessage,
      selectedPatch: $workspaceStore.selectedPatch.text,
      files,
      svnExecutable: $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
    });

    if (!task) {
      return;
    }

    workspaceStore.markCommitTask(task.task_id);
  }

  async function runSvnOperation(kind: "update" | "cleanup" | "revert_file", filePath?: string) {
    if (!$workspaceStore.current) {
      return;
    }

    if (kind === "revert_file") {
      const confirmed = window.confirm(`确定要撤销文件改动吗？\n${filePath ?? ""}`);
      if (!confirmed) {
        return;
      }
    }

    const task = await taskStore.createSvnOperation({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      kind,
      filePath,
      svnExecutable: $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
    });

    if (!task) {
      return;
    }

    workspaceStore.markSvnOperationTask(task.task_id, kind);
  }

  async function runShadowWorkspace(kind: "create_or_update" | "rebuild") {
    if (!$workspaceStore.current) {
      return;
    }

    const task = await taskStore.createShadowWorkspace({
      workingCopyRoot: $workspaceStore.current.working_copy_root,
      repositoryUrl: $workspaceStore.current.repository_url,
      revision: $workspaceStore.current.revision,
      kind,
      svnExecutable: $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
    });

    if (!task) {
      return;
    }

    taskStore.startPolling();
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
      void workspaceStore.refreshStatus(
        $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
        workingCopyRoot,
      );
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
    workspaceStore.markPartialCommitTask(null);
    if (workingCopyRoot) {
      void workspaceStore.refreshStatus(
        $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
        workingCopyRoot,
      );
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
        void workspaceStore.openPath(
          $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
        );
      } else {
        void workspaceStore.refreshStatus(
          $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          workingCopyRoot,
        );
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

  onMount(() => {
    taskStore.startPolling();
    void svnStore.detect();
    void workspaceStore.loadRecent();
  });

  onDestroy(() => {
    taskStore.stopPolling();
  });

  const statusLabels: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    missing: "缺失",
    unversioned: "未版本控制",
    conflicted: "冲突",
    obstructed: "阻塞",
  };

  function buildSidebarFilterStats(
    files: ChangedFile[],
    stagedFiles: Array<{ path: string; status: string }>,
    reviewedFiles: Array<{ path: string }>,
  ): SidebarFilterStats {
    const stagedPaths = new Set(stagedFiles.map((file) => file.path));
    const reviewedPaths = new Set(reviewedFiles.map((file) => file.path));
    const statusCounts = new Map<string, number>();

    for (const file of files) {
      statusCounts.set(file.status, (statusCounts.get(file.status) ?? 0) + 1);
    }

    return {
      total: files.length,
      staged: files.filter((file) => stagedPaths.has(file.path)).length,
      unstaged: files.filter((file) => !stagedPaths.has(file.path)).length,
      abnormal: files.filter((file) => file.abnormal).length,
      unreviewed: files.filter((file) => !reviewedPaths.has(file.path)).length,
      statuses: Array.from(statusCounts.entries()).map(([status, count]) => ({
        status,
        label: statusLabels[status] ?? status,
        count,
      })),
    };
  }
</script>

<main class="app-shell">
  <Sidebar
    currentView={$currentView}
    items={navigationItems}
    filterStats={sidebarFilterStats}
    stageFilter={$workspaceStore.stageFilter}
    abnormalOnly={$workspaceStore.abnormalOnly}
    unreviewedOnly={$workspaceStore.unreviewedOnly}
    statusFilters={$workspaceStore.statusFilters}
    onSelect={setCurrentView}
    onStageFilter={workspaceStore.setStageFilter}
    onToggleAbnormalOnly={workspaceStore.toggleAbnormalOnly}
    onToggleUnreviewedOnly={workspaceStore.toggleUnreviewedOnly}
    onToggleStatusFilter={workspaceStore.toggleStatusFilter}
    onClearFilters={workspaceStore.clearFilters}
  />

  <section class="main-panel" aria-label="主要工作区">
    <Toolbar
      title={activeView.title}
      subtitle={activeView.subtitle}
      onPing={pingBackend}
      onPreviewError={previewError}
    />

    <div class="workspace-grid">
      <MainWorkspace
        view={activeView}
        workspace={$workspaceStore.current}
        workspacePathInput={$workspaceStore.pathInput}
        workspaceLoading={$workspaceStore.loading}
        workspaceError={$workspaceStore.error}
        workingCopyStatus={$workspaceStore.status}
        searchText={$workspaceStore.searchText}
        groupByStatus={$workspaceStore.groupByStatus}
        stageFilter={$workspaceStore.stageFilter}
        abnormalOnly={$workspaceStore.abnormalOnly}
        unreviewedOnly={$workspaceStore.unreviewedOnly}
        statusFilters={$workspaceStore.statusFilters}
        groupMode={$workspaceStore.groupMode}
        selectedFilePath={$workspaceStore.selectedFilePath}
        stagedFiles={$workspaceStore.stagedFiles}
        reviewedFiles={$workspaceStore.reviewedFiles}
        statusLoading={$workspaceStore.statusLoading}
        statusError={$workspaceStore.statusError}
        onChooseWorkspace={() =>
          workspaceStore.chooseAndOpen(
            $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          )}
        onOpenWorkspace={() =>
          workspaceStore.openPath(
            $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          )}
        onRefreshStatus={() =>
          workspaceStore.refreshStatus(
            $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          )}
        onUpdateWorkspace={() => runSvnOperation("update")}
        onCleanupWorkspace={() => runSvnOperation("cleanup")}
        onWorkspacePathInput={workspaceStore.setPathInput}
        onSearchTextInput={workspaceStore.setSearchText}
        onToggleGroupByStatus={workspaceStore.toggleGroupByStatus}
        onToggleUnreviewedOnly={workspaceStore.toggleUnreviewedOnly}
        onGroupModeChange={workspaceStore.setGroupMode}
        onClearFilters={workspaceStore.clearFilters}
        onSelectFile={(path) =>
          workspaceStore.selectFile(
            path,
            $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          )}
        onStageFile={workspaceStore.stageFile}
        onUnstageFile={workspaceStore.unstageFile}
      />
      <DetailPanel
        sections={detailSections}
        commandError={commandError}
        backendMessage={backendMessage}
        selectedFile={selectedFile}
        selectedFileReviewed={selectedFileReviewed}
        safetyCheck={$workspaceStore.safetyCheck}
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
        svnDetection={$svnStore.detection}
        svnError={$svnStore.error}
        svnExecutableInput={$svnStore.executableInput}
        svnLoading={$svnStore.loading}
        shadowStatus={$workspaceStore.shadowStatus}
        shadowLoading={$workspaceStore.shadowLoading}
        shadowError={$workspaceStore.shadowError}
        onDetectSvn={svnStore.detect}
        onDetectSvnWithInput={svnStore.detectWithInput}
        onSvnExecutableInput={svnStore.setExecutableInput}
        onRevertFile={(path) => runSvnOperation("revert_file", path)}
        onMarkFileReviewed={workspaceStore.markFileReviewed}
        onMarkFileUnreviewed={workspaceStore.markFileUnreviewed}
        onToggleHunkSelection={workspaceStore.toggleHunkSelection}
        onPreviewSelectedPatch={workspaceStore.previewSelectedPatch}
        onRefreshShadowStatus={() =>
          workspaceStore.refreshShadowStatus(
            $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          )}
        onPrepareShadowWorkspace={() => runShadowWorkspace("create_or_update")}
        onRebuildShadowWorkspace={() => runShadowWorkspace("rebuild")}
      />
    </div>

    <BottomPanel
      tasks={$taskStore.snapshot.tasks}
      selectedTask={$taskStore.selectedTask}
      runningTaskId={$taskStore.snapshot.running_task_id}
      loading={$taskStore.loading}
      error={$taskStore.error}
      stagedFiles={$workspaceStore.stagedFiles}
      safetyCheck={$workspaceStore.safetyCheck}
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
      onCreateTask={taskStore.create}
      onCommitMessageInput={workspaceStore.setCommitMessage}
      onCommitTemplateInput={workspaceStore.setCommitTemplate}
      onUseCommitHistoryMessage={workspaceStore.useCommitHistoryMessage}
      onConfirmSafetyWarnings={workspaceStore.confirmSafetyWarnings}
      onClearWorkspaceDraft={workspaceStore.clearWorkspaceDraft}
      onCommit={submitStagedFiles}
      onPartialCommit={submitSelectedPatch}
      onSelectTask={taskStore.select}
      onCancelTask={taskStore.cancel}
    />
  </section>
</main>
