<script lang="ts">
  import Sidebar from "./components/layout/Sidebar.svelte";
  import BottomPanel from "./components/workbench/BottomPanel.svelte";
  import DetailPanel from "./components/workbench/DetailPanel.svelte";
  import MainWorkspace from "./components/workbench/MainWorkspace.svelte";
  import Toolbar from "./components/workbench/Toolbar.svelte";
  import { callBackend } from "./lib/api";
  import { detailSections, navigationItems, workbenchViews } from "./lib/workbench";
  import { currentView, setCurrentView } from "./stores/app";
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
      <MainWorkspace view={activeView} />
      <DetailPanel
        sections={detailSections}
        commandError={commandError}
        backendMessage={backendMessage}
      />
    </div>

    <BottomPanel />
  </section>
</main>
