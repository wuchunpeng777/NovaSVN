<script lang="ts">
  import type {
    AppView,
    NavigationItem,
    SidebarFilterStats,
    WorkspaceStageFilter,
  } from "../../types/app";

  export let currentView: AppView;
  export let items: NavigationItem[] = [];
  export let onSelect: (view: AppView) => void;
  export let filterStats: SidebarFilterStats = {
    total: 0,
    staged: 0,
    unstaged: 0,
    abnormal: 0,
    statuses: [],
  };
  export let stageFilter: WorkspaceStageFilter = "all";
  export let abnormalOnly = false;
  export let statusFilters: string[] = [];
  export let onStageFilter: (value: WorkspaceStageFilter) => void;
  export let onToggleAbnormalOnly: () => void;
  export let onToggleStatusFilter: (status: string) => void;
  export let onClearFilters: () => void;

  $: hasActiveFilters =
    stageFilter !== "all" || abnormalOnly || statusFilters.length > 0;
</script>

<aside class="sidebar" aria-label="主导航">
  <div class="brand">
    <span class="brand-mark">N</span>
    <div>
      <h1>NovaSVN</h1>
      <p>现代化 SVN 工作台</p>
    </div>
  </div>

  <nav class="nav-list">
    {#each items as item}
      <button
        class:active={currentView === item.id}
        type="button"
        on:click={() => onSelect(item.id)}
      >
        <span>{item.label}</span>
        <small>{item.description}</small>
      </button>
    {/each}
  </nav>

  <section class="sidebar-filter" aria-label="过滤器">
    <div class="sidebar-filter-heading">
      <h2>过滤器</h2>
      <button type="button" disabled={!hasActiveFilters} on:click={onClearFilters}>
        清空
      </button>
    </div>

    <button
      type="button"
      class:active={stageFilter === "unstaged"}
      on:click={() => onStageFilter("unstaged")}
    >
      <span>未暂存</span>
      <small>{filterStats.unstaged}</small>
    </button>
    <button
      type="button"
      class:active={stageFilter === "staged"}
      on:click={() => onStageFilter("staged")}
    >
      <span>已暂存</span>
      <small>{filterStats.staged}</small>
    </button>
    <button type="button" class:active={abnormalOnly} on:click={onToggleAbnormalOnly}>
      <span>异常状态</span>
      <small>{filterStats.abnormal}</small>
    </button>

    {#if filterStats.statuses.length > 0}
      <div class="sidebar-filter-divider">状态</div>
      {#each filterStats.statuses as item}
        <button
          type="button"
          class:active={statusFilters.includes(item.status)}
          on:click={() => onToggleStatusFilter(item.status)}
        >
          <span>{item.label}</span>
          <small>{item.count}</small>
        </button>
      {/each}
    {/if}
  </section>
</aside>
