<script lang="ts">
  import { tick } from "svelte";
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
  export let stagedFiles: Array<{ path: string; status: string }> = [];
  export let statusLoading = false;
  export let statusError: CommandError | null = null;
  export let onChooseWorkspace: () => void;
  export let onOpenWorkspace: () => void;
  export let onRefreshStatus: () => void;
  export let onUpdateWorkspace: () => void;
  export let onCleanupWorkspace: () => void;
  export let onWorkspacePathInput: (value: string) => void;
  export let onSearchTextInput: (value: string) => void;
  export let onToggleGroupByStatus: () => void;
  export let onSelectFile: (path: string) => void;
  export let onStageFile: (path: string) => void;
  export let onUnstageFile: (path: string) => void;

  const fileRowHeight = 76;
  const sectionHeaderHeight = 32;
  const statusHeaderHeight = 28;
  const emptyRowHeight = 54;
  const overscanPx = 360;

  const statusLabels: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    missing: "缺失",
    unversioned: "未版本控制",
    conflicted: "冲突",
    obstructed: "阻塞",
  };

  type FileGroup = {
    status: string;
    files: ChangedFile[];
  };

  type VirtualItem =
    | {
        kind: "section";
        key: string;
        height: number;
        title: string;
      }
    | {
        kind: "status";
        key: string;
        height: number;
        title: string;
      }
    | {
        kind: "empty";
        key: string;
        height: number;
        title: string;
      }
    | {
        kind: "file";
        key: string;
        height: number;
        file: ChangedFile;
        staged: boolean;
      };

  type PositionedVirtualItem = VirtualItem & {
    top: number;
  };

  let virtualListElement: HTMLDivElement | null = null;
  let virtualScrollTop = 0;
  let virtualViewportHeight = 0;

  function labelStatus(status: string) {
    return statusLabels[status] ?? status;
  }

  function statusMeta(file: ChangedFile) {
    return file.property_changed
      ? `${file.path} · 属性 ${file.property_status}`
      : file.path;
  }

  function isStaged(path: string) {
    return stagedFiles.some((file) => file.path === path);
  }

  function isStageable(file: ChangedFile) {
    return !["missing", "conflicted", "obstructed"].includes(file.status);
  }

  function handleRowKeydown(event: KeyboardEvent, path: string) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onSelectFile(path);
  }

  function handleVirtualListKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && ["BUTTON", "INPUT", "TEXTAREA"].includes(target.tagName)) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    }
  }

  function moveSelection(direction: 1 | -1) {
    const selectableItems = positionedVirtualItems.filter((item) => item.kind === "file");
    if (selectableItems.length === 0) {
      return;
    }

    const currentIndex = selectableItems.findIndex(
      (item) => item.kind === "file" && item.file.path === selectedFilePath,
    );
    const fallbackIndex = direction > 0 ? 0 : selectableItems.length - 1;
    const nextIndex =
      currentIndex === -1
        ? fallbackIndex
        : Math.min(Math.max(currentIndex + direction, 0), selectableItems.length - 1);
    const nextItem = selectableItems[nextIndex];
    if (nextItem.kind !== "file") {
      return;
    }

    onSelectFile(nextItem.file.path);
    void scrollFileIntoView(nextItem.file.path);
  }

  async function scrollFileIntoView(path: string) {
    await tick();

    if (!virtualListElement) {
      return;
    }

    const item = positionedVirtualItems.find(
      (candidate) => candidate.kind === "file" && candidate.file.path === path,
    );
    if (!item) {
      return;
    }

    const itemBottom = item.top + item.height;
    const visibleTop = virtualListElement.scrollTop;
    const visibleBottom = visibleTop + virtualListElement.clientHeight;

    if (item.top < visibleTop) {
      virtualListElement.scrollTop = item.top;
    } else if (itemBottom > visibleBottom) {
      virtualListElement.scrollTop = itemBottom - virtualListElement.clientHeight;
    }
  }

  function buildGroups(files: ChangedFile[]) {
    const groups: FileGroup[] = [];

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

  function appendFileItems(items: VirtualItem[], files: ChangedFile[], staged: boolean) {
    for (const file of files) {
      items.push({
        kind: "file",
        key: `${staged ? "staged" : "unstaged"}:${file.path}`,
        height: fileRowHeight,
        file,
        staged,
      });
    }
  }

  function appendGroupedFileItems(
    items: VirtualItem[],
    groups: FileGroup[],
    staged: boolean,
  ) {
    for (const group of groups) {
      items.push({
        kind: "status",
        key: `${staged ? "staged" : "unstaged"}:status:${group.status}`,
        height: statusHeaderHeight,
        title: `${labelStatus(group.status)} · ${group.files.length}`,
      });
      appendFileItems(items, group.files, staged);
    }
  }

  function buildVirtualItems(
    stagedFilesInView: ChangedFile[],
    stagedGroupsInView: FileGroup[],
    unstagedFilesInView: ChangedFile[],
    unstagedGroupsInView: FileGroup[],
    shouldGroupByStatus: boolean,
  ) {
    const items: VirtualItem[] = [];

    items.push({
      kind: "section",
      key: "section:staged",
      height: sectionHeaderHeight,
      title: `已暂存 · ${stagedFilesInView.length}`,
    });

    if (stagedFilesInView.length === 0) {
      items.push({
        kind: "empty",
        key: "empty:staged",
        height: emptyRowHeight,
        title: "暂无已暂存文件",
      });
    } else if (shouldGroupByStatus) {
      appendGroupedFileItems(items, stagedGroupsInView, true);
    } else {
      appendFileItems(items, stagedFilesInView, true);
    }

    items.push({
      kind: "section",
      key: "section:unstaged",
      height: sectionHeaderHeight,
      title: `未暂存 · ${unstagedFilesInView.length}`,
    });

    if (unstagedFilesInView.length === 0) {
      items.push({
        kind: "empty",
        key: "empty:unstaged",
        height: emptyRowHeight,
        title: "暂无未暂存文件",
      });
    } else if (shouldGroupByStatus) {
      appendGroupedFileItems(items, unstagedGroupsInView, false);
    } else {
      appendFileItems(items, unstagedFilesInView, false);
    }

    return items;
  }

  function positionVirtualItems(items: VirtualItem[]) {
    let top = 0;
    return items.map((item) => {
      const positionedItem = { ...item, top };
      top += item.height;
      return positionedItem;
    });
  }

  function getVisibleVirtualItems(
    items: PositionedVirtualItem[],
    scrollTop: number,
    measuredViewportHeight: number,
    elementViewportHeight: number,
  ) {
    const viewportHeight = measuredViewportHeight || elementViewportHeight || 560;
    const start = Math.max(scrollTop - overscanPx, 0);
    const end = scrollTop + viewportHeight + overscanPx;
    return items.filter((item) => item.top + item.height >= start && item.top <= end);
  }

  $: changedFiles = workingCopyStatus?.files ?? [];
  $: normalizedSearch = searchText.trim().toLowerCase();
  $: filteredFiles = normalizedSearch
    ? changedFiles.filter((file) => file.path.toLowerCase().includes(normalizedSearch))
    : changedFiles;
  $: stagedVisibleFiles = filteredFiles.filter((file) => isStaged(file.path));
  $: unstagedVisibleFiles = filteredFiles.filter((file) => !isStaged(file.path));
  $: groupedStagedFiles = buildGroups(stagedVisibleFiles);
  $: groupedUnstagedFiles = buildGroups(unstagedVisibleFiles);
  $: virtualItems = buildVirtualItems(
    stagedVisibleFiles,
    groupedStagedFiles,
    unstagedVisibleFiles,
    groupedUnstagedFiles,
    groupByStatus,
  );
  $: positionedVirtualItems = positionVirtualItems(virtualItems);
  $: lastVirtualItem = positionedVirtualItems.at(-1);
  $: totalVirtualHeight = lastVirtualItem ? lastVirtualItem.top + lastVirtualItem.height : 0;
  $: visibleVirtualItems = getVisibleVirtualItems(
    positionedVirtualItems,
    virtualScrollTop,
    virtualViewportHeight,
    virtualListElement?.clientHeight ?? 0,
  );
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
        <button type="button" on:click={onUpdateWorkspace} disabled={!workspace}>
          更新
        </button>
        <button type="button" on:click={onCleanupWorkspace} disabled={!workspace}>
          清理
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
      <span>已暂存</span>
      <strong>{stagedFiles.length}</strong>
    </div>
    <div class="metric">
      <span>未暂存</span>
      <strong>{Math.max((workingCopyStatus?.total ?? 0) - stagedFiles.length, 0)}</strong>
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
    <span>异常 {abnormalCount}</span>
    <span>显示 {filteredFiles.length}</span>
  </section>

  <div
    role="listbox"
    aria-label="改动文件列表"
    class="work-list"
    class:virtual-work-list={workingCopyStatus && filteredFiles.length > 0}
    bind:this={virtualListElement}
    bind:clientHeight={virtualViewportHeight}
    tabindex={workingCopyStatus && filteredFiles.length > 0 ? 0 : undefined}
    on:scroll={(event) => {
      virtualScrollTop = (event.currentTarget as HTMLDivElement).scrollTop;
    }}
    on:keydown={handleVirtualListKeydown}
  >
    {#if workingCopyStatus && filteredFiles.length > 0}
      <div class="virtual-work-spacer" style={`height: ${totalVirtualHeight}px;`}>
        {#each visibleVirtualItems as item (item.key)}
          <div
            class="virtual-list-item"
            style={`transform: translateY(${item.top}px); height: ${item.height}px;`}
          >
            {#if item.kind === "section"}
              <h3 class="stage-section-heading">{item.title}</h3>
            {:else if item.kind === "status"}
              <h3 class="status-group-heading">{item.title}</h3>
            {:else if item.kind === "empty"}
              <p class="empty-stage virtual-empty">{item.title}</p>
            {:else if item.kind === "file"}
              <div
                role="option"
                aria-selected={selectedFilePath === item.file.path}
                tabindex="0"
                class:abnormal={item.file.abnormal}
                class:active={selectedFilePath === item.file.path}
                class="work-row"
                on:click={() => onSelectFile(item.file.path)}
                on:keydown={(event) => handleRowKeydown(event, item.file.path)}
              >
                <div>
                  <h3>{item.file.path}</h3>
                  <p>{statusMeta(item.file)}</p>
                </div>
                <span>{labelStatus(item.file.status)}</span>
                {#if item.staged}
                  <button
                    type="button"
                    class="stage-action"
                    on:click|stopPropagation={() => onUnstageFile(item.file.path)}
                  >
                    取消暂存
                  </button>
                {:else}
                  <button
                    type="button"
                    class="stage-action"
                    disabled={!isStageable(item.file)}
                    on:click|stopPropagation={() => onStageFile(item.file.path)}
                  >
                    {isStageable(item.file) ? "暂存" : "不可暂存"}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
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
