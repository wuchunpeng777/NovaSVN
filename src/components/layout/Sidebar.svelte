<script lang="ts">
  import type { AppView, NavigationItem } from "../../types/app";

  export let currentView: AppView;
  export let items: NavigationItem[] = [];
  export let onSelect: (view: AppView) => void;
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
    <h2>过滤器</h2>
    <button type="button">未暂存</button>
    <button type="button">已暂存</button>
    <button type="button">异常状态</button>
    <button type="button">未审查</button>
  </section>
</aside>
