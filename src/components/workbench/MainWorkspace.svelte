<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import type { CommandError, WorkspaceSummary } from "../../types/api";
  import type { WorkbenchView } from "../../types/app";

  export let view: WorkbenchView;
  export let workspace: WorkspaceSummary | null = null;
  export let workspacePathInput = "";
  export let workspaceLoading = false;
  export let workspaceError: CommandError | null = null;
  export let onChooseWorkspace: () => void;
  export let onOpenWorkspace: () => void;
  export let onWorkspacePathInput: (value: string) => void;
</script>

<section class="main-workspace" aria-label={view.title}>
  <section class="workspace-open-panel">
    <div class="workspace-open-header">
      <div>
        <h3>工作副本</h3>
        {#if workspace}
          <p>{workspace.working_copy_root}</p>
        {:else}
          <p>选择或输入 SVN 工作副本目录</p>
        {/if}
      </div>
      <div class="workspace-open-actions">
        <button type="button" on:click={onChooseWorkspace} disabled={workspaceLoading}>
          选择目录
        </button>
        <button type="button" on:click={onOpenWorkspace} disabled={workspaceLoading}>
          {workspaceLoading ? "打开中" : "打开"}
        </button>
      </div>
    </div>

    <div class="workspace-path-row">
      <input
        type="text"
        value={workspacePathInput}
        placeholder="输入 SVN 工作副本目录"
        on:input={(event) =>
          onWorkspacePathInput((event.currentTarget as HTMLInputElement).value)}
      />
    </div>

    <ErrorNotice error={workspaceError} />

    {#if workspace}
      <dl class="workspace-summary">
        <div>
          <dt>Repository URL</dt>
          <dd>{workspace.repository_url}</dd>
        </div>
        <div>
          <dt>Repository Root</dt>
          <dd>{workspace.repository_root}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{workspace.revision}</dd>
        </div>
        <div>
          <dt>Local Path</dt>
          <dd>{workspace.local_path}</dd>
        </div>
      </dl>
    {/if}
  </section>

  <div class="metric-row">
    {#each view.metrics as metric}
      <div class="metric">
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
      </div>
    {/each}
  </div>

  <div class="work-list">
    {#each view.primaryItems as item}
      <article class="work-row">
        <div>
          <h3>{item.title}</h3>
          <p>{item.meta}</p>
        </div>
        <span>{item.status}</span>
      </article>
    {/each}
  </div>
</section>
