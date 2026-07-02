<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import type {
    ChangedFile,
    CommandError,
    WorkingCopyStatus,
    WorkspaceSummary,
  } from "../../types/api";
  import type { WorkbenchView } from "../../types/app";

  export let view: WorkbenchView;
  export let workspace: WorkspaceSummary | null = null;
  export let workspacePathInput = "";
  export let workspaceLoading = false;
  export let workspaceError: CommandError | null = null;
  export let workingCopyStatus: WorkingCopyStatus | null = null;
  export let statusLoading = false;
  export let statusError: CommandError | null = null;
  export let onChooseWorkspace: () => void;
  export let onOpenWorkspace: () => void;
  export let onRefreshStatus: () => void;
  export let onWorkspacePathInput: (value: string) => void;

  const statusLabels: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    missing: "缺失",
    unversioned: "未版本控制",
    conflicted: "冲突",
    obstructed: "阻塞",
  };

  function labelStatus(status: string) {
    return statusLabels[status] ?? status;
  }

  function statusMeta(file: ChangedFile) {
    return file.property_changed
      ? `${file.path} · 属性 ${file.property_status}`
      : file.path;
  }
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
        <button
          type="button"
          on:click={onRefreshStatus}
          disabled={!workspace || statusLoading}
        >
          {statusLoading ? "刷新中" : "刷新状态"}
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
    <ErrorNotice error={statusError} />

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
    <div class="metric">
      <span>总改动</span>
      <strong>{workingCopyStatus?.total ?? 0}</strong>
    </div>
    <div class="metric">
      <span>未版本控制</span>
      <strong>{workingCopyStatus?.unversioned ?? 0}</strong>
    </div>
    <div class="metric">
      <span>异常</span>
      <strong>
        {(workingCopyStatus?.missing ?? 0) +
          (workingCopyStatus?.conflicted ?? 0) +
          (workingCopyStatus?.obstructed ?? 0)}
      </strong>
    </div>
  </div>

  <div class="work-list">
    {#if workingCopyStatus && workingCopyStatus.files.length > 0}
      {#each workingCopyStatus.files as file}
        <article class:abnormal={file.abnormal} class="work-row">
          <div>
            <h3>{file.path}</h3>
            <p>{statusMeta(file)}</p>
          </div>
          <span>{labelStatus(file.status)}</span>
        </article>
      {/each}
    {:else if workspace}
      <article class="work-row">
        <div>
          <h3>无本地改动</h3>
          <p>状态扫描未发现改动文件</p>
        </div>
        <span>干净</span>
      </article>
    {:else}
      {#each view.primaryItems as item}
        <article class="work-row">
          <div>
            <h3>{item.title}</h3>
            <p>{item.meta}</p>
          </div>
          <span>{item.status}</span>
        </article>
      {/each}
    {/if}
  </div>
</section>
