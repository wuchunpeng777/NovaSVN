<script lang="ts">
  import { tick } from "svelte";
  import ErrorNotice from "../ErrorNotice.svelte";
  import type {
    BranchPool,
    ChangedFile,
    CommandError,
    RepositoryCopyKind,
    RepositoryListResult,
    RevisionDiffMode,
    RevisionDiffResult,
    SvnLog,
    TaskWorkspaceList,
    WorkingCopyStatus,
    WorkspaceSummary,
  } from "../../types/api";
  import type {
    WorkbenchView,
    ReviewedFileState,
    WorkspaceGroupMode,
    WorkspaceStageFilter,
  } from "../../types/app";

  export let view: WorkbenchView;
  export let workspace: WorkspaceSummary | null = null;
  export let workspacePathInput = "";
  export let workspaceLoading = false;
  export let workspaceError: CommandError | null = null;
  export let workingCopyStatus: WorkingCopyStatus | null = null;
  export let searchText = "";
  export let groupByStatus = true;
  export let stageFilter: WorkspaceStageFilter = "all";
  export let abnormalOnly = false;
  export let unreviewedOnly = false;
  export let statusFilters: string[] = [];
  export let groupMode: WorkspaceGroupMode = "status";
  export let selectedFilePath: string | null = null;
  export let stagedFiles: Array<{ path: string; status: string }> = [];
  export let reviewedFiles: ReviewedFileState[] = [];
  export let statusLoading = false;
  export let statusError: CommandError | null = null;
  export let repositoryUrlInput = "";
  export let repositoryList: RepositoryListResult | null = null;
  export let repositoryLoading = false;
  export let repositoryError: string | null = null;
  export let repositoryLayout = {
    trunkPath: "trunk",
    branchesPath: "branches",
    tagsPath: "tags",
  };
  export let repositoryLayoutResults: {
    trunk: RepositoryListResult | null;
    branches: RepositoryListResult | null;
    tags: RepositoryListResult | null;
  } = {
    trunk: null,
    branches: null,
    tags: null,
  };
  export let repositoryLayoutErrors: {
    trunk: string | null;
    branches: string | null;
    tags: string | null;
  } = {
    trunk: null,
    branches: null,
    tags: null,
  };
  export let repositoryLayoutLoading = false;
  export let repositoryCopyForm: {
    kind: RepositoryCopyKind;
    sourceUrl: string;
    targetUrl: string;
    revision: string;
    message: string;
  } = {
    kind: "branch",
    sourceUrl: "",
    targetUrl: "",
    revision: "",
    message: "",
  };
  export let repositoryCopyError: string | null = null;
  export let repositoryCopyRunning = false;
  export let branchPool: BranchPool = { entries: [] };
  export let branchPoolForm = {
    branchUrl: "",
    localPath: "",
    revision: "",
  };
  export let branchPoolLoading = false;
  export let branchPoolError: CommandError | null = null;
  export let branchCheckoutError: string | null = null;
  export let branchCheckoutRunning = false;
  export let mergeForm = {
    sourceUrl: "",
    startRevision: "",
    endRevision: "",
    dryRun: true,
  };
  export let mergeRunning = false;
  export let mergeError: string | null = null;
  export let taskWorkspaces: TaskWorkspaceList = { entries: [] };
  export let taskWorkspaceForm = {
    name: "",
    branchPoolEntryId: "",
  };
  export let activeTaskWorkspaceId: string | null = null;
  export let taskWorkspaceLoading = false;
  export let taskWorkspaceError: CommandError | null = null;
  export let svnSwitchTargetUrl = "";
  export let svnSwitchError: string | null = null;
  export let svnSwitchRunning = false;
  export let svnLog: SvnLog | null = null;
  export let svnLogLoading = false;
  export let svnLogError: CommandError | null = null;
  export let svnLogAuthorFilter = "";
  export let svnLogKeywordFilter = "";
  export let svnLogDateFromFilter = "";
  export let svnLogDateToFilter = "";
  export let svnLogFileOnly = false;
  export let svnLogLimit = 50;
  export let revisionDiffForm: {
    mode: RevisionDiffMode;
    leftRevision: string;
    rightRevision: string;
    leftUrl: string;
    rightUrl: string;
  } = {
    mode: "revisions",
    leftRevision: "",
    rightRevision: "",
    leftUrl: "",
    rightUrl: "",
  };
  export let revisionDiffLoading = false;
  export let revisionDiffError: string | null = null;
  export let revisionDiffResult: RevisionDiffResult | null = null;
  export let onChooseWorkspace: () => void;
  export let onOpenWorkspace: () => void;
  export let onRefreshStatus: () => void;
  export let onUpdateWorkspace: () => void;
  export let onCleanupWorkspace: () => void;
  export let onWorkspacePathInput: (value: string) => void;
  export let onSearchTextInput: (value: string) => void;
  export let onToggleGroupByStatus: () => void;
  export let onToggleUnreviewedOnly: () => void;
  export let onGroupModeChange: (value: WorkspaceGroupMode) => void;
  export let onClearFilters: () => void;
  export let onSelectFile: (path: string) => void;
  export let onStageFile: (path: string) => void;
  export let onUnstageFile: (path: string) => void;
  export let onRepositoryUrlInput: (value: string) => void;
  export let onUseWorkspaceRepositoryRoot: () => void;
  export let onLoadRepositoryUrl: (url?: string) => void;
  export let onRepositoryLayoutPathInput: (
    kind: "trunk" | "branches" | "tags",
    value: string,
  ) => void;
  export let onDetectRepositoryLayout: () => void;
  export let onRepositoryCopyFormInput: (
    field: keyof typeof repositoryCopyForm,
    value: string,
  ) => void;
  export let onPrepareRepositoryCopyTarget: (
    kind: RepositoryCopyKind,
    targetBaseUrl?: string | null,
  ) => void;
  export let onCreateRepositoryCopy: () => void;
  export let onBranchPoolFormInput: (
    field: keyof typeof branchPoolForm,
    value: string,
  ) => void;
  export let onUseBranchUrlForPool: (branchUrl: string) => void;
  export let onCheckoutBranchPoolEntry: () => void;
  export let onReuseBranchPoolEntry: () => void;
  export let onOpenBranchPoolEntry: (localPath: string) => void;
  export let onRemoveBranchPoolEntry: (entryId: string) => void;
  export let onMergeFormInput: (
    field: keyof typeof mergeForm,
    value: string | boolean,
  ) => void;
  export let onUseRepositoryUrlForMerge: (url: string) => void;
  export let onRunMerge: () => void;
  export let onTaskWorkspaceFormInput: (
    field: keyof typeof taskWorkspaceForm,
    value: string,
  ) => void;
  export let onCreateTaskWorkspace: () => void;
  export let onSwitchTaskWorkspace: (taskId: string) => void;
  export let onRemoveTaskWorkspace: (taskId: string) => void;
  export let onSvnSwitchTargetInput: (value: string) => void;
  export let onRunSvnSwitch: () => void;
  export let onRefreshSvnLog: () => void;
  export let onSvnLogFilterInput: (
    field:
      | "svnLogAuthorFilter"
      | "svnLogKeywordFilter"
      | "svnLogDateFromFilter"
      | "svnLogDateToFilter",
    value: string,
  ) => void;
  export let onSvnLogFileOnlyInput: (value: boolean) => void;
  export let onSvnLogLimitInput: (value: number) => void;
  export let onRevisionDiffFormInput: (
    field: keyof typeof revisionDiffForm,
    value: string,
  ) => void;
  export let onRunRevisionDiff: () => void;
  export let onPrepareRevisionDiffFromLog: (revision: string) => void;
  export let onExportRevisionDiffPatch: () => void;

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
    key: string;
    label: string;
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
        groupKey: string;
        height: number;
        title: string;
        collapsed: boolean;
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
  let collapsedGroups = new Set<string>();

  function labelStatus(status: string) {
    return statusLabels[status] ?? status;
  }

  function statusMeta(file: ChangedFile) {
    return file.property_changed
      ? `${file.path} · 属性 ${file.property_status}`
      : file.path;
  }

  function isStaged(path: string, stagedPaths = stagedFilePaths) {
    return stagedPaths.has(path);
  }

  function isReviewed(path: string, reviewedPaths = reviewedFilePaths) {
    return reviewedPaths.has(path);
  }

  function isStageable(file: ChangedFile) {
    return !["missing", "conflicted", "obstructed"].includes(file.status);
  }

  function filterFiles(
    files: ChangedFile[],
    search: string,
    currentStageFilter: WorkspaceStageFilter,
    currentAbnormalOnly: boolean,
    currentUnreviewedOnly: boolean,
    currentStatusFilters: string[],
    stagedPaths: Set<string>,
    reviewedPaths: Set<string>,
  ) {
    const selectedStatuses = new Set(currentStatusFilters);
    return files.filter((file) => {
      if (search && !file.path.toLowerCase().includes(search)) {
        return false;
      }

      if (currentStageFilter === "staged" && !isStaged(file.path, stagedPaths)) {
        return false;
      }

      if (currentStageFilter === "unstaged" && isStaged(file.path, stagedPaths)) {
        return false;
      }

      if (currentAbnormalOnly && !file.abnormal) {
        return false;
      }

      if (currentUnreviewedOnly && isReviewed(file.path, reviewedPaths)) {
        return false;
      }

      if (selectedStatuses.size > 0 && !selectedStatuses.has(file.status)) {
        return false;
      }

      return true;
    });
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

  function buildGroups(files: ChangedFile[], mode: WorkspaceGroupMode) {
    const groups: FileGroup[] = [];

    for (const file of files) {
      const key = getGroupKey(file, mode);
      let group = groups.find((item) => item.key === key);
      if (!group) {
        group = { key, label: getGroupLabel(file, mode), files: [] };
        groups.push(group);
      }
      group.files.push(file);
    }

    return groups;
  }

  function getGroupKey(file: ChangedFile, mode: WorkspaceGroupMode) {
    if (mode === "directory") {
      const directory = getDirectoryName(file.path);
      return `directory:${directory}`;
    }

    if (mode === "extension") {
      const extension = getFileExtension(file.path);
      return `extension:${extension}`;
    }

    return `status:${file.status}`;
  }

  function getGroupLabel(file: ChangedFile, mode: WorkspaceGroupMode) {
    if (mode === "directory") {
      return getDirectoryName(file.path);
    }

    if (mode === "extension") {
      return getFileExtension(file.path);
    }

    return labelStatus(file.status);
  }

  function getDirectoryName(path: string) {
    const normalizedPath = path.replaceAll("\\", "/");
    const index = normalizedPath.lastIndexOf("/");
    return index > 0 ? normalizedPath.slice(0, index) : "根目录";
  }

  function getFileExtension(path: string) {
    const fileName = path.replaceAll("\\", "/").split("/").pop() ?? path;
    const index = fileName.lastIndexOf(".");
    return index > 0 && index < fileName.length - 1
      ? fileName.slice(index + 1).toLowerCase()
      : "无扩展名";
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
    currentCollapsedGroups: Set<string>,
  ) {
    for (const group of groups) {
      const scopedGroupKey = `${staged ? "staged" : "unstaged"}:${group.key}`;
      items.push({
        kind: "status",
        key: `${staged ? "staged" : "unstaged"}:group:${group.key}`,
        groupKey: scopedGroupKey,
        height: statusHeaderHeight,
        title: `${group.label} · ${group.files.length}`,
        collapsed: currentCollapsedGroups.has(scopedGroupKey),
      });
      if (!currentCollapsedGroups.has(scopedGroupKey)) {
        appendFileItems(items, group.files, staged);
      }
    }
  }

  function buildVirtualItems(
    stagedFilesInView: ChangedFile[],
    stagedGroupsInView: FileGroup[],
    unstagedFilesInView: ChangedFile[],
    unstagedGroupsInView: FileGroup[],
    shouldGroupByStatus: boolean,
    currentCollapsedGroups: Set<string>,
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
      appendGroupedFileItems(items, stagedGroupsInView, true, currentCollapsedGroups);
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
      appendGroupedFileItems(items, unstagedGroupsInView, false, currentCollapsedGroups);
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

  function toggleGroupCollapse(key: string) {
    collapsedGroups = new Set(collapsedGroups);
    if (collapsedGroups.has(key)) {
      collapsedGroups.delete(key);
    } else {
      collapsedGroups.add(key);
    }
  }

  function joinRepositoryUrl(baseUrl: string, name: string) {
    return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(name)}`;
  }

  function parentRepositoryUrl(url: string) {
    const normalized = url.replace(/\/+$/, "");
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex <= "https://".length) {
      return normalized;
    }

    return normalized.slice(0, slashIndex);
  }

  function repositoryBreadcrumbs(url: string) {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      return [];
    }

    const protocolMatch = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\//i);
    if (!protocolMatch) {
      const segments = trimmed.split("/").filter(Boolean);
      return segments.map((segment, index) => ({
        label: segment,
        url: segments.slice(0, index + 1).join("/"),
      }));
    }

    const prefix = protocolMatch[0];
    const rest = trimmed.slice(prefix.length);
    const [host = "", ...segments] = rest.split("/").filter(Boolean);
    return [
      { label: `${prefix}${host}`, url: `${prefix}${host}` },
      ...segments.map((segment, index) => ({
        label: segment,
        url: `${prefix}${host}/${segments.slice(0, index + 1).join("/")}`,
      })),
    ];
  }

  function formatRepositoryDate(value: string) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  function filterLogEntries(
    entries: SvnLog["entries"],
    author: string,
    keyword: string,
    dateFrom: string,
    dateTo: string,
  ) {
    const normalizedAuthor = author.trim().toLowerCase();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

    return entries.filter((entry) => {
      const entryTime = new Date(entry.date).getTime();
      if (normalizedAuthor && !entry.author.toLowerCase().includes(normalizedAuthor)) {
        return false;
      }
      if (
        normalizedKeyword &&
        !`${entry.revision} ${entry.message} ${entry.changed_paths.map((path) => path.path).join(" ")}`
          .toLowerCase()
          .includes(normalizedKeyword)
      ) {
        return false;
      }
      if (fromTime !== null && !Number.isNaN(entryTime) && entryTime < fromTime) {
        return false;
      }
      if (toTime !== null && !Number.isNaN(entryTime) && entryTime > toTime) {
        return false;
      }

      return true;
    });
  }

  $: changedFiles = workingCopyStatus?.files ?? [];
  $: normalizedSearch = searchText.trim().toLowerCase();
  $: stagedFilePaths = new Set(stagedFiles.map((file) => file.path));
  $: reviewedFilePaths = new Set(reviewedFiles.map((file) => file.path));
  $: filteredFiles = filterFiles(
    changedFiles,
    normalizedSearch,
    stageFilter,
    abnormalOnly,
    unreviewedOnly,
    statusFilters,
    stagedFilePaths,
    reviewedFilePaths,
  );
  $: stagedVisibleFiles = filteredFiles.filter((file) => isStaged(file.path, stagedFilePaths));
  $: unstagedVisibleFiles = filteredFiles.filter((file) => !isStaged(file.path, stagedFilePaths));
  $: groupedStagedFiles = buildGroups(stagedVisibleFiles, groupMode);
  $: groupedUnstagedFiles = buildGroups(unstagedVisibleFiles, groupMode);
  $: virtualItems = buildVirtualItems(
    stagedVisibleFiles,
    groupedStagedFiles,
    unstagedVisibleFiles,
    groupedUnstagedFiles,
    groupByStatus,
    collapsedGroups,
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
  $: reviewedCount = changedFiles.filter((file) => isReviewed(file.path)).length;
  $: unreviewedCount = Math.max(changedFiles.length - reviewedCount, 0);
  $: repositoryEntries = repositoryList?.entries ?? [];
  $: repositoryDirectoryCount = repositoryEntries.filter((entry) => entry.kind === "dir").length;
  $: repositoryFileCount = repositoryEntries.filter((entry) => entry.kind !== "dir").length;
  $: repositoryCurrentUrl = repositoryList?.url ?? repositoryUrlInput.trim();
  $: breadcrumbs = repositoryBreadcrumbs(repositoryCurrentUrl);
  $: branchEntries = repositoryLayoutResults.branches?.entries.filter(
    (entry) => entry.kind === "dir",
  ) ?? [];
  $: tagEntries = repositoryLayoutResults.tags?.entries.filter(
    (entry) => entry.kind === "dir",
  ) ?? [];
  $: trunkDetected = repositoryLayoutResults.trunk !== null && !repositoryLayoutErrors.trunk;
  $: totalBranchLocalChanges = branchPool.entries.reduce(
    (total, entry) => total + entry.local_changes,
    0,
  );
  $: selectedTaskBranch = branchPool.entries.find(
    (entry) => entry.id === taskWorkspaceForm.branchPoolEntryId,
  );
  $: filteredLogEntries = filterLogEntries(
    svnLog?.entries ?? [],
    svnLogAuthorFilter,
    svnLogKeywordFilter,
    svnLogDateFromFilter,
    svnLogDateToFilter,
  );
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
          <dt>Unity</dt>
          <dd>{workspace.unity.detected ? "已识别" : "未识别"}</dd>
        </div>
        <div>
          <dt>Local Path</dt>
          <dd>{workspace.local_path}</dd>
        </div>
      </dl>
      {#if workspace.unity.detected}
        <div class="unity-summary">
          <span>Assets</span>
          <span>ProjectSettings</span>
          <span>Packages/manifest.json</span>
        </div>
      {/if}
    {/if}
  </section>

  {#if view.id === "history"}
    <div class="metric-row">
      <div class="metric">
        <span>Revision</span>
        <strong>{svnLog?.entries.length ?? 0}</strong>
      </div>
      <div class="metric">
        <span>显示</span>
        <strong>{filteredLogEntries.length}</strong>
      </div>
      <div class="metric">
        <span>目标</span>
        <strong>{svnLogFileOnly ? "文件" : "工作副本"}</strong>
      </div>
      <div class="metric">
        <span>Limit</span>
        <strong>{svnLogLimit}</strong>
      </div>
      <div class="metric">
        <span>状态</span>
        <strong>{svnLogLoading ? "加载" : svnLog ? "完成" : "待查"}</strong>
      </div>
    </div>

    <section class="svn-log-panel" aria-label="SVN 日志过滤">
      <div class="repository-layout-header">
        <div>
          <h3>SVN Log</h3>
          <p>{svnLog?.target ?? "读取工作副本或选中文件历史"}</p>
        </div>
        <button type="button" on:click={onRefreshSvnLog} disabled={!workspace || svnLogLoading}>
          {svnLogLoading ? "加载中" : "读取日志"}
        </button>
      </div>

      <div class="svn-log-filters">
        <input
          type="search"
          value={svnLogAuthorFilter}
          placeholder="作者"
          on:input={(event) =>
            onSvnLogFilterInput(
              "svnLogAuthorFilter",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
        <input
          type="search"
          value={svnLogKeywordFilter}
          placeholder="关键字"
          on:input={(event) =>
            onSvnLogFilterInput(
              "svnLogKeywordFilter",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
        <input
          type="date"
          value={svnLogDateFromFilter}
          on:input={(event) =>
            onSvnLogFilterInput(
              "svnLogDateFromFilter",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
        <input
          type="date"
          value={svnLogDateToFilter}
          on:input={(event) =>
            onSvnLogFilterInput(
              "svnLogDateToFilter",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
        <input
          type="number"
          min="1"
          max="200"
          value={svnLogLimit}
          on:input={(event) =>
            onSvnLogLimitInput(Number((event.currentTarget as HTMLInputElement).value))}
        />
        <label>
          <input
            type="checkbox"
            checked={svnLogFileOnly}
            on:change={(event) =>
              onSvnLogFileOnlyInput((event.currentTarget as HTMLInputElement).checked)}
          />
          <span>选中文件</span>
        </label>
      </div>
      <ErrorNotice error={svnLogError} />
    </section>

    <section class="revision-diff-panel" aria-label="Revision Diff 和分支比较">
      <div class="repository-layout-header">
        <div>
          <h3>Revision Diff</h3>
          <p>{revisionDiffResult?.target ?? "比较 revision、工作副本或两个分支 URL"}</p>
        </div>
        <div class="repository-copy-presets">
          <button
            type="button"
            on:click={onRunRevisionDiff}
            disabled={revisionDiffLoading}
          >
            {revisionDiffLoading ? "比较中" : "开始比较"}
          </button>
          <button
            type="button"
            on:click={onExportRevisionDiffPatch}
            disabled={!revisionDiffResult?.diff_text}
          >
            导出 patch
          </button>
        </div>
      </div>

      <div class="revision-diff-mode" role="group" aria-label="Diff 类型">
        <button
          type="button"
          class:active={revisionDiffForm.mode === "revisions"}
          on:click={() => onRevisionDiffFormInput("mode", "revisions")}
        >
          Revision
        </button>
        <button
          type="button"
          class:active={revisionDiffForm.mode === "working_copy_to_revision"}
          on:click={() => onRevisionDiffFormInput("mode", "working_copy_to_revision")}
        >
          工作副本
        </button>
        <button
          type="button"
          class:active={revisionDiffForm.mode === "urls"}
          on:click={() => onRevisionDiffFormInput("mode", "urls")}
        >
          分支 URL
        </button>
      </div>

      {#if revisionDiffForm.mode === "urls"}
        <div class="revision-diff-grid">
          <label>
            <span>左侧 URL</span>
            <input
              type="url"
              value={revisionDiffForm.leftUrl}
              on:input={(event) =>
                onRevisionDiffFormInput(
                  "leftUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label>
            <span>右侧 URL</span>
            <input
              type="url"
              value={revisionDiffForm.rightUrl}
              on:input={(event) =>
                onRevisionDiffFormInput(
                  "rightUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
        </div>
      {:else}
        <div class="revision-diff-grid">
          {#if revisionDiffForm.mode === "revisions"}
            <label>
              <span>左侧 Revision</span>
              <input
                type="text"
                value={revisionDiffForm.leftRevision}
                placeholder="例如 120"
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "leftRevision",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
          {/if}
          <label>
            <span>{revisionDiffForm.mode === "revisions" ? "右侧 Revision" : "目标 Revision"}</span>
            <input
              type="text"
              value={revisionDiffForm.rightRevision}
              placeholder={workspace?.revision ?? "例如 HEAD"}
              on:input={(event) =>
                onRevisionDiffFormInput(
                  "rightRevision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
        </div>
      {/if}

      {#if revisionDiffError}
        <p class="inline-error">{revisionDiffError}</p>
      {/if}

      <div class="revision-diff-summary">
        <span>文件 {revisionDiffResult?.file_count ?? 0}</span>
        <span>行 {revisionDiffResult?.line_count ?? 0}</span>
        <span>{revisionDiffResult?.mode ?? revisionDiffForm.mode}</span>
      </div>

      <pre class="revision-diff-preview">{revisionDiffResult?.diff_text || "暂无 diff 结果"}</pre>
    </section>

    <section class="svn-log-list" aria-label="SVN 日志列表">
      {#if filteredLogEntries.length > 0}
        {#each filteredLogEntries as entry (entry.revision)}
          <article class="svn-log-entry">
            <header>
              <strong>r{entry.revision}</strong>
              <span>{entry.author || "-"}</span>
              <span>{formatRepositoryDate(entry.date)}</span>
              <button type="button" on:click={() => onPrepareRevisionDiffFromLog(entry.revision)}>
                比较
              </button>
            </header>
            <p>{entry.message || "无提交信息"}</p>
            <div class="svn-log-paths">
              {#each entry.changed_paths as path (`${entry.revision}:${path.path}:${path.action}`)}
                <span>{path.action || "-"} {path.path}</span>
              {/each}
            </div>
          </article>
        {/each}
      {:else if svnLog}
        <article class="repository-empty">没有匹配的日志</article>
      {:else}
        <article class="repository-empty">点击读取日志开始查看历史</article>
      {/if}
    </section>
  {:else if view.id === "staging"}
    <div class="metric-row">
      <div class="metric">
        <span>任务</span>
        <strong>{taskWorkspaces.entries.length}</strong>
      </div>
      <div class="metric">
        <span>分支池</span>
        <strong>{branchPool.entries.length}</strong>
      </div>
      <div class="metric">
        <span>已暂存</span>
        <strong>{stagedFiles.length}</strong>
      </div>
      <div class="metric">
        <span>已审</span>
        <strong>{reviewedCount}</strong>
      </div>
      <div class="metric">
        <span>当前</span>
        <strong>{activeTaskWorkspaceId ? "任务" : "无"}</strong>
      </div>
    </div>

    <section class="task-workspace-panel" aria-label="任务工作区">
      <div class="repository-layout-header">
        <div>
          <h3>任务工作区</h3>
          <p>任务保存 NovaSVN 草稿，不影响 SVN 元数据</p>
        </div>
      </div>

      <div class="task-workspace-form">
        <label>
          <span>任务名称</span>
          <input
            type="text"
            value={taskWorkspaceForm.name}
            on:input={(event) =>
              onTaskWorkspaceFormInput(
                "name",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label>
          <span>绑定分支工作副本</span>
          <select
            value={taskWorkspaceForm.branchPoolEntryId}
            on:change={(event) =>
              onTaskWorkspaceFormInput(
                "branchPoolEntryId",
                (event.currentTarget as HTMLSelectElement).value,
              )}
          >
            <option value="">选择分支工作副本</option>
            {#each branchPool.entries as entry (entry.id)}
              <option value={entry.id}>{entry.branch_url}</option>
            {/each}
          </select>
        </label>
        <button
          type="button"
          on:click={onCreateTaskWorkspace}
          disabled={taskWorkspaceLoading || !taskWorkspaceForm.branchPoolEntryId}
        >
          创建任务
        </button>
      </div>

      {#if selectedTaskBranch}
        <p class="task-workspace-bound">{selectedTaskBranch.local_path}</p>
      {/if}
      <ErrorNotice error={taskWorkspaceError} />
    </section>

    <section class="task-workspace-list" aria-label="任务工作区列表">
      {#if taskWorkspaces.entries.length > 0}
        {#each taskWorkspaces.entries as entry (entry.id)}
          <article class="task-workspace-entry" class:active={entry.id === activeTaskWorkspaceId}>
            <div>
              <h3>{entry.name}</h3>
              <p>{entry.branch_url || entry.local_path}</p>
            </div>
            <span>{entry.id === activeTaskWorkspaceId ? "当前" : "任务"}</span>
            <button type="button" on:click={() => onSwitchTaskWorkspace(entry.id)}>
              切换
            </button>
            <button type="button" on:click={() => onRemoveTaskWorkspace(entry.id)}>
              删除
            </button>
          </article>
        {/each}
      {:else}
        <article class="repository-empty">暂无任务工作区</article>
      {/if}
    </section>
  {:else if view.id === "branches"}
    <div class="metric-row">
      <div class="metric">
        <span>池项</span>
        <strong>{branchPool.entries.length}</strong>
      </div>
      <div class="metric">
        <span>本地改动</span>
        <strong>{totalBranchLocalChanges}</strong>
      </div>
      <div class="metric">
        <span>当前</span>
        <strong>{workspace ? "已打开" : "未打开"}</strong>
      </div>
      <div class="metric">
        <span>状态</span>
        <strong>{branchCheckoutRunning ? "Checkout" : "就绪"}</strong>
      </div>
      <div class="metric">
        <span>保存</span>
        <strong>{branchPoolLoading ? "同步" : "本地"}</strong>
      </div>
    </div>

    <section class="branch-pool-panel" aria-label="分支工作副本池">
      <div class="repository-layout-header">
        <div>
          <h3>分支工作副本池</h3>
          <p>切换池项会打开对应工作副本，不执行 svn switch</p>
        </div>
      </div>

      <div class="branch-pool-form">
        <label>
          <span>分支 URL</span>
          <input
            type="url"
            value={branchPoolForm.branchUrl}
            on:input={(event) =>
              onBranchPoolFormInput(
                "branchUrl",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label>
          <span>本地路径</span>
          <input
            type="text"
            value={branchPoolForm.localPath}
            on:input={(event) =>
              onBranchPoolFormInput(
                "localPath",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label>
          <span>Revision</span>
          <input
            type="text"
            value={branchPoolForm.revision}
            placeholder="留空使用 HEAD"
            on:input={(event) =>
              onBranchPoolFormInput(
                "revision",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
      </div>

      {#if branchCheckoutError}
        <p class="inline-error">{branchCheckoutError}</p>
      {/if}
      <ErrorNotice error={branchPoolError} />

      <div class="branch-pool-actions">
        <button
          type="button"
          on:click={onCheckoutBranchPoolEntry}
          disabled={branchCheckoutRunning}
        >
          {branchCheckoutRunning ? "Checkout 中" : "Checkout 创建"}
        </button>
        <button type="button" on:click={onReuseBranchPoolEntry} disabled={branchPoolLoading}>
          复用已有
        </button>
      </div>
    </section>

    <section class="branch-pool-list" aria-label="分支工作副本池列表">
      {#if branchPool.entries.length > 0}
        {#each branchPool.entries as entry (entry.id)}
          <article class="branch-pool-entry">
            <div>
              <h3>{entry.branch_url}</h3>
              <p>{entry.local_path}</p>
            </div>
            <span>r{entry.revision || "-"}</span>
            <span>{entry.local_changes} 改动</span>
            <button type="button" on:click={() => onOpenBranchPoolEntry(entry.local_path)}>
              切换
            </button>
            <button type="button" on:click={() => onRemoveBranchPoolEntry(entry.id)}>
              移除
            </button>
          </article>
        {/each}
      {:else}
        <article class="repository-empty">暂无分支工作副本池项</article>
      {/if}
    </section>

    <section class="merge-panel" aria-label="Merge 基础流程">
      <div class="repository-layout-header">
        <div>
          <h3>Merge</h3>
          <p>从源 URL 合并到当前工作副本，可先 dry-run</p>
        </div>
        <button
          type="button"
          on:click={onRunMerge}
          disabled={!workspace || mergeRunning || !mergeForm.sourceUrl.trim()}
        >
          {mergeRunning ? "Merge 中" : mergeForm.dryRun ? "Dry-run" : "执行 Merge"}
        </button>
      </div>

      <div class="merge-form">
        <label>
          <span>源 URL</span>
          <input
            type="url"
            value={mergeForm.sourceUrl}
            on:input={(event) =>
              onMergeFormInput(
                "sourceUrl",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label>
          <span>起始 Revision</span>
          <input
            type="text"
            value={mergeForm.startRevision}
            placeholder="留空使用默认"
            on:input={(event) =>
              onMergeFormInput(
                "startRevision",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label>
          <span>结束 Revision</span>
          <input
            type="text"
            value={mergeForm.endRevision}
            placeholder="留空使用默认"
            on:input={(event) =>
              onMergeFormInput(
                "endRevision",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label class="merge-dry-run">
          <input
            type="checkbox"
            checked={mergeForm.dryRun}
            on:change={(event) =>
              onMergeFormInput("dryRun", (event.currentTarget as HTMLInputElement).checked)}
          />
          <span>Dry-run</span>
        </label>
      </div>

      {#if branchPool.entries.length > 0}
        <div class="branch-url-picks">
          {#each branchPool.entries as entry (entry.id)}
            <button type="button" on:click={() => onUseRepositoryUrlForMerge(entry.branch_url)}>
              {entry.branch_url}
            </button>
          {/each}
        </div>
      {/if}

      {#if mergeError}
        <p class="inline-error">{mergeError}</p>
      {/if}
    </section>

    {#if branchEntries.length > 0}
      <section class="branch-pool-panel" aria-label="已识别分支">
        <div class="repository-layout-header">
          <div>
            <h3>已识别分支</h3>
            <p>从仓库视图识别结果快速填入分支 URL</p>
          </div>
        </div>
        <div class="branch-url-picks">
          {#each branchEntries as entry (entry.name)}
            <button
              type="button"
              on:click={() =>
                repositoryLayoutResults.branches &&
                onUseBranchUrlForPool(
                  joinRepositoryUrl(repositoryLayoutResults.branches.url, entry.name),
                )}
            >
              {entry.name}
            </button>
          {/each}
        </div>
      </section>
    {/if}
  {:else if view.id === "repository"}
    <div class="metric-row">
      <div class="metric">
        <span>目录</span>
        <strong>{repositoryDirectoryCount}</strong>
      </div>
      <div class="metric">
        <span>文件</span>
        <strong>{repositoryFileCount}</strong>
      </div>
      <div class="metric">
        <span>总项</span>
        <strong>{repositoryEntries.length}</strong>
      </div>
      <div class="metric">
        <span>状态</span>
        <strong>{repositoryLoading ? "加载" : repositoryList ? "完成" : "待选"}</strong>
      </div>
    </div>

    <section class="repository-browser">
      <div class="repository-toolbar">
        <input
          type="url"
          value={repositoryUrlInput}
          placeholder="输入 SVN 仓库 URL"
          on:input={(event) =>
            onRepositoryUrlInput((event.currentTarget as HTMLInputElement).value)}
          on:keydown={(event) => {
            if (event.key === "Enter") {
              onLoadRepositoryUrl();
            }
          }}
        />
        <button type="button" on:click={onUseWorkspaceRepositoryRoot} disabled={!workspace}>
          使用 Root
        </button>
        <button
          type="button"
          on:click={() => onLoadRepositoryUrl()}
          disabled={repositoryLoading || !repositoryUrlInput.trim()}
        >
          {repositoryLoading ? "加载中" : "浏览"}
        </button>
      </div>

      {#if repositoryError}
        <p class="inline-error">{repositoryError}</p>
      {/if}

      <section class="repository-layout-panel" aria-label="分支和标签识别">
        <div class="repository-layout-header">
          <div>
            <h3>分支和标签</h3>
            <p>标准布局默认识别 trunk、branches、tags</p>
          </div>
          <button
            type="button"
            on:click={onDetectRepositoryLayout}
            disabled={repositoryLayoutLoading || !repositoryUrlInput.trim()}
          >
            {repositoryLayoutLoading ? "识别中" : "识别布局"}
          </button>
        </div>

        <div class="repository-layout-inputs">
          <label>
            <span>trunk</span>
            <input
              type="text"
              value={repositoryLayout.trunkPath}
              on:input={(event) =>
                onRepositoryLayoutPathInput(
                  "trunk",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label>
            <span>branches</span>
            <input
              type="text"
              value={repositoryLayout.branchesPath}
              on:input={(event) =>
                onRepositoryLayoutPathInput(
                  "branches",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label>
            <span>tags</span>
            <input
              type="text"
              value={repositoryLayout.tagsPath}
              on:input={(event) =>
                onRepositoryLayoutPathInput(
                  "tags",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
        </div>

        <div class="repository-layout-summary">
          <article class:active={trunkDetected}>
            <span>trunk</span>
            <strong>{trunkDetected ? "已识别" : "未识别"}</strong>
            {#if repositoryLayoutErrors.trunk}
              <p>{repositoryLayoutErrors.trunk}</p>
            {:else if repositoryLayoutResults.trunk}
              <p>{repositoryLayoutResults.trunk.url}</p>
            {:else}
              <p>等待识别</p>
            {/if}
          </article>
          <article class:active={branchEntries.length > 0}>
            <span>branches</span>
            <strong>{branchEntries.length}</strong>
            {#if repositoryLayoutErrors.branches}
              <p>{repositoryLayoutErrors.branches}</p>
            {:else if repositoryLayoutResults.branches}
              <p>{repositoryLayoutResults.branches.url}</p>
            {:else}
              <p>等待识别</p>
            {/if}
          </article>
          <article class:active={tagEntries.length > 0}>
            <span>tags</span>
            <strong>{tagEntries.length}</strong>
            {#if repositoryLayoutErrors.tags}
              <p>{repositoryLayoutErrors.tags}</p>
            {:else if repositoryLayoutResults.tags}
              <p>{repositoryLayoutResults.tags.url}</p>
            {:else}
              <p>等待识别</p>
            {/if}
          </article>
        </div>

        <div class="repository-layout-lists">
          <section>
            <h4>分支</h4>
            {#if branchEntries.length > 0}
              {#each branchEntries as entry (entry.name)}
                <button
                  type="button"
                  on:click={() =>
                    repositoryLayoutResults.branches &&
                    onLoadRepositoryUrl(
                      joinRepositoryUrl(repositoryLayoutResults.branches.url, entry.name),
                    )}
                >
                  <span>{entry.name}</span>
                  <small>r{entry.revision || "-"} · {entry.author || "-"}</small>
                  <small>{formatRepositoryDate(entry.date)}</small>
                </button>
              {/each}
            {:else}
              <p>暂无分支结果</p>
            {/if}
          </section>
          <section>
            <h4>标签</h4>
            {#if tagEntries.length > 0}
              {#each tagEntries as entry (entry.name)}
                <button
                  type="button"
                  on:click={() =>
                    repositoryLayoutResults.tags &&
                    onLoadRepositoryUrl(
                      joinRepositoryUrl(repositoryLayoutResults.tags.url, entry.name),
                    )}
                >
                  <span>{entry.name}</span>
                  <small>r{entry.revision || "-"} · {entry.author || "-"}</small>
                  <small>{formatRepositoryDate(entry.date)}</small>
                </button>
              {/each}
            {:else}
              <p>暂无标签结果</p>
            {/if}
          </section>
        </div>
      </section>

      <section class="repository-copy-panel" aria-label="创建分支和标签">
        <div class="repository-layout-header">
          <div>
            <h3>创建分支或标签</h3>
            <p>使用 svn copy 从源 URL 创建远端 branch/tag</p>
          </div>
          <div class="repository-copy-presets">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryCopyTarget(
                  "branch",
                  repositoryLayoutResults.branches?.url,
                )}
            >
              新分支
            </button>
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryCopyTarget("tag", repositoryLayoutResults.tags?.url)}
            >
              新标签
            </button>
          </div>
        </div>

        <div class="repository-copy-kind" role="group" aria-label="创建类型">
          <button
            type="button"
            class:active={repositoryCopyForm.kind === "branch"}
            on:click={() => onRepositoryCopyFormInput("kind", "branch")}
          >
            Branch
          </button>
          <button
            type="button"
            class:active={repositoryCopyForm.kind === "tag"}
            on:click={() => onRepositoryCopyFormInput("kind", "tag")}
          >
            Tag
          </button>
        </div>

        <div class="repository-copy-grid">
          <label>
            <span>源 URL</span>
            <input
              type="url"
              value={repositoryCopyForm.sourceUrl}
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "sourceUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label>
            <span>目标 URL</span>
            <input
              type="url"
              value={repositoryCopyForm.targetUrl}
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label>
            <span>Revision</span>
            <input
              type="text"
              value={repositoryCopyForm.revision}
              placeholder="留空使用 HEAD"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
        </div>

        <label class="repository-copy-message">
          <span>提交信息</span>
          <textarea
            rows="3"
            value={repositoryCopyForm.message}
            on:input={(event) =>
              onRepositoryCopyFormInput(
                "message",
                (event.currentTarget as HTMLTextAreaElement).value,
              )}
          ></textarea>
        </label>

        {#if repositoryCopyError}
          <p class="inline-error">{repositoryCopyError}</p>
        {/if}

        <div class="repository-copy-actions">
          <button
            type="button"
            on:click={onCreateRepositoryCopy}
            disabled={repositoryCopyRunning}
          >
            {repositoryCopyRunning
              ? "创建中"
              : repositoryCopyForm.kind === "branch"
                ? "创建分支"
                : "创建标签"}
          </button>
        </div>
      </section>

      {#if breadcrumbs.length > 0}
        <nav class="repository-breadcrumbs" aria-label="仓库路径">
          {#each breadcrumbs as crumb, index (crumb.url)}
            <button
              type="button"
              disabled={repositoryLoading || crumb.url === repositoryCurrentUrl}
              on:click={() => onLoadRepositoryUrl(crumb.url)}
            >
              {crumb.label}
            </button>
            {#if index < breadcrumbs.length - 1}
              <span>/</span>
            {/if}
          {/each}
        </nav>
      {/if}

      <div class="repository-list" role="table" aria-label="仓库目录列表">
        <div class="repository-row repository-header" role="row">
          <span>名称</span>
          <span>类型</span>
          <span>Revision</span>
          <span>作者</span>
          <span>日期</span>
        </div>

        {#if repositoryLoading}
          <article class="repository-empty">仓库目录加载中</article>
        {:else if repositoryList}
          <button
            type="button"
            class="repository-row repository-entry"
            on:click={() => onLoadRepositoryUrl(parentRepositoryUrl(repositoryList.url))}
          >
            <span>..</span>
            <span>目录</span>
            <span>-</span>
            <span>-</span>
            <span>-</span>
          </button>
          {#each repositoryEntries as entry (entry.kind + ":" + entry.name)}
            <button
              type="button"
              class="repository-row repository-entry"
              disabled={entry.kind !== "dir"}
              on:click={() => onLoadRepositoryUrl(joinRepositoryUrl(repositoryList.url, entry.name))}
            >
              <span>{entry.name || "/"}</span>
              <span>{entry.kind === "dir" ? "目录" : "文件"}</span>
              <span>{entry.revision || "-"}</span>
              <span>{entry.author || "-"}</span>
              <span>{formatRepositoryDate(entry.date)}</span>
            </button>
          {/each}
          {#if repositoryEntries.length === 0}
            <article class="repository-empty">当前仓库目录为空</article>
          {/if}
        {:else}
          <article class="repository-empty">输入仓库 URL 或使用当前工作副本 Root 后开始浏览</article>
        {/if}
      </div>
    </section>
  {:else}
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
      <div class="metric">
        <span>未审</span>
        <strong>{unreviewedCount}</strong>
      </div>
    </div>

    {#if view.id === "changes"}
      <section class="svn-switch-panel" aria-label="svn switch">
        <div class="repository-layout-header">
          <div>
            <h3>svn switch</h3>
            <p>高级入口，会在当前工作副本上切换 URL</p>
          </div>
          <button
            type="button"
            on:click={onRunSvnSwitch}
            disabled={!workspace || svnSwitchRunning || !svnSwitchTargetUrl.trim()}
          >
            {svnSwitchRunning ? "Switch 中" : "执行 switch"}
          </button>
        </div>
        <input
          type="url"
          value={svnSwitchTargetUrl}
          placeholder="输入 switch 目标 URL"
          on:input={(event) =>
            onSvnSwitchTargetInput((event.currentTarget as HTMLInputElement).value)}
        />
        {#if svnSwitchError}
          <p class="inline-error">{svnSwitchError}</p>
        {/if}
      </section>
    {/if}

    <section class="changes-toolbar">
      <input
        type="search"
        value={searchText}
        placeholder="搜索文件路径"
        on:input={(event) =>
          onSearchTextInput((event.currentTarget as HTMLInputElement).value)}
      />
      <button type="button" class:active={groupByStatus} on:click={onToggleGroupByStatus}>
        分组
      </button>
      <button
        type="button"
        class:active={groupByStatus && groupMode === "status"}
        on:click={() => onGroupModeChange("status")}
      >
        状态
      </button>
      <button
        type="button"
        class:active={groupByStatus && groupMode === "directory"}
        on:click={() => onGroupModeChange("directory")}
      >
        目录
      </button>
      <button
        type="button"
        class:active={groupByStatus && groupMode === "extension"}
        on:click={() => onGroupModeChange("extension")}
      >
        类型
      </button>
      <button type="button" on:click={onClearFilters}>清空过滤</button>
      <button
        type="button"
        class:active={unreviewedOnly}
        on:click={onToggleUnreviewedOnly}
      >
        未审
      </button>
      <span>异常 {abnormalCount}</span>
      <span>未审 {unreviewedCount}</span>
      <span>显示 {filteredFiles.length}/{changedFiles.length}</span>
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
                <button
                  type="button"
                  class="status-group-heading"
                  on:click={() => toggleGroupCollapse(item.groupKey)}
                >
                  <span>{item.collapsed ? "展开" : "折叠"}</span>
                  <strong>{item.title}</strong>
                </button>
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
                  <span class="review-badge" class:reviewed={isReviewed(item.file.path)}>
                    {isReviewed(item.file.path) ? "已审" : "未审"}
                  </span>
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
  {/if}
</section>
