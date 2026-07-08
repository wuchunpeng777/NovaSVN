<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import MonacoDiffViewer from "./MonacoDiffViewer.svelte";
  import type {
    BranchPool,
    BranchPoolEntry,
    ChangedFile,
    CommandError,
    ExternalToolKind,
    FileContentDiff,
    FileDiff,
    MergeResult,
    ParsedFileDiff,
    RepositoryCopyKind,
    RepositoryListResult,
    RevisionDiffMode,
    RevisionDiffResult,
    SvnDetection,
    SvnLog,
    SvnProperties,
    Task,
    TaskStatus,
    TaskSummary,
    TaskWorkspaceList,
    WorkingCopyStatus,
    WorkspaceSummary,
  } from "../../types/api";
  import type {
    AppSettingsState,
    AppView,
    ReviewedFileState,
    SafetyCheckSummary,
    WorkbenchView,
    WorkspaceStageFilter,
  } from "../../types/app";

  export let view: WorkbenchView;
  export let workspace: WorkspaceSummary | null = null;
  export let workspacePathInput = "";
  export let workspaceLoading = false;
  export let workspaceError: CommandError | null = null;
  export let workingCopyStatus: WorkingCopyStatus | null = null;
  export let searchText = "";
  export let stageFilter: WorkspaceStageFilter = "all";
  export let selectedFilePath: string | null = null;
  export let selectedFile: ChangedFile | null = null;
  export let selectedFileReviewed = false;
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

  export let branchPool: BranchPool = { entries: [] };
  export let branchPoolForm = {
    branchUrl: "",
    localPath: "",
    revision: "",
  };
  export let branchPoolFormErrors = {
    localPath: null as string | null,
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
  export let mergeResult: MergeResult | null = null;
  export let taskWorkspaces: TaskWorkspaceList = { entries: [] };
  export let activeTaskWorkspaceId: string | null = null;

  export let selectedFileDiff: FileDiff | null = null;
  export let selectedFileContentDiff: FileContentDiff | null = null;
  export let selectedFileParsedDiff: ParsedFileDiff | null = null;
  export let selectedHunkIds: string[] = [];
  export let selectedPatch: { text: string; file_count: number; hunk_count: number } | null = null;
  export let diffLoading = false;
  export let contentDiffLoading = false;
  export let selectedPatchLoading = false;
  export let diffError: CommandError | null = null;
  export let contentDiffError: CommandError | null = null;
  export let parsedDiffError: CommandError | null = null;
  export let selectedPatchError: CommandError | null = null;
  export let safetyCheck: SafetyCheckSummary = {
    blockers: [],
    warnings: [],
    infos: [],
    confirmedWarningIds: [],
  };
  export let svnProperties: SvnProperties | null = null;
  export let svnPropertiesLoading = false;
  export let svnPropertiesError: CommandError | null = null;
  export let propertyEditForm = {
    name: "",
    value: "",
  };

  export let commitTemplate = "";
  export let commitHistory: string[] = [];
  export let commitMessage = "";
  export let commitError: string | null = null;
  export let commitDisabled = false;
  export let partialCommitDisabled = false;
  export let tasks: TaskSummary[] = [];
  export let selectedTask: Task | null = null;
  export let runningTaskId: string | null = null;
  export let taskError: CommandError | null = null;
  export let backendMessage = "";
  export let commandError: CommandError | null = null;

  export let svnDetection: SvnDetection | null = null;
  export let svnError: CommandError | null = null;
  export let svnExecutableInput = "";
  export let svnLoading = false;
  export let appSettings: AppSettingsState = {
    svnExecutable: "",
    diffMode: "side_by_side",
    showWhitespace: false,
    commitTemplate: "",
    branchPoolBasePath: "",
    largeFileThresholdMb: 20,
    externalDiffTool: "",
    externalMergeTool: "",
    diagnosticExportPath: "",
    diagnosticExportError: null,
    validationErrors: {
      svnExecutable: null,
      branchPoolBasePath: null,
      externalDiffTool: null,
      externalMergeTool: null,
    },
    loading: false,
  };

  export let onSelectView: (value: AppView) => void = () => {};
  export let onChooseWorkspace: () => void = () => {};
  export let onOpenWorkspace: () => void = () => {};
  export let onRefreshStatus: () => void = () => {};
  export let onUpdateWorkspace: () => void = () => {};
  export let onCleanupWorkspace: () => void = () => {};
  export let onLoadMoreStatus: () => void = () => {};
  export let onWorkspacePathInput: (value: string) => void = () => {};
  export let onSearchTextInput: (value: string) => void = () => {};
  export let onStageFilter: (value: WorkspaceStageFilter) => void = () => {};
  export let onClearFilters: () => void = () => {};
  export let onSelectFile: (path: string) => void = () => {};
  export let onStageFile: (path: string) => void = () => {};
  export let onUnstageFile: (path: string) => void = () => {};
  export let onRevertFile: (path: string) => void = () => {};
  export let onLockFile: (path: string) => void = () => {};
  export let onUnlockFile: (path: string) => void = () => {};
  export let onForceUnlockFile: (path: string) => void = () => {};
  export let onResolveWorking: (path: string) => void = () => {};
  export let onResolveMineFull: (path: string) => void = () => {};
  export let onResolveTheirsFull: (path: string) => void = () => {};
  export let onOpenFileLocation: (path: string) => void = () => {};
  export let onOpenWorkspaceFile: (path: string) => void = () => {};
  export let onLaunchExternalTool: (kind: ExternalToolKind, path: string) => void = () => {};
  export let onMarkFileReviewed: (path: string) => void = () => {};
  export let onMarkFileUnreviewed: (path: string) => void = () => {};
  export let onToggleHunkSelection: (filePath: string, hunkId: string) => void = () => {};
  export let onPreviewSelectedPatch: () => void = () => {};
  export let onRefreshSvnProperties: () => void = () => {};
  export let onPropertyEditInput: (field: keyof typeof propertyEditForm, value: string) => void =
    () => {};
  export let onUsePropertyForEdit: (name: string, value: string) => void = () => {};
  export let onSaveSvnProperty: () => void = () => {};

  export let onRepositoryUrlInput: (value: string) => void = () => {};
  export let onUseWorkspaceRepositoryRoot: () => void = () => {};
  export let onLoadRepositoryUrl: (url?: string) => void = () => {};
  export let onRepositoryLayoutPathInput: (
    kind: "trunk" | "branches" | "tags",
    value: string,
  ) => void = () => {};
  export let onDetectRepositoryLayout: () => void = () => {};
  export let onRepositoryCopyFormInput: (
    field: keyof typeof repositoryCopyForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryCopyTarget: (
    kind: RepositoryCopyKind,
    targetBaseUrl?: string | null,
  ) => void = () => {};
  export let onCreateRepositoryCopy: () => void = () => {};

  export let onRefreshSvnLog: () => void = () => {};
  export let onSvnLogFilterInput: (
    field:
      | "svnLogAuthorFilter"
      | "svnLogKeywordFilter"
      | "svnLogDateFromFilter"
      | "svnLogDateToFilter",
    value: string,
  ) => void = () => {};
  export let onSvnLogFileOnlyInput: (value: boolean) => void = () => {};
  export let onSvnLogLimitInput: (value: number) => void = () => {};
  export let onLoadMoreSvnLog: () => void = () => {};
  export let onRevisionDiffFormInput: (
    field: keyof typeof revisionDiffForm,
    value: string,
  ) => void = () => {};
  export let onRunRevisionDiff: () => void = () => {};
  export let onPrepareRevisionDiffFromLog: (revision: string) => void = () => {};
  export let onExportRevisionDiffPatch: () => void = () => {};

  export let onCommitMessageInput: (value: string) => void = () => {};
  export let onCommitTemplateInput: (value: string) => void = () => {};
  export let onUseCommitHistoryMessage: (value: string) => void = () => {};
  export let onConfirmSafetyWarnings: () => void = () => {};
  export let onClearWorkspaceDraft: () => void = () => {};
  export let onCommit: () => void = () => {};
  export let onPartialCommit: () => void = () => {};
  export let onSelectTask: (taskId: string) => void = () => {};
  export let onCancelTask: (taskId: string) => void = () => {};

  export let onBranchPoolFormInput: (
    field: keyof typeof branchPoolForm,
    value: string,
  ) => void = () => {};
  export let onUseBranchUrlForPool: (branchUrl: string) => void = () => {};
  export let onCheckoutBranchPoolEntry: () => void = () => {};
  export let onReuseBranchPoolEntry: () => void = () => {};
  export let onOpenBranchPoolEntry: (localPath: string) => void = () => {};
  export let onRemoveBranchPoolEntry: (entryId: string, deleteLocalCopy?: boolean) => void =
    () => {};
  export let onMergeFormInput: (field: keyof typeof mergeForm, value: string | boolean) => void =
    () => {};
  export let onUseRepositoryUrlForMerge: (url: string) => void = () => {};
  export let onRunMerge: () => void = () => {};
  export let onRunSvnSwitch: () => void = () => {};
  export let svnSwitchTargetUrl = "";
  export let svnSwitchError: string | null = null;
  export let svnSwitchRunning = false;
  export let onSvnSwitchTargetInput: (value: string) => void = () => {};

  export let onDetectSvn: () => void = () => {};
  export let onDetectSvnWithInput: () => void = () => {};
  export let onSvnExecutableInput: (value: string) => void = () => {};
  export let onAppSettingInput: <K extends keyof AppSettingsState>(
    field: K,
    value: AppSettingsState[K],
  ) => void = () => {};
  export let onExportDiagnosticLog: () => void = () => {};

  const statusLabels: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    missing: "缺失",
    unversioned: "未版本控制",
    conflicted: "冲突",
    obstructed: "阻塞",
    external: "外部",
  };

  const taskStatusLabels: Record<TaskStatus, string> = {
    pending: "排队",
    running: "运行",
    success: "完成",
    failed: "失败",
    cancelled: "取消",
  };

  let selectedCommitHistoryMessage = "";
  let diffInline = false;
  let showWhitespace = false;

  $: if (appSettings.diffMode) {
    diffInline = appSettings.diffMode === "inline";
  }
  $: showWhitespace = appSettings.showWhitespace;

  function labelStatus(status: string) {
    return statusLabels[status] ?? status;
  }

  function statusClass(status: string) {
    return `status-${status.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
  }

  function normalizePath(path: string) {
    return path.replaceAll("\\", "/");
  }

  function basename(path: string) {
    return normalizePath(path).split("/").pop() || path;
  }

  function dirname(path: string) {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf("/");
    return index > 0 ? normalized.slice(0, index) : "根目录";
  }

  function formatBytes(bytes: number | null) {
    if (bytes === null) {
      return "-";
    }
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    }
    if (bytes >= 1024) {
      return `${Math.round(bytes / 1024)}KB`;
    }
    return `${bytes}B`;
  }

  function formatDate(value: string) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatTaskTime(value: number) {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function isStaged(path: string) {
    return stagedFiles.some((file) => file.path === path);
  }

  function isReviewed(path: string) {
    return reviewedFiles.some((file) => file.path === path);
  }

  function isStageable(file: ChangedFile) {
    return !["missing", "conflicted", "obstructed", "external"].includes(file.status);
  }

  function isSelected(file: ChangedFile) {
    return selectedFilePath === file.path;
  }

  function filterFiles(files: ChangedFile[]) {
    const query = searchText.trim().toLowerCase();
    return files.filter((file) => {
      if (query && !file.path.toLowerCase().includes(query)) {
        return false;
      }
      if (stageFilter === "staged" && !isStaged(file.path)) {
        return false;
      }
      if (stageFilter === "unstaged" && isStaged(file.path)) {
        return false;
      }
      return true;
    });
  }

  function filterLogEntries(entries: SvnLog["entries"]) {
    const author = svnLogAuthorFilter.trim().toLowerCase();
    const keyword = svnLogKeywordFilter.trim().toLowerCase();
    const fromTime = svnLogDateFromFilter ? new Date(svnLogDateFromFilter).getTime() : null;
    const toTime = svnLogDateToFilter
      ? new Date(`${svnLogDateToFilter}T23:59:59`).getTime()
      : null;

    return entries.filter((entry) => {
      const entryTime = new Date(entry.date).getTime();
      if (author && !entry.author.toLowerCase().includes(author)) {
        return false;
      }
      if (
        keyword &&
        !`${entry.revision} ${entry.author} ${entry.message} ${entry.changed_paths
          .map((path) => path.path)
          .join(" ")}`
          .toLowerCase()
          .includes(keyword)
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

  function joinRepositoryUrl(baseUrl: string, name: string) {
    return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(name)}`;
  }

  function parentRepositoryUrl(url: string) {
    const normalized = url.replace(/\/+$/, "");
    const protocolMatch = normalized.match(/^[a-z][a-z0-9+.-]*:\/\//i);
    const minimum = protocolMatch ? protocolMatch[0].length : 0;
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex <= minimum) {
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

  function branchName(entry: BranchPoolEntry) {
    const url = entry.branch_url.replace(/\/+$/, "");
    return url.slice(url.lastIndexOf("/") + 1) || entry.branch_url;
  }

  function repositoryName(url: string) {
    const normalized = url.replace(/\/+$/, "");
    const name = normalized.slice(normalized.lastIndexOf("/") + 1);
    return name || normalized || "仓库";
  }

  function selectRepositoryProject(url: string) {
    onSelectView("repository");
    if (!url) {
      return;
    }
    onRepositoryUrlInput(url);
    onLoadRepositoryUrl(url);
  }

  function chooseDefaultRepositoryUrl() {
    if (repositoryUrlInput.trim()) {
      onLoadRepositoryUrl();
      return;
    }
    if (workspace?.repository_root) {
      onLoadRepositoryUrl(workspace.repository_root);
    }
  }

  function applyCommitHistoryMessage() {
    if (!selectedCommitHistoryMessage) {
      return;
    }
    onUseCommitHistoryMessage(selectedCommitHistoryMessage);
    selectedCommitHistoryMessage = "";
  }

  $: files = workingCopyStatus?.files ?? [];
  $: filteredFiles = filterFiles(files);
  $: stagedCount = stagedFiles.length;
  $: unstagedCount = Math.max((workingCopyStatus?.total ?? files.length) - stagedCount, 0);
  $: abnormalCount =
    (workingCopyStatus?.missing ?? 0) +
    (workingCopyStatus?.conflicted ?? 0) +
    (workingCopyStatus?.obstructed ?? 0);
  $: repositoryEntries = repositoryList?.entries ?? [];
  $: repositoryCurrentUrl = repositoryList?.url ?? repositoryUrlInput.trim();
  $: repositoryProjectUrl =
    repositoryCurrentUrl || workspace?.repository_root || workspace?.repository_url || "";
  $: breadcrumbs = repositoryBreadcrumbs(repositoryCurrentUrl);
  $: branchEntries =
    repositoryLayoutResults.branches?.entries.filter((entry) => entry.kind === "dir") ?? [];
  $: tagEntries =
    repositoryLayoutResults.tags?.entries.filter((entry) => entry.kind === "dir") ?? [];
  $: filteredLogEntries = filterLogEntries(svnLog?.entries ?? []);
  $: unconfirmedWarningCount = safetyCheck.warnings.filter(
    (item) => !safetyCheck.confirmedWarningIds.includes(item.id),
  ).length;
  $: activeTask = selectedTask ?? null;
</script>

<section class="versions-workbench" aria-label="NovaSVN 工作台">
  <header class="versions-titlebar">
    <div class="traffic-lights" aria-hidden="true">
      <span class="close"></span>
      <span class="minimize"></span>
      <span class="zoom"></span>
    </div>
    <div class="window-identity">
      <strong>NovaSVN</strong>
      <span>{workspace ? basename(workspace.working_copy_root) : "Subversion Client"}</span>
    </div>
    <nav class="mode-switcher" aria-label="主视图">
      <button
        type="button"
        class:active={view.id === "changes" || view.id === "staging"}
        on:click={() => onSelectView("changes")}
      >
        工作副本
      </button>
      <button
        type="button"
        class:active={view.id === "history"}
        on:click={() => onSelectView("history")}
      >
        时间线
      </button>
      <button
        type="button"
        class:active={view.id === "repository"}
        on:click={() => onSelectView("repository")}
      >
        仓库
      </button>
      <button
        type="button"
        class:active={view.id === "branches" || view.id === "settings"}
        on:click={() => onSelectView("branches")}
      >
        更多
      </button>
    </nav>
    <div class="toolbar-actions">
      <button type="button" on:click={onRefreshStatus} disabled={!workspace || statusLoading}>
        {statusLoading ? "刷新中" : "刷新"}
      </button>
      <button type="button" on:click={onUpdateWorkspace} disabled={!workspace || runningTaskId !== null}>
        更新
      </button>
      <button type="button" on:click={onCleanupWorkspace} disabled={!workspace || runningTaskId !== null}>
        清理
      </button>
    </div>
  </header>

  <div class="workspace-location">
    <input
      type="text"
      value={workspacePathInput}
      placeholder="拖入或输入 SVN 工作副本路径"
      on:input={(event) =>
        onWorkspacePathInput((event.currentTarget as HTMLInputElement).value)}
      on:keydown={(event) => {
        if (event.key === "Enter") {
          onOpenWorkspace();
        }
      }}
    />
    <button type="button" on:click={onChooseWorkspace} disabled={workspaceLoading}>
      选择
    </button>
    <button type="button" class="primary" on:click={onOpenWorkspace} disabled={workspaceLoading}>
      {workspaceLoading ? "打开中" : "打开"}
    </button>
  </div>

  <div class="versions-layout">
    <aside class="source-list" aria-label="项目列表">
      <section>
        <h2>项目</h2>
        <button
          type="button"
          class="source-item"
          class:active={view.id === "changes" || view.id === "staging"}
          on:click={() => onSelectView("changes")}
        >
          <span class="source-icon">W</span>
          <span>
            <strong>{workspace ? basename(workspace.working_copy_root) : "打开工作副本"}</strong>
            <small>{workspace?.working_copy_root ?? "选择或输入本地项目目录"}</small>
          </span>
          <em>{workingCopyStatus?.total ?? 0}</em>
        </button>
        {#if branchPool.entries.length > 0}
          {#each branchPool.entries as entry (entry.id)}
            <button
              type="button"
              class="source-item"
              on:click={() => onOpenBranchPoolEntry(entry.local_path)}
            >
              <span class="source-icon">B</span>
              <span>
                <strong>{branchName(entry)}</strong>
                <small>{entry.local_path}</small>
              </span>
              <em>{entry.local_changes}</em>
            </button>
          {/each}
        {/if}
      </section>

      <section>
        <h2>仓库</h2>
        {#if repositoryProjectUrl}
          <button
            type="button"
            class="source-item"
            class:active={view.id === "repository"}
            on:click={() => selectRepositoryProject(repositoryProjectUrl)}
          >
            <span class="source-icon">R</span>
            <span>
              <strong>{repositoryName(repositoryProjectUrl)}</strong>
              <small>{repositoryProjectUrl}</small>
            </span>
            <em>{repositoryEntries.length}</em>
          </button>
        {:else}
          <button
            type="button"
            class="source-item"
            class:active={view.id === "repository"}
            on:click={() => onSelectView("repository")}
          >
            <span class="source-icon">R</span>
            <span>
              <strong>添加仓库</strong>
              <small>输入 SVN URL 后会显示在这里</small>
            </span>
            <em>0</em>
          </button>
        {/if}
      </section>

      <section class="source-sidebar-meta">
        <h2>状态</h2>
        <p>{backendMessage}</p>
      </section>
    </aside>

    <main class="content-pane" aria-label={view.title}>
      <ErrorNotice error={workspaceError} />
      <ErrorNotice error={statusError} />
      <ErrorNotice error={commandError} />

      {#if view.id === "history"}
        <section class="pane-header">
          <div>
            <h1>时间线</h1>
            <p>{svnLog?.target ?? workspace?.repository_url ?? "读取工作副本历史"}</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={onRefreshSvnLog} disabled={!workspace || svnLogLoading}>
              {svnLogLoading ? "读取中" : "读取日志"}
            </button>
            <button
              type="button"
              on:click={onLoadMoreSvnLog}
              disabled={!workspace || svnLogLoading || !svnLog?.has_more}
            >
              更多
            </button>
          </div>
        </section>

        <section class="timeline-filters" aria-label="日志过滤">
          <input
            type="search"
            value={svnLogKeywordFilter}
            placeholder="搜索 revision、路径或提交信息"
            on:input={(event) =>
              onSvnLogFilterInput(
                "svnLogKeywordFilter",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
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
        </section>
        <ErrorNotice error={svnLogError} />

        <div class="timeline-layout">
          <section class="timeline-list" aria-label="Revision 列表">
            {#if filteredLogEntries.length > 0}
              {#each filteredLogEntries as entry (entry.revision)}
                <article class="timeline-entry">
                  <button type="button" on:click={() => onPrepareRevisionDiffFromLog(entry.revision)}>
                    <strong>r{entry.revision}</strong>
                    <span>{entry.author || "-"}</span>
                    <time>{formatDate(entry.date)}</time>
                  </button>
                  <p>{entry.message || "无提交信息"}</p>
                  <div>
                    {#each entry.changed_paths.slice(0, 5) as path (`${entry.revision}:${path.path}:${path.action}`)}
                      <small>{path.action || "-"} {path.path}</small>
                    {/each}
                    {#if entry.changed_paths.length > 5}
                      <small>另有 {entry.changed_paths.length - 5} 项</small>
                    {/if}
                  </div>
                </article>
              {/each}
            {:else if svnLogLoading}
              <article class="empty-state">正在读取日志</article>
            {:else}
              <article class="empty-state">点击“读取日志”查看修订历史</article>
            {/if}
          </section>

          <aside class="revision-compare" aria-label="Revision 比较">
            <h2>比较</h2>
            <div class="segmented-control">
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
                URL
              </button>
            </div>

            {#if revisionDiffForm.mode === "urls"}
              <input
                type="url"
                value={revisionDiffForm.leftUrl}
                placeholder="左侧 URL"
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "leftUrl",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <input
                type="url"
                value={revisionDiffForm.rightUrl}
                placeholder="右侧 URL"
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "rightUrl",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            {:else}
              {#if revisionDiffForm.mode === "revisions"}
                <input
                  type="text"
                  value={revisionDiffForm.leftRevision}
                  placeholder="左侧 revision"
                  on:input={(event) =>
                    onRevisionDiffFormInput(
                      "leftRevision",
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              {/if}
              <input
                type="text"
                value={revisionDiffForm.rightRevision}
                placeholder={workspace?.revision ? `目标 revision，例如 ${workspace.revision}` : "目标 revision"}
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "rightRevision",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            {/if}

            {#if revisionDiffError}
              <p class="inline-error">{revisionDiffError}</p>
            {/if}
            <button type="button" class="primary" on:click={onRunRevisionDiff} disabled={revisionDiffLoading}>
              {revisionDiffLoading ? "比较中" : "比较"}
            </button>
            <button
              type="button"
              on:click={onExportRevisionDiffPatch}
              disabled={!revisionDiffResult || (!revisionDiffResult.diff_text && !revisionDiffResult.patch_file_path)}
            >
              导出 Patch
            </button>
            <div class="revision-result">
              <span>{revisionDiffResult?.file_count ?? 0} 文件</span>
              <span>{revisionDiffResult?.line_count ?? 0} 行</span>
            </div>
            <pre>{revisionDiffResult?.diff_text || "暂无比较结果"}</pre>
          </aside>
        </div>
      {:else if view.id === "repository"}
        <section class="pane-header">
          <div>
            <h1>仓库</h1>
            <p>{repositoryCurrentUrl || workspace?.repository_root || "浏览远端 SVN 仓库"}</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={onUseWorkspaceRepositoryRoot} disabled={!workspace}>
              使用 Root
            </button>
            <button type="button" class="primary" on:click={chooseDefaultRepositoryUrl} disabled={repositoryLoading}>
              {repositoryLoading ? "加载中" : "浏览"}
            </button>
          </div>
        </section>

        <section class="repository-urlbar">
          <input
            type="url"
            value={repositoryUrlInput}
            placeholder="https://example.com/svn/project"
            on:input={(event) =>
              onRepositoryUrlInput((event.currentTarget as HTMLInputElement).value)}
            on:keydown={(event) => {
              if (event.key === "Enter") {
                onLoadRepositoryUrl();
              }
            }}
          />
        </section>

        {#if repositoryError}
          <p class="inline-error">{repositoryError}</p>
        {/if}

        {#if breadcrumbs.length > 0}
          <nav class="breadcrumbs" aria-label="仓库路径">
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

        <section class="repository-table" aria-label="仓库目录">
          <div class="table-head">
            <span>名称</span>
            <span>类型</span>
            <span>Revision</span>
            <span>作者</span>
            <span>日期</span>
          </div>
          {#if repositoryLoading}
            <article class="empty-state">仓库目录加载中</article>
          {:else if repositoryList}
            <button
              type="button"
              class="repository-row"
              on:click={() => onLoadRepositoryUrl(parentRepositoryUrl(repositoryList.url))}
            >
              <strong>..</strong>
              <span>目录</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
            </button>
            {#each repositoryEntries as entry (entry.kind + ":" + entry.name)}
              <button
                type="button"
                class="repository-row"
                disabled={entry.kind !== "dir"}
                on:click={() => onLoadRepositoryUrl(joinRepositoryUrl(repositoryList.url, entry.name))}
              >
                <strong>{entry.name || "/"}</strong>
                <span>{entry.kind === "dir" ? "目录" : "文件"}</span>
                <span>{entry.revision || "-"}</span>
                <span>{entry.author || "-"}</span>
                <span>{formatDate(entry.date)}</span>
              </button>
            {/each}
            {#if repositoryEntries.length === 0}
              <article class="empty-state">当前目录为空</article>
            {/if}
          {:else}
            <article class="empty-state">输入仓库 URL 后开始浏览</article>
          {/if}
        </section>

        <details class="advanced-section">
          <summary>分支和标签</summary>
          <div class="layout-detect">
            <label>
              <span>trunk</span>
              <input
                type="text"
                value={repositoryLayout.trunkPath}
                on:input={(event) =>
                  onRepositoryLayoutPathInput("trunk", (event.currentTarget as HTMLInputElement).value)}
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
                  onRepositoryLayoutPathInput("tags", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <button type="button" on:click={onDetectRepositoryLayout} disabled={repositoryLayoutLoading}>
              {repositoryLayoutLoading ? "识别中" : "识别"}
            </button>
          </div>
          <div class="branch-tags">
            <section>
              <h3>分支 {branchEntries.length}</h3>
              {#if repositoryLayoutErrors.branches}
                <p class="inline-error">{repositoryLayoutErrors.branches}</p>
              {/if}
              {#each branchEntries as entry (entry.name)}
                <div class="branch-pick-row">
                  <button
                    type="button"
                    on:click={() =>
                      repositoryLayoutResults.branches &&
                      onLoadRepositoryUrl(joinRepositoryUrl(repositoryLayoutResults.branches.url, entry.name))}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    on:click={() =>
                      repositoryLayoutResults.branches &&
                      onUseBranchUrlForPool(
                        joinRepositoryUrl(repositoryLayoutResults.branches.url, entry.name),
                      )}
                  >
                    加入池
                  </button>
                </div>
              {/each}
            </section>
            <section>
              <h3>标签 {tagEntries.length}</h3>
              {#if repositoryLayoutErrors.tags}
                <p class="inline-error">{repositoryLayoutErrors.tags}</p>
              {/if}
              {#each tagEntries as entry (entry.name)}
                <button
                  type="button"
                  on:click={() =>
                    repositoryLayoutResults.tags &&
                    onLoadRepositoryUrl(joinRepositoryUrl(repositoryLayoutResults.tags.url, entry.name))}
                >
                  {entry.name}
                </button>
              {/each}
            </section>
          </div>
        </details>

        <details class="advanced-section">
          <summary>创建分支或标签</summary>
          <div class="copy-form">
            <div class="segmented-control">
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
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryCopyTarget("branch", repositoryLayoutResults.branches?.url)}
            >
              填充分支目标
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryCopyTarget("tag", repositoryLayoutResults.tags?.url)}
            >
              填充标签目标
            </button>
            <input
              type="url"
              value={repositoryCopyForm.sourceUrl}
              placeholder="源 URL"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "sourceUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="url"
              value={repositoryCopyForm.targetUrl}
              placeholder="目标 URL"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="text"
              value={repositoryCopyForm.revision}
              placeholder="Revision，留空为 HEAD"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryCopyForm.message}
              placeholder="提交信息"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryCopyError}
              <p class="inline-error">{repositoryCopyError}</p>
            {/if}
            <button type="button" class="primary" on:click={onCreateRepositoryCopy} disabled={repositoryCopyRunning}>
              {repositoryCopyRunning ? "创建中" : "创建"}
            </button>
          </div>
        </details>
      {:else if view.id === "branches"}
        <section class="pane-header">
          <div>
            <h1>高级</h1>
            <p>分支工作副本、Merge 和 switch 放在这里，不打扰日常提交。</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={() => onSelectView("settings")}>偏好</button>
          </div>
        </section>

        <section class="advanced-grid">
          <article class="advanced-card">
            <h2>分支工作副本</h2>
            <input
              type="url"
              value={branchPoolForm.branchUrl}
              placeholder="分支 URL"
              on:input={(event) =>
                onBranchPoolFormInput(
                  "branchUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="text"
              value={branchPoolForm.localPath}
              placeholder="本地路径"
              on:input={(event) =>
                onBranchPoolFormInput(
                  "localPath",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if branchPoolFormErrors.localPath}
              <p class="inline-error">{branchPoolFormErrors.localPath}</p>
            {/if}
            <input
              type="text"
              value={branchPoolForm.revision}
              placeholder="Revision，留空为 HEAD"
              on:input={(event) =>
                onBranchPoolFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <div class="button-row">
              <button type="button" class="primary" on:click={onCheckoutBranchPoolEntry} disabled={branchCheckoutRunning}>
                {branchCheckoutRunning ? "Checkout 中" : "Checkout"}
              </button>
              <button type="button" on:click={onReuseBranchPoolEntry} disabled={branchPoolLoading}>
                复用已有
              </button>
            </div>
            {#if branchCheckoutError}
              <p class="inline-error">{branchCheckoutError}</p>
            {/if}
            <ErrorNotice error={branchPoolError} />
            <div class="branch-pool-list">
              {#each branchPool.entries as entry (entry.id)}
                <div>
                  <strong>{branchName(entry)}</strong>
                  <span>{entry.local_changes} 改动 · r{entry.revision || "-"}</span>
                  <button type="button" on:click={() => onOpenBranchPoolEntry(entry.local_path)}>
                    打开
                  </button>
                  <button type="button" on:click={() => onRemoveBranchPoolEntry(entry.id, false)}>
                    移除
                  </button>
                </div>
              {/each}
            </div>
          </article>

          <article class="advanced-card">
            <h2>Merge</h2>
            <input
              type="url"
              value={mergeForm.sourceUrl}
              placeholder="源 URL"
              on:input={(event) =>
                onMergeFormInput("sourceUrl", (event.currentTarget as HTMLInputElement).value)}
            />
            <div class="two-cols">
              <input
                type="text"
                value={mergeForm.startRevision}
                placeholder="起始 revision"
                on:input={(event) =>
                  onMergeFormInput(
                    "startRevision",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <input
                type="text"
                value={mergeForm.endRevision}
                placeholder="结束 revision"
                on:input={(event) =>
                  onMergeFormInput("endRevision", (event.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={mergeForm.dryRun}
                on:change={(event) =>
                  onMergeFormInput("dryRun", (event.currentTarget as HTMLInputElement).checked)}
              />
              <span>先 Dry-run</span>
            </label>
            {#if branchPool.entries.length > 0}
              <div class="quick-picks">
                {#each branchPool.entries as entry (entry.id)}
                  <button type="button" on:click={() => onUseRepositoryUrlForMerge(entry.branch_url)}>
                    {branchName(entry)}
                  </button>
                {/each}
              </div>
            {/if}
            {#if mergeError}
              <p class="inline-error">{mergeError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onRunMerge}
              disabled={!workspace || mergeRunning || !mergeForm.sourceUrl.trim()}
            >
              {mergeRunning ? "执行中" : mergeForm.dryRun ? "Dry-run" : "Merge"}
            </button>
            {#if mergeResult}
              <pre>{mergeResult.output_text || "svn merge 没有输出。"}</pre>
            {/if}
          </article>

          <article class="advanced-card">
            <h2>Switch</h2>
            <input
              type="url"
              value={svnSwitchTargetUrl}
              placeholder="目标 URL"
              on:input={(event) =>
                onSvnSwitchTargetInput((event.currentTarget as HTMLInputElement).value)}
            />
            {#if svnSwitchError}
              <p class="inline-error">{svnSwitchError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onRunSvnSwitch}
              disabled={!workspace || svnSwitchRunning || !svnSwitchTargetUrl.trim()}
            >
              {svnSwitchRunning ? "Switch 中" : "Switch"}
            </button>
          </article>

          <article class="advanced-card">
            <h2>任务工作区</h2>
            <p>{taskWorkspaces.entries.length} 个任务，当前 {activeTaskWorkspaceId ? "已选择" : "未选择"}。</p>
            <div class="task-list compact">
              {#each taskWorkspaces.entries as entry (entry.id)}
                <div>
                  <strong>{entry.name}</strong>
                  <span>{entry.local_path}</span>
                </div>
              {/each}
            </div>
          </article>
        </section>
      {:else if view.id === "settings"}
        <section class="pane-header">
          <div>
            <h1>偏好</h1>
            <p>只保留日常会用到的配置。</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={() => onSelectView("branches")}>高级</button>
          </div>
        </section>

        <section class="settings-view">
          <article>
            <h2>SVN</h2>
            <div class="button-row">
              <button type="button" on:click={onDetectSvn} disabled={svnLoading}>
                {svnLoading ? "检测中" : "自动检测"}
              </button>
              <span>{svnDetection?.version ?? "尚未检测"}</span>
            </div>
            <ErrorNotice error={svnError} />
            <input
              type="text"
              value={svnExecutableInput}
              placeholder="svn 或 svn.exe"
              on:input={(event) =>
                onSvnExecutableInput((event.currentTarget as HTMLInputElement).value)}
            />
            <button type="button" on:click={onDetectSvnWithInput} disabled={svnLoading}>
              使用此路径
            </button>
            <input
              type="text"
              value={appSettings.svnExecutable}
              placeholder="保存的 SVN 路径"
              on:input={(event) =>
                onAppSettingInput(
                  "svnExecutable",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if appSettings.validationErrors.svnExecutable}
              <p class="inline-error">{appSettings.validationErrors.svnExecutable}</p>
            {/if}
          </article>

          <article>
            <h2>Diff 和提交</h2>
            <label>
              <span>默认 Diff</span>
              <select
                value={appSettings.diffMode}
                on:change={(event) =>
                  onAppSettingInput(
                    "diffMode",
                    (event.currentTarget as HTMLSelectElement).value as AppSettingsState["diffMode"],
                  )}
              >
                <option value="side_by_side">双栏</option>
                <option value="inline">行内</option>
              </select>
            </label>
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={appSettings.showWhitespace}
                on:change={(event) =>
                  onAppSettingInput(
                    "showWhitespace",
                    (event.currentTarget as HTMLInputElement).checked,
                  )}
              />
              <span>显示空白字符</span>
            </label>
            <textarea
              rows="4"
              value={appSettings.commitTemplate}
              placeholder="提交模板"
              on:input={(event) =>
                onAppSettingInput(
                  "commitTemplate",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
          </article>

          <article>
            <h2>工具</h2>
            <input
              type="text"
              value={appSettings.externalDiffTool}
              placeholder="外部 Diff 工具"
              on:input={(event) =>
                onAppSettingInput(
                  "externalDiffTool",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if appSettings.validationErrors.externalDiffTool}
              <p class="inline-error">{appSettings.validationErrors.externalDiffTool}</p>
            {/if}
            <input
              type="text"
              value={appSettings.externalMergeTool}
              placeholder="外部 Merge 工具"
              on:input={(event) =>
                onAppSettingInput(
                  "externalMergeTool",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if appSettings.validationErrors.externalMergeTool}
              <p class="inline-error">{appSettings.validationErrors.externalMergeTool}</p>
            {/if}
            <input
              type="number"
              min="1"
              max="2048"
              value={appSettings.largeFileThresholdMb}
              on:input={(event) =>
                onAppSettingInput(
                  "largeFileThresholdMb",
                  (event.currentTarget as HTMLInputElement).valueAsNumber,
                )}
            />
            <button type="button" on:click={onExportDiagnosticLog} disabled={appSettings.loading}>
              {appSettings.loading ? "导出中" : "导出诊断日志"}
            </button>
            {#if appSettings.diagnosticExportPath}
              <p>{appSettings.diagnosticExportPath}</p>
            {:else if appSettings.diagnosticExportError}
              <p class="inline-error">{appSettings.diagnosticExportError}</p>
            {/if}
          </article>
        </section>
      {:else}
        <section class="pane-header">
          <div>
            <h1>工作副本</h1>
            <p>{workspace?.working_copy_root ?? "打开 SVN 工作副本后开始浏览"}</p>
          </div>
          <div class="pane-actions">
            {#if workingCopyStatus && workingCopyStatus.files.length < workingCopyStatus.total}
              <button type="button" on:click={onLoadMoreStatus} disabled={statusLoading}>
                更多改动
              </button>
            {/if}
            <button type="button" class="primary" on:click={onCommit} disabled={commitDisabled}>
              提交 {stagedCount > 0 ? stagedCount : ""}
            </button>
          </div>
        </section>

        <section class="summary-strip" aria-label="工作副本摘要">
          <span><strong>{workingCopyStatus?.total ?? 0}</strong> 改动</span>
          <span><strong>{stagedCount}</strong> 已暂存</span>
          <span><strong>{unstagedCount}</strong> 未暂存</span>
          <span><strong>{abnormalCount}</strong> 异常</span>
          <span><strong>r{workingCopyStatus?.revision_range ?? workspace?.revision ?? "-"}</strong></span>
        </section>

        <section class="changes-toolbar" aria-label="改动过滤">
          <input
            type="search"
            value={searchText}
            placeholder="搜索文件"
            on:input={(event) =>
              onSearchTextInput((event.currentTarget as HTMLInputElement).value)}
          />
          <div class="segmented-control">
            <button
              type="button"
              class:active={stageFilter === "all"}
              on:click={() => onStageFilter("all")}
            >
              全部
            </button>
            <button
              type="button"
              class:active={stageFilter === "unstaged"}
              on:click={() => onStageFilter("unstaged")}
            >
              未暂存
            </button>
            <button
              type="button"
              class:active={stageFilter === "staged"}
              on:click={() => onStageFilter("staged")}
            >
              已暂存
            </button>
          </div>
          <button type="button" on:click={onClearFilters}>清除</button>
        </section>

        <section class="work-copy-grid">
          <div class="file-browser" aria-label="改动文件">
            <div class="file-table-head">
              <span>名称</span>
              <span>状态</span>
              <span>Revision</span>
              <span>大小</span>
            </div>
            {#if workingCopyStatus && filteredFiles.length > 0}
              {#each filteredFiles as file (file.path)}
                <button
                  type="button"
                  class="file-row"
                  class:selected={isSelected(file)}
                  class:abnormal={file.abnormal}
                  on:click={() => onSelectFile(file.path)}
                >
                  <span class="file-name">
                    <strong>{basename(file.path)}</strong>
                    <small>{dirname(file.path)}</small>
                  </span>
                  <span class="status-pill {statusClass(file.status)}">{labelStatus(file.status)}</span>
                  <span>{file.revision ?? "-"}</span>
                  <span>{formatBytes(file.file_size)}</span>
                  <span class="inline-row-actions">
                    {#if isStaged(file.path)}
                      <em>已暂存</em>
                      <span
                        role="button"
                        tabindex="0"
                        on:click|stopPropagation={() => onUnstageFile(file.path)}
                        on:keydown|stopPropagation={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            onUnstageFile(file.path);
                          }
                        }}
                      >
                        取消
                      </span>
                    {:else}
                      <span
                        role="button"
                        tabindex="0"
                        aria-disabled={!isStageable(file)}
                        on:click|stopPropagation={() => isStageable(file) && onStageFile(file.path)}
                        on:keydown|stopPropagation={(event) => {
                          if ((event.key === "Enter" || event.key === " ") && isStageable(file)) {
                            onStageFile(file.path);
                          }
                        }}
                      >
                        暂存
                      </span>
                    {/if}
                    <span
                      role="button"
                      tabindex="0"
                      on:click|stopPropagation={() => onRevertFile(file.path)}
                      on:keydown|stopPropagation={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          onRevertFile(file.path);
                        }
                      }}
                    >
                      撤销
                    </span>
                  </span>
                </button>
              {/each}
            {:else if workingCopyStatus}
              <article class="empty-state">没有匹配的改动</article>
            {:else if workspace}
              <article class="empty-state">点击“刷新”扫描工作副本</article>
            {:else}
              <article class="empty-state">选择或输入 SVN 工作副本目录</article>
            {/if}
          </div>

          <aside class="inspector" aria-label="详情和提交">
            <section class="inspector-section">
              <h2>文件</h2>
              {#if selectedFile}
                <div class="file-card">
                  <strong>{basename(selectedFile.path)}</strong>
                  <span>{dirname(selectedFile.path)}</span>
                  <small>{labelStatus(selectedFile.status)} · {formatBytes(selectedFile.file_size)}</small>
                </div>
                <div class="button-row wrap">
                  <button type="button" on:click={() => onOpenWorkspaceFile(selectedFile.path)}>
                    打开
                  </button>
                  <button type="button" on:click={() => onOpenFileLocation(selectedFile.path)}>
                    定位
                  </button>
                  <button type="button" on:click={() => onLaunchExternalTool("diff", selectedFile.path)}>
                    外部 Diff
                  </button>
                  <button type="button" on:click={() => onRevertFile(selectedFile.path)}>
                    撤销
                  </button>
                  {#if selectedFileReviewed}
                    <button type="button" on:click={() => onMarkFileUnreviewed(selectedFile.path)}>
                      标为未审
                    </button>
                  {:else}
                    <button type="button" on:click={() => onMarkFileReviewed(selectedFile.path)}>
                      标为已审
                    </button>
                  {/if}
                  {#if selectedFile.lock_state === "none" && !selectedFile.lock_owner}
                    <button type="button" on:click={() => onLockFile(selectedFile.path)}>Lock</button>
                  {:else}
                    <button type="button" on:click={() => onUnlockFile(selectedFile.path)}>Unlock</button>
                    <button type="button" on:click={() => onForceUnlockFile(selectedFile.path)}>
                      Force Unlock
                    </button>
                  {/if}
                </div>

                {#if selectedFile.status === "conflicted" || selectedFile.conflict_kind}
                  <div class="conflict-actions">
                    <button type="button" on:click={() => onResolveWorking(selectedFile.path)}>
                      使用工作副本
                    </button>
                    <button type="button" on:click={() => onResolveMineFull(selectedFile.path)}>
                      Mine Full
                    </button>
                    <button type="button" on:click={() => onResolveTheirsFull(selectedFile.path)}>
                      Theirs Full
                    </button>
                  </div>
                {/if}
              {:else}
                <p class="muted">选择文件后显示操作。</p>
              {/if}
            </section>

            <section class="inspector-section diff-section">
              <div class="section-title">
                <h2>比较</h2>
                <div class="segmented-control compact">
                  <button type="button" class:active={!diffInline} on:click={() => (diffInline = false)}>
                    双栏
                  </button>
                  <button type="button" class:active={diffInline} on:click={() => (diffInline = true)}>
                    行内
                  </button>
                </div>
              </div>
              {#if contentDiffLoading || diffLoading}
                <p class="muted">Diff 加载中</p>
              {:else if contentDiffError}
                <ErrorNotice error={contentDiffError} />
              {:else if diffError}
                <ErrorNotice error={diffError} />
              {:else if selectedFileContentDiff && !selectedFileContentDiff.binary}
                <MonacoDiffViewer
                  contentDiff={selectedFileContentDiff}
                  inlineMode={diffInline}
                  showWhitespace={showWhitespace}
                />
              {:else if selectedFileDiff}
                <pre class="text-diff">{selectedFileDiff.text || "没有文本 diff"}</pre>
              {:else}
                <p class="muted">选择改动文件后显示 diff。</p>
              {/if}
            </section>

            {#if selectedFileParsedDiff}
              <section class="inspector-section">
                <div class="section-title">
                  <h2>Hunk</h2>
                  <button type="button" on:click={onPreviewSelectedPatch} disabled={selectedPatchLoading}>
                    {selectedPatchLoading ? "生成中" : "预览 Patch"}
                  </button>
                </div>
                {#if parsedDiffError}
                  <ErrorNotice error={parsedDiffError} />
                {/if}
                <div class="hunk-list">
                  {#each selectedFileParsedDiff.hunks as hunk (hunk.id)}
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedHunkIds.includes(hunk.id)}
                        on:change={() =>
                          onToggleHunkSelection(selectedFileParsedDiff.path, hunk.id)}
                      />
                      <span>{hunk.header}</span>
                    </label>
                  {/each}
                </div>
                {#if selectedPatchError}
                  <ErrorNotice error={selectedPatchError} />
                {:else if selectedPatch}
                  <p class="muted">{selectedPatch.file_count} 文件 · {selectedPatch.hunk_count} hunk</p>
                  <button type="button" on:click={onPartialCommit} disabled={partialCommitDisabled}>
                    提交选中 Hunk
                  </button>
                {/if}
              </section>
            {/if}

            <section class="inspector-section">
              <div class="section-title">
                <h2>属性</h2>
                <button type="button" on:click={onRefreshSvnProperties} disabled={!workspace || svnPropertiesLoading}>
                  {svnPropertiesLoading ? "读取中" : "读取"}
                </button>
              </div>
              <ErrorNotice error={svnPropertiesError} />
              {#if svnProperties}
                <div class="property-list">
                  {#each svnProperties.properties as property (property.name)}
                    <button type="button" on:click={() => onUsePropertyForEdit(property.name, property.value)}>
                      <strong>{property.name}</strong>
                      <span>{property.value}</span>
                    </button>
                  {/each}
                </div>
              {/if}
              <input
                type="text"
                value={propertyEditForm.name}
                placeholder="svn:ignore"
                on:input={(event) =>
                  onPropertyEditInput("name", (event.currentTarget as HTMLInputElement).value)}
              />
              <textarea
                rows="2"
                value={propertyEditForm.value}
                placeholder="属性值，留空保存为删除"
                on:input={(event) =>
                  onPropertyEditInput(
                    "value",
                    (event.currentTarget as HTMLTextAreaElement).value,
                  )}
              ></textarea>
              <button type="button" on:click={onSaveSvnProperty} disabled={!workspace}>
                保存属性
              </button>
            </section>

            <section class="inspector-section commit-section">
              <div class="section-title">
                <h2>提交</h2>
                <button type="button" on:click={onClearWorkspaceDraft}>清空草稿</button>
              </div>
              <p class="muted">{stagedFiles.length} 个文件已暂存</p>
              <input
                type="text"
                value={commitTemplate}
                placeholder="提交模板"
                on:input={(event) =>
                  onCommitTemplateInput((event.currentTarget as HTMLInputElement).value)}
              />
              {#if commitHistory.length > 0}
                <select
                  bind:value={selectedCommitHistoryMessage}
                  on:change={applyCommitHistoryMessage}
                  aria-label="最近提交信息"
                >
                  <option value="">最近提交信息</option>
                  {#each commitHistory as message}
                    <option value={message}>{message}</option>
                  {/each}
                </select>
              {/if}
              <textarea
                rows="4"
                value={commitMessage}
                placeholder="提交信息"
                on:input={(event) =>
                  onCommitMessageInput((event.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
              {#if commitError}
                <p class="inline-error">{commitError}</p>
              {/if}
              {#if safetyCheck.blockers.length > 0 || safetyCheck.warnings.length > 0}
                <div class="safety-box">
                  {#if safetyCheck.blockers.length > 0}
                    <strong>{safetyCheck.blockers.length} 个阻塞</strong>
                  {/if}
                  {#if safetyCheck.warnings.length > 0}
                    <span>{safetyCheck.warnings.length} 个警告</span>
                  {/if}
                  {#if unconfirmedWarningCount > 0 && safetyCheck.blockers.length === 0}
                    <button type="button" on:click={onConfirmSafetyWarnings}>
                      确认警告
                    </button>
                  {/if}
                </div>
              {/if}
              <button type="button" class="primary full" on:click={onCommit} disabled={commitDisabled}>
                提交
              </button>
            </section>

            <section class="inspector-section task-section">
              <div class="section-title">
                <h2>任务</h2>
                <span>{tasks.length}</span>
              </div>
              <ErrorNotice error={taskError} />
              {#if activeTask}
                <div class="task-log">
                  <strong>{activeTask.title}</strong>
                  {#each activeTask.logs as log}
                    <p><time>{formatTaskTime(log.created_at)}</time>{log.message}</p>
                  {/each}
                  {#if activeTask.error}
                    <p class="inline-error">{activeTask.error}</p>
                  {/if}
                </div>
              {:else}
                <p class="muted">{backendMessage || "暂无后台任务"}</p>
              {/if}
              <div class="task-list">
                {#each tasks.slice(0, 6) as task (task.task_id)}
                  <button type="button" on:click={() => onSelectTask(task.task_id)}>
                    <span>{task.title}</span>
                    <em>{taskStatusLabels[task.status]}</em>
                    {#if task.status === "pending" || task.status === "running"}
                      <small
                        role="button"
                        tabindex="0"
                        on:click|stopPropagation={() => onCancelTask(task.task_id)}
                        on:keydown|stopPropagation={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            onCancelTask(task.task_id);
                          }
                        }}
                      >
                        取消
                      </small>
                    {/if}
                  </button>
                {/each}
              </div>
            </section>
          </aside>
        </section>
      {/if}
    </main>
  </div>
</section>
