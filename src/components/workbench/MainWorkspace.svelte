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
  export let searchText = "";
  export let groupByStatus = true;
  export let selectedFilePath: string | null = null;
  export let statusLoading = false;
  export let statusError: CommandError | null = null;
  export let onChooseWorkspace: () => void;
  export let onOpenWorkspace: () => void;
  export let onRefreshStatus: () => void;
  export let onWorkspacePathInput: (value: string) => void;
  export let onSearchTextInput: (value: string) => void;
  export let onToggleGroupByStatus: () => void;
  export let onSelectFile: (path: string) => void;

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

  function buildGroups(files: ChangedFile[]) {
    const groups: Array<{ status: string; files: ChangedFile[] }> = [];

    for (const file of files) {
      let group = groups.find((item) => item.status === file.status);
      if (!group) {
        group = { status: file.status, files: [] };
        groups.push(group);
      }
      group.files.push(file);
    }

    return groups;
  }

  $: changedFiles = workingCopyStatus?.files ?? [];
  $: normalizedSearch = searchText.trim().toLowerCase();
  $: filteredFiles = normalizedSearch
    ? changedFiles.filter((file) => file.path.toLowerCase().includes(normalizedSearch))
    : changedFiles;
  $: groupedFiles = buildGroups(filteredFiles);
  $: abnormalCount =
    (workingCopyStatus?.missing ?? 0) +
    (workingCopyStatus?.conflicted ?? 0) +
    (workingCopyStatus?.obstructed ?? 0);
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
      <span>未暂存</span>
      <strong>{workingCopyStatus?.total ?? 0}</strong>
    </div>
    <div class="metric">
      <span>异常</span>
      <strong>{abnormalCount}</strong>
    </div>
  </div>

  <section class="changes-toolbar">
    <input
      type="search"
      value={searchText}
      placeholder="搜索文件路径"
      on:input={(event) =>
        onSearchTextInput((event.currentTarget as HTMLInputElement).value)}
    />
    <button type="button" class:active={groupByStatus} on:click={onToggleGroupByStatus}>
      按状态分组
    </button>
    <span>已暂存 0</span>
    <span>显示 {filteredFiles.length}</span>
  </section>

  <div class="work-list">
    {#if workingCopyStatus && filteredFiles.length > 0}
      {#if groupByStatus}
        {#each groupedFiles as group}
          <section class="status-group">
            <h3>{labelStatus(group.status)} · {group.files.length}</h3>
            {#each group.files as file}
              <button
                type="button"
                class:abnormal={file.abnormal}
                class:active={selectedFilePath === file.path}
                class="work-row"
                on:click={() => onSelectFile(file.path)}
              >
                <div>
                  <h3>{file.path}</h3>
                  <p>{statusMeta(file)}</p>
                </div>
                <span>{labelStatus(file.status)}</span>
              </button>
            {/each}
          </section>
        {/each}
      {:else}
        {#each filteredFiles as file}
          <button
            type="button"
            class:abnormal={file.abnormal}
            class:active={selectedFilePath === file.path}
            class="work-row"
            on:click={() => onSelectFile(file.path)}
          >
            <div>
              <h3>{file.path}</h3>
              <p>{statusMeta(file)}</p>
            </div>
            <span>{labelStatus(file.status)}</span>
          </button>
        {/each}
      {/if}
    {:else if workingCopyStatus && changedFiles.length > 0}
      <article class="work-row">
        <div>
          <h3>没有匹配结果</h3>
          <p>调整搜索内容后重试</p>
        </div>
        <span>过滤</span>
      </article>
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
