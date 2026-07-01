<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { currentView, setCurrentView } from "./stores/app";
  import type { AppView } from "./types/app";

  const views: Array<{ id: AppView; label: string }> = [
    { id: "workspace", label: "工作区" },
    { id: "branches", label: "分支池" },
    { id: "repository", label: "仓库" },
    { id: "drafts", label: "草稿" },
  ];

  let backendMessage = "等待连接后端";

  async function pingBackend() {
    backendMessage = await invoke<string>("ping");
  }
</script>

<main class="app-shell">
  <aside class="sidebar" aria-label="主导航">
    <div class="brand">
      <span class="brand-mark">N</span>
      <div>
        <h1>NovaSVN</h1>
        <p>现代化 SVN 工作台</p>
      </div>
    </div>

    <nav class="nav-list">
      {#each views as view}
        <button
          class:active={$currentView === view.id}
          type="button"
          on:click={() => setCurrentView(view.id)}
        >
          {view.label}
        </button>
      {/each}
    </nav>
  </aside>

  <section class="main-panel" aria-label="主要工作区">
    <header class="toolbar">
      <div>
        <h2>初始化工程</h2>
        <p>Tauri + Svelte + TypeScript + Rust</p>
      </div>
      <button type="button" on:click={pingBackend}>连接后端</button>
    </header>

    <div class="workspace-grid">
      <section class="change-list" aria-label="本地改动">
        <h3>本地改动</h3>
        <p>后续阶段接入工作副本扫描和虚拟暂存区。</p>
      </section>

      <section class="diff-panel" aria-label="Diff 查看器">
        <h3>Diff</h3>
        <p>Monaco Diff 将在阶段 2 集成。</p>
      </section>

      <section class="details-panel" aria-label="详情">
        <h3>详情</h3>
        <p>{backendMessage}</p>
      </section>
    </div>

    <footer class="bottom-panel">
      <span>提交信息</span>
      <span>命令输出</span>
      <span>任务队列</span>
    </footer>
  </section>
</main>
