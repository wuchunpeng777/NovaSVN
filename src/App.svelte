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
        onWorkspacePathInput={workspaceStore.setPathInput}
        onSearchTextInput={workspaceStore.setSearchText}
        onToggleGroupByStatus={workspaceStore.toggleGroupByStatus}
        onSelectFile={(path) =>
          workspaceStore.selectFile(
            path,
            $svnStore.detection?.resolved_path ?? $svnStore.detection?.executable,
          )}
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
    />
    </div>

    <BottomPanel
      tasks={$taskStore.snapshot.tasks}
      selectedTask={$taskStore.selectedTask}
      runningTaskId={$taskStore.snapshot.running_task_id}
      loading={$taskStore.loading}
      error={$taskStore.error}
      onCreateTask={taskStore.create}
      onSelectTask={taskStore.select}
      onCancelTask={taskStore.cancel}
    />
  </section>
</main>
