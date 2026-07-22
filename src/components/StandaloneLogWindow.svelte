<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { ChevronDown, ChevronUp, GitMerge, History, RefreshCw, X } from "@lucide/svelte";
  import {
    getPathSvnLog,
    getRepositoryFileLog,
    getRevisionFileContentDiff,
    launchLogWindow,
  } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import {
    LOG_FILE_DIFF_MAX_BYTES,
    repositoryPathLogTarget,
    repositoryPathUrlAtRevision,
    revisionBefore,
    summarizeSvnChangeActions,
  } from "../lib/svn-log";
  import type {
    CommandError,
    FileContentDiff,
    SvnChangedPath,
    SvnLog,
    SvnLogEntry,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import LogMergeDialog from "./LogMergeDialog.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";
  import MonacoDiffViewer from "./workbench/MonacoDiffViewer.svelte";

  export let targetPath: string;
  export let repositoryRoot: string | undefined = undefined;
  export let repositoryRevision: string | undefined = undefined;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let diffMode: "side_by_side" | "inline" = "side_by_side";
  export let showWhitespace = false;
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  let log: SvnLog | null = null;
  let loading = false;
  let error: CommandError | null = null;
  let keywordFilter = "";
  let authorFilter = "";
  let dateFromFilter = "";
  let dateToFilter = "";
  let limit = 50;
  let expandedRevisions = new Set<string>();
  let selectedDiff: { revision: string; path: string } | null = null;
  let revisionDiff: FileContentDiff | null = null;
  let revisionDiffLoading = false;
  let revisionDiffError: CommandError | null = null;
  let fileContextMenu: {
    entry: SvnLogEntry;
    path: SvnChangedPath;
    x: number;
    y: number;
  } | null = null;
  let fileContextMenuElement: HTMLDivElement | null = null;
  let launchWindowError: CommandError | null = null;
  let mergeRevisions = new Set<string>();
  let mergeSelectionAnchor: string | null = null;
  let mergeDialogOpen = false;
  let mergeCompleted = false;
  let requestGeneration = 0;
  let diffRequestGeneration = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: filteredEntries = filterEntries(
    log?.entries ?? [],
    keywordFilter,
    authorFilter,
    dateFromFilter,
    dateToFilter,
  );
  $: dateRangeInvalid =
    localDateBoundary(dateFromFilter) !== null &&
    localDateBoundary(dateToFilter) !== null &&
    localDateBoundary(dateFromFilter)! > localDateBoundary(dateToFilter)!;
  $: hasFilters = Boolean(
    keywordFilter || authorFilter || dateFromFilter || dateToFilter,
  );
  $: logAuthenticationFailure = detectSvnAuthenticationFailure(commandErrorText(error));
  $: revisionAuthenticationFailure = detectSvnAuthenticationFailure(
    commandErrorText(revisionDiffError),
  );
  $: authenticationFailure = logAuthenticationFailure ?? revisionAuthenticationFailure;
  $: authenticationRetry = logAuthenticationFailure ? () => loadLog(false) : null;
  $: selectedMergeRevisions = [...mergeRevisions].sort(
    (left, right) => Number(left) - Number(right),
  );

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("click", closeFileContextMenu);
    window.addEventListener("blur", closeFileContextMenu);
    window.addEventListener("resize", closeFileContextMenu);
    window.addEventListener("keydown", handleWindowKeydown);
    void loadLog(false);
  });

  onDestroy(() => {
    requestGeneration += 1;
    diffRequestGeneration += 1;
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
    window.removeEventListener("click", closeFileContextMenu);
    window.removeEventListener("blur", closeFileContextMenu);
    window.removeEventListener("resize", closeFileContextMenu);
    window.removeEventListener("keydown", handleWindowKeydown);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  async function loadLog(append: boolean) {
    const path = targetPath.trim();
    if (!path) {
      error = {
        code: "SVN_LOG_TARGET_MISSING",
        message: "没有可读取的日志目标",
        detail: "请从 Windows 资源管理器中的文件或目录右键打开 NovaSVN Log。",
        recoverable: false,
      };
      return;
    }

    const startRevision = append ? log?.next_start_revision : undefined;
    if (append && (!log?.has_more || !startRevision)) {
      return;
    }

    const generation = ++requestGeneration;
    if (!append) {
      clearRevisionDiff();
    }
    loading = true;
    error = null;
    try {
      const repositoryTarget = currentRepositoryTarget(path);
      const page = repositoryTarget
        ? await getRepositoryFileLog({
            url: repositoryTarget.url,
            revision: repositoryTarget.revision,
            svn_executable: svnExecutable?.trim() || undefined,
            limit,
            start_revision: startRevision ?? undefined,
          })
        : await getPathSvnLog({
            path,
            svn_executable: svnExecutable?.trim() || undefined,
            limit,
            start_revision: startRevision ?? undefined,
          });
      if (generation !== requestGeneration) {
        return;
      }
      if (repositoryTarget) {
        page.repository_root = repositoryTarget.root;
        page.repository_url = repositoryTarget.url;
      }
      log = append && log ? mergeLogPage(log, page) : page;
    } catch (caught) {
      if (generation !== requestGeneration) {
        return;
      }
      error = caught as CommandError;
    } finally {
      if (generation === requestGeneration) {
        loading = false;
      }
    }
  }

  function currentRepositoryTarget(path: string) {
    const root = repositoryRoot?.trim();
    const revision = repositoryRevision?.trim();
    if (!root || !revision || !/^\d+$/.test(revision)) {
      return null;
    }
    return { url: path, root, revision };
  }

  function mergeLogPage(current: SvnLog, page: SvnLog): SvnLog {
    const entries = [...current.entries];
    const revisions = new Set(entries.map((entry) => entry.revision));
    for (const entry of page.entries) {
      if (!revisions.has(entry.revision)) {
        entries.push(entry);
        revisions.add(entry.revision);
      }
    }
    return { ...page, target: current.target, entries };
  }

  function filterEntries(
    entries: SvnLogEntry[],
    keywordValue: string,
    authorValue: string,
    dateFromValue: string,
    dateToValue: string,
  ) {
    const keyword = keywordValue.trim().toLowerCase();
    const author = authorValue.trim().toLowerCase();
    const fromTime = localDateBoundary(dateFromValue);
    const toTime = localDateBoundary(dateToValue);
    const toExclusive = toTime === null ? null : nextLocalDay(toTime);
    if (fromTime !== null && toExclusive !== null && fromTime >= toExclusive) {
      return [];
    }

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
      if ((fromTime !== null || toExclusive !== null) && Number.isNaN(entryTime)) {
        return false;
      }
      return !(
        (fromTime !== null && entryTime < fromTime) ||
        (toExclusive !== null && entryTime >= toExclusive)
      );
    });
  }

  function localDateBoundary(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      return null;
    }
    return date.getTime();
  }

  function nextLocalDay(timestamp: number) {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + 1);
    return date.getTime();
  }

  function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || "-";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function clearFilters() {
    keywordFilter = "";
    authorFilter = "";
    dateFromFilter = "";
    dateToFilter = "";
  }

  function togglePaths(revision: string) {
    const next = new Set(expandedRevisions);
    if (next.has(revision)) {
      next.delete(revision);
    } else {
      next.add(revision);
    }
    expandedRevisions = next;
  }

  function toggleMergeRevision(event: MouseEvent, revision: string) {
    const checkbox = event.currentTarget as HTMLInputElement;
    const next = new Set(mergeRevisions);
    if (event.shiftKey && mergeSelectionAnchor) {
      const anchorIndex = filteredEntries.findIndex(
        (entry) => entry.revision === mergeSelectionAnchor,
      );
      const targetIndex = filteredEntries.findIndex((entry) => entry.revision === revision);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = [anchorIndex, targetIndex].sort((left, right) => left - right);
        for (const entry of filteredEntries.slice(start, end + 1)) {
          if (checkbox.checked) {
            next.add(entry.revision);
          } else {
            next.delete(entry.revision);
          }
        }
      }
    } else if (checkbox.checked) {
      next.add(revision);
    } else {
      next.delete(revision);
    }
    mergeRevisions = next;
    mergeSelectionAnchor = revision;
  }

  function clearMergeSelection() {
    mergeRevisions = new Set();
    mergeSelectionAnchor = null;
  }

  function openMergeDialog() {
    if (!log?.repository_url || !(log.repository_root ?? repositoryRoot)) {
      launchWindowError = {
        code: "LOG_MERGE_SOURCE_MISSING",
        message: "无法准备 Merge",
        detail: "当前日志缺少源仓库 URL，请刷新日志后重试。",
        recoverable: true,
      };
      return;
    }
    launchWindowError = null;
    mergeCompleted = false;
    mergeDialogOpen = true;
  }

  function closeMergeDialog() {
    mergeDialogOpen = false;
    if (mergeCompleted) {
      clearMergeSelection();
    }
    mergeCompleted = false;
  }

  function clearRevisionDiff() {
    diffRequestGeneration += 1;
    selectedDiff = null;
    revisionDiff = null;
    revisionDiffLoading = false;
    revisionDiffError = null;
  }

  async function openChangedPathContextMenu(
    event: MouseEvent,
    entry: SvnLogEntry,
    path: SvnChangedPath,
  ) {
    event.preventDefault();
    if (path.kind === "dir") {
      return;
    }
    launchWindowError = null;
    fileContextMenu = {
      entry,
      path,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 54)),
    };
    await tick();
    fileContextMenuElement?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function closeFileContextMenu() {
    fileContextMenu = null;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeFileContextMenu();
    }
  }

  async function openChangedPathLog() {
    const context = fileContextMenu;
    closeFileContextMenu();
    if (!context) {
      return;
    }

    const target = repositoryPathLogTarget(
      log?.repository_root ?? repositoryRoot,
      context.path.path,
      context.entry.revision,
      context.path.action,
    );
    if (!target) {
      launchWindowError = {
        code: "LOG_WINDOW_CONTEXT_MISSING",
        message: "无法打开文件 Log",
        detail: "当前日志缺少有效的仓库路径或 revision 信息，请刷新后重试。",
        recoverable: true,
      };
      return;
    }

    try {
      await launchLogWindow({
        repository_url: target.repositoryUrl,
        repository_root: (log?.repository_root ?? repositoryRoot)?.trim() ?? "",
        revision: target.revision,
      });
    } catch (caught) {
      launchWindowError = normalizeCommandError(caught, "无法启动新的 Log 窗口");
    }
  }

  async function openChangedPathDiff(entry: SvnLogEntry, path: SvnChangedPath) {
    if (path.kind === "dir") {
      return;
    }

    const previousRevision = revisionBefore(entry.revision);
    const targetUrl = repositoryPathUrlAtRevision(
      log?.repository_root,
      path.path,
      entry.revision,
      path.action,
    );
    selectedDiff = { revision: entry.revision, path: path.path };
    revisionDiff = null;
    revisionDiffError = null;

    if (!previousRevision || !targetUrl) {
      revisionDiffError = {
        code: "REVISION_DIFF_CONTEXT_MISSING",
        message: "无法准备文件 Diff",
        detail: "日志缺少仓库路径或 revision 信息，请刷新日志后重试。",
        recoverable: true,
      };
      return;
    }

    const generation = ++diffRequestGeneration;
    revisionDiffLoading = true;
    try {
      const contentDiff = await getRevisionFileContentDiff({
        target_url: targetUrl,
        file_path: path.path,
        left_revision: previousRevision,
        right_revision: entry.revision,
        action: path.action,
        svn_executable: svnExecutable?.trim() || undefined,
        max_bytes: LOG_FILE_DIFF_MAX_BYTES,
      });
      if (generation !== diffRequestGeneration) {
        return;
      }
      revisionDiff = contentDiff;
    } catch (caught) {
      if (generation === diffRequestGeneration) {
        revisionDiffError = normalizeCommandError(caught);
      }
    } finally {
      if (generation === diffRequestGeneration) {
        revisionDiffLoading = false;
      }
    }
  }

  function normalizeCommandError(
    error: unknown,
    fallbackMessage = "Revision diff 失败",
  ): CommandError {
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      return error as CommandError;
    }
    return revisionDiffCommandError(error instanceof Error ? error.message : fallbackMessage);
  }

  function revisionDiffCommandError(message: string): CommandError {
    return {
      code: "REVISION_DIFF_FAILED",
      message,
      recoverable: true,
    };
  }

  function commandErrorText(value: CommandError | null) {
    return value
      ? [value.code, value.message, value.detail].filter(Boolean).join("\n")
      : null;
  }

