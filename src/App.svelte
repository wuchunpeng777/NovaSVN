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
  import type { CommandError, HealthPayload } from "./types/api";

  let backendMessage = "等待连接后端";
  let commandError: CommandError | null = null;

  $: activeView = workbenchViews[$currentView];

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
</script>

<main class="app-shell">
  <Sidebar
    currentView={$currentView}
    items={navigationItems}
    onSelect={setCurrentView}
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
        selectedFilePath={$workspaceStore.selectedFilePath}
        stagedFiles={$workspaceStore.stagedFiles}
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
      selectedFile={$workspaceStore.status?.files.find(
        (file) => file.path === $workspaceStore.selectedFilePath,
      ) ?? null}
      selectedFileDiff={$workspaceStore.selectedFileDiff}
      diffLoading={$workspaceStore.diffLoading}
      diffError={$workspaceStore.diffError}
      svnDetection={$svnStore.detection}
      svnError={$svnStore.error}
      svnExecutableInput={$svnStore.executableInput}
      svnLoading={$svnStore.loading}
      onDetectSvn={svnStore.detect}
      onDetectSvnWithInput={svnStore.detectWithInput}
      onSvnExecutableInput={svnStore.setExecutableInput}
      onRevertFile={(path) => runSvnOperation("revert_file", path)}
    />
    </div>

    <BottomPanel
      tasks={$taskStore.snapshot.tasks}
      selectedTask={$taskStore.selectedTask}
      runningTaskId={$taskStore.snapshot.running_task_id}
      loading={$taskStore.loading}
      error={$taskStore.error}
      stagedFiles={$workspaceStore.stagedFiles}
      commitMessage={$workspaceStore.commitMessage}
      commitError={$workspaceStore.commitError}
      commitDisabled={
        $workspaceStore.stagedFiles.length === 0 ||
        $taskStore.snapshot.running_task_id !== null
      }
      onCreateTask={taskStore.create}
      onCommitMessageInput={workspaceStore.setCommitMessage}
      onCommit={submitStagedFiles}
      onSelectTask={taskStore.select}
      onCancelTask={taskStore.cancel}
    />
  </section>
</main>