</script>

<main class="standalone-log" data-theme={resolvedTheme} aria-label="NovaSVN Log">
  <header class="log-titlebar">
    <div>
      <h1>NovaSVN Log</h1>
      <p title={targetPath}>{log?.target ?? targetPath}</p>
    </div>
    <div class="log-actions">
      <label>
        <span>每页</span>
        <input
          type="number"
          aria-label="每页日志数量"
          min="1"
          max="200"
          value={limit}
          on:input={(event) =>
            (limit = Math.min(
              Math.max(Number((event.currentTarget as HTMLInputElement).value) || 1, 1),
              200,
            ))}
        />
      </label>
      <button
        type="button"
        class="icon-button"
        aria-label="刷新日志"
        title="刷新日志"
        disabled={loading}
        on:click={() => loadLog(false)}
      >
        <RefreshCw size={17} strokeWidth={2} class={loading ? "spinning" : undefined} />
      </button>
      <button
        type="button"
        disabled={loading || !log?.has_more}
        on:click={() => loadLog(true)}
      >
        加载更多
      </button>
    </div>
  </header>

  <section class="log-filters" aria-label="日志过滤">
    <input
      type="search"
      aria-label="Log 关键字"
      placeholder="搜索 revision、路径或提交信息"
      bind:value={keywordFilter}
    />
    <input type="search" aria-label="Log 作者" placeholder="作者" bind:value={authorFilter} />
    <label>
      <span>开始</span>
      <input type="date" aria-label="Log 开始日期" max={dateToFilter || undefined} bind:value={dateFromFilter} />
    </label>
    <label>
      <span>结束</span>
      <input type="date" aria-label="Log 结束日期" min={dateFromFilter || undefined} bind:value={dateToFilter} />
    </label>
    <button type="button" disabled={!hasFilters} on:click={clearFilters}>清除</button>
    <span class="filter-summary" aria-live="polite">
      {filteredEntries.length} / {log?.entries.length ?? 0} revisions{log?.has_more ? "，还有更多" : ""}
    </span>
    {#if dateRangeInvalid}
      <span class="filter-error" role="status">开始日期不能晚于结束日期</span>
    {/if}
  </section>

  <div class="log-error">
    <ErrorNotice error={error ?? launchWindowError} />
  </div>

  <div
    class="log-layout"
    class:with-diff={selectedDiff !== null}
    class:merge-selection-active={selectedMergeRevisions.length > 0}
  >
    <section class="log-list" aria-label="Revision 列表" aria-busy={loading}>
      {#if filteredEntries.length > 0}
        {#each filteredEntries as entry (entry.revision)}
          <article class="log-entry">
            <header>
              <input
                type="checkbox"
                class="revision-checkbox"
                aria-label={`选择 r${entry.revision} 用于 Merge`}
                checked={mergeRevisions.has(entry.revision)}
                on:click={(event) => toggleMergeRevision(event, entry.revision)}
              />
              <button
                type="button"
                class="entry-summary"
                aria-label={`${expandedRevisions.has(entry.revision) ? "收起" : "展开"} r${entry.revision} 日志`}
                aria-expanded={expandedRevisions.has(entry.revision)}
                on:click={() => togglePaths(entry.revision)}
              >
                <span class="entry-revision">
                  <strong>r{entry.revision}</strong>
                  <span class="change-counts">
                    {#each summarizeSvnChangeActions(entry.changed_paths) as summary (summary.action)}
                      <span
                        class="change-count"
                        data-action={summary.action}
                        aria-label={`${summary.action} ${summary.count}`}
                      >{summary.action}{summary.count}</span>
                    {/each}
                  </span>
                </span>
                <span title={entry.author || undefined}>{entry.author || "-"}</span>
                <time datetime={entry.date} title={entry.date}>{formatDate(entry.date)}</time>
              </button>
              <div class="entry-meta">
                <em>{entry.changed_paths.length} paths</em>
                {#if entry.changed_paths.length > 0}
                  <button
                    type="button"
                    class="path-toggle"
                    aria-expanded={expandedRevisions.has(entry.revision)}
                    on:click={() => togglePaths(entry.revision)}
                  >
                    {#if expandedRevisions.has(entry.revision)}
                      <ChevronUp size={13} aria-hidden="true" /> 收起
                    {:else}
                      <ChevronDown size={13} aria-hidden="true" /> 查看路径
                    {/if}
                  </button>
                {/if}
              </div>
            </header>
            <p>{entry.message || "无提交信息"}</p>
            {#if entry.changed_paths.length > 0 && expandedRevisions.has(entry.revision)}
              <div class="changed-paths" aria-label={`r${entry.revision} 改变路径`}>
                {#each entry.changed_paths as path (`${entry.revision}:${path.action}:${path.path}`)}
                  <div class="changed-path">
                    <span class="change-action" data-action={path.action}>{path.action || "-"}</span>
                    {#if path.kind === "dir"}
                      <code>{path.path}</code>
                    {:else}
                      <button
                        type="button"
                        class="changed-path-button"
                        aria-label={`查看 r${entry.revision} 的 ${path.path} diff`}
                        disabled={revisionDiffLoading}
                        on:click={() => openChangedPathDiff(entry, path)}
                        on:contextmenu={(event) =>
                          openChangedPathContextMenu(event, entry, path)}
                      >
                        <code>{path.path}</code>
                      </button>
                    {/if}
                    <small>{path.kind || "-"}</small>
                  </div>
                {/each}
              </div>
            {/if}
          </article>
        {/each}
      {:else if loading}
        <div class="log-empty" role="status">正在读取日志...</div>
      {:else if log?.entries.length}
        <div class="log-empty">没有符合当前过滤条件的 revision</div>
      {:else if !error}
        <div class="log-empty">没有可显示的日志记录</div>
      {/if}
    </section>
  {#if selectedDiff}
    <aside class="log-diff" aria-label="文件 Diff">
      <header>
        <div>
          <h2>r{selectedDiff.revision} 文件 Diff</h2>
          <p title={selectedDiff.path}>{selectedDiff.path}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭文件 Diff"
          title="关闭"
          on:click={clearRevisionDiff}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div class="diff-body">
        <ErrorNotice error={revisionDiffError} />
        {#if revisionDiffLoading}
          <div class="diff-empty" role="status">正在读取 Diff...</div>
        {:else if revisionDiff?.binary}
          <div class="diff-empty">二进制文件无法预览文本修改</div>
        {:else if revisionDiff?.too_large}
          <div class="diff-empty">
            文件内容超过 {Math.round(revisionDiff.max_bytes / 1024)} KB，无法在窗口中预览
          </div>
        {:else if revisionDiff && revisionDiff.original_text !== revisionDiff.modified_text}
          <MonacoDiffViewer
            contentDiff={revisionDiff}
            inlineMode={diffMode === "inline"}
            {showWhitespace}
            theme={resolvedTheme}
          />
        {:else if revisionDiff}
          <div class="diff-empty">该文件在此 revision 没有文本 Diff</div>
        {:else if !revisionDiffError}
          <div class="diff-empty">选择文件查看 Diff</div>
        {/if}
      </div>
    </aside>
  {/if}
  </div>
  {#if selectedMergeRevisions.length > 0}
    <div class="merge-selection-bar" role="toolbar" aria-label="Revision Merge 操作">
      <div>
        <strong>已选 {selectedMergeRevisions.length} 个 Revision</strong>
        <span>
          {selectedMergeRevisions.length <= 8
            ? selectedMergeRevisions.map((revision) => `r${revision}`).join("、")
            : `r${selectedMergeRevisions[0]} 至 r${selectedMergeRevisions[selectedMergeRevisions.length - 1]}`}
        </span>
      </div>
      <button type="button" on:click={clearMergeSelection}>清除</button>
      <button type="button" class="primary" on:click={openMergeDialog}>
        <GitMerge size={16} aria-hidden="true" /> Merge 到...
      </button>
    </div>
  {/if}
  {#if fileContextMenu}
    <div
      bind:this={fileContextMenuElement}
      class="file-context-menu"
      role="menu"
      tabindex="-1"
      aria-label={`文件菜单 ${fileContextMenu.path.path}`}
      style={`left: ${fileContextMenu.x}px; top: ${fileContextMenu.y}px`}
    >
      <button type="button" role="menuitem" on:click={openChangedPathLog}>
        <History size={15} aria-hidden="true" /> 显示 Log
      </button>
    </div>
  {/if}
  {#if mergeDialogOpen && log?.repository_url && (log.repository_root ?? repositoryRoot)}
    <LogMergeDialog
      sourceUrl={log.repository_url}
      sourceRepositoryRoot={(log.repository_root ?? repositoryRoot)!}
      sourceWorkingCopyRoot={log.working_copy_root ?? null}
      revisions={selectedMergeRevisions}
      {svnExecutable}
      onClose={closeMergeDialog}
      onMerged={() => (mergeCompleted = true)}
    />
  {/if}
  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={authenticationRetry}
    onSubmit={onSvnAuthenticationSubmit}
  />
</main>

<style>
  .standalone-log {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f3f5f7;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --control: #ffffff;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
    -webkit-user-select: none;
  }

  .standalone-log input {
    user-select: text;
    -webkit-user-select: text;
  }

  .standalone-log[data-theme="dark"] {
    --background: #1f1f21;
    --panel: #29292b;
    --panel-subtle: #242426;
    --text: #f2f2f4;
    --secondary: #aaaab0;
    --border: #505054;
    --control: #353538;
    --accent: #55a7ef;
    color-scheme: dark;
  }

  .log-titlebar,
  .log-filters {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 10px 14px;
  }

  .log-titlebar {
    justify-content: space-between;
  }

  .log-titlebar > div:first-child {
    min-width: 0;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: 18px;
  }

  .log-titlebar p {
    overflow: hidden;
    margin-top: 2px;
    color: var(--secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-actions,
  .log-actions label,
  .log-filters label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--secondary);
    font-size: 12px;
    white-space: nowrap;
  }

  button,
  input {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--control);
    color: var(--text);
  }

  button {
    padding: 4px 10px;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  input {
    min-width: 0;
    padding: 5px 8px;
  }

  .log-actions input {
    width: 64px;
  }

  .icon-button {
    display: grid;
    width: 32px;
    padding: 0;
    place-items: center;
  }

  :global(.spinning) {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .log-filters {
    flex-wrap: wrap;
    background: var(--panel-subtle);
    padding-block: 8px;
  }

  .log-filters > input:first-child {
    flex: 1 1 280px;
  }

  .log-filters > input:nth-child(2) {
    width: 150px;
  }

  .log-filters input[type="date"] {
    width: 132px;
  }

  .filter-summary,
  .filter-error {
    color: var(--secondary);
    font-size: 12px;
  }

  .filter-error {
    color: #b13a35;
  }

  .log-error {
    min-height: 0;
  }

  .log-error :global(.error-notice) {
    margin: 8px 14px 0;
  }

  .log-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  .log-layout.with-diff {
    grid-template-columns: minmax(0, 1fr) minmax(360px, 42vw);
  }

  .log-layout.merge-selection-active .log-list {
    padding-bottom: 82px;
  }

  .log-list {
    min-height: 0;
    overflow: auto;
    background: var(--panel);
    padding: 0 14px 18px;
  }

  .log-entry {
    border-bottom: 1px solid var(--border);
    padding: 9px 2px;
  }

  .log-entry > header {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) minmax(72px, auto);
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .revision-checkbox {
    width: 15px;
    min-width: 15px;
    min-height: 15px;
    margin: 0;
    justify-self: center;
  }

  .entry-summary {
    display: grid;
    grid-template-columns: minmax(130px, auto) minmax(100px, 160px) 150px;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 30px;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
  }

  .entry-summary:hover,
  .entry-summary:focus-visible {
    color: var(--accent);
  }

  .log-entry > header span,
  .log-entry > header em {
    overflow: hidden;
    color: var(--secondary);
    font-style: normal;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-entry > header em {
    text-align: right;
  }

  .entry-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .entry-revision {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .entry-revision strong {
    flex: 0 0 auto;
  }

  .change-counts {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .change-count {
    border-radius: 4px;
    padding: 2px 5px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
  }

  .log-entry > p {
    margin-top: 4px;
    white-space: pre-wrap;
  }

  .changed-paths {
    display: grid;
    gap: 1px;
    margin-top: 5px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--border);
  }

  .changed-path {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 54px;
    gap: 8px;
    background: var(--panel-subtle);
    padding: 5px 8px;
    font-size: 11px;
  }

  .change-action {
    display: grid;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    font-weight: 700;
    place-items: center;
  }

  .changed-path code,
  .changed-path-button {
    min-width: 0;
  }

  .changed-path code {
    overflow-wrap: anywhere;
    font-family: "SFMono-Regular", Consolas, monospace;
  }

  .changed-path-button {
    min-height: 0;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--accent);
    padding: 1px 2px;
    text-align: left;
  }

  .changed-path-button:hover,
  .changed-path-button:focus-visible {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    outline: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .file-context-menu {
    position: fixed;
    z-index: 40;
    min-width: 164px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    padding: 4px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  }

  .file-context-menu button {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-height: 30px;
    border: 0;
    background: transparent;
    padding: 5px 8px;
    text-align: left;
  }

  .file-context-menu button:hover,
  .file-context-menu button:focus-visible {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    outline: none;
  }

  .merge-selection-bar {
    position: fixed;
    z-index: 35;
    display: flex;
    align-items: center;
    gap: 7px;
    right: 14px;
    bottom: 12px;
    left: 14px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--panel);
    padding: 8px 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  }

  .merge-selection-bar > div {
    display: grid;
    flex: 1;
    gap: 2px;
    min-width: 0;
  }

  .merge-selection-bar span {
    overflow: hidden;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .merge-selection-bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    flex: 0 0 auto;
  }

  .merge-selection-bar .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: #ffffff;
  }

  .change-action[data-action="A"],
  .change-count[data-action="A"] {
    background: #dff2e4;
    color: #24733a;
  }

  .change-action[data-action="M"],
  .change-count[data-action="M"] {
    background: #fff0c7;
    color: #805900;
  }

  .change-action[data-action="D"],
  .change-count[data-action="D"] {
    background: #fbe0df;
    color: #a12f2b;
  }

  .standalone-log[data-theme="dark"] .change-action[data-action="A"],
  .standalone-log[data-theme="dark"] .change-count[data-action="A"] {
    background: #1f4b2d;
    color: #8fdaa2;
  }

  .standalone-log[data-theme="dark"] .change-action[data-action="M"],
  .standalone-log[data-theme="dark"] .change-count[data-action="M"] {
    background: #4b3b16;
    color: #f6cf73;
  }

  .standalone-log[data-theme="dark"] .change-action[data-action="D"],
  .standalone-log[data-theme="dark"] .change-count[data-action="D"] {
    background: #522725;
    color: #ffaaa7;
  }

  .changed-path small {
    color: var(--secondary);
    text-align: right;
  }

  .path-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 22px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--accent);
    padding: 1px 0;
    font-size: 11px;
  }

  .log-empty {
    display: grid;
    min-height: 180px;
    color: var(--secondary);
    place-items: center;
  }

  .log-diff {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--border);
    background: var(--panel-subtle);
  }

  .log-diff > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 9px 10px;
  }

  .log-diff > header > div {
    min-width: 0;
  }

  .log-diff h2 {
    margin: 0;
    font-size: 13px;
  }

  .log-diff header p {
    overflow: hidden;
    margin-top: 2px;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-body {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .diff-body :global(.monaco-diff-viewer) {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  .diff-body :global(.error-notice) {
    margin: 8px 10px 0;
  }

  .diff-empty {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 0;
    color: var(--secondary);
    place-items: center;
  }

  @media (max-width: 1040px) {
    .entry-summary {
      grid-template-columns: 72px minmax(90px, 1fr) 145px;
    }
  }

  @media (max-width: 820px) {
    .log-layout.with-diff {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(220px, 1fr) minmax(240px, 1fr);
    }

    .log-diff {
      border-top: 1px solid var(--border);
      border-left: 0;
    }
  }
</style>
