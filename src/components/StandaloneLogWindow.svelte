<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ChevronDown, ChevronUp, RefreshCw, X } from "@lucide/svelte";
  import { getPathSvnLog } from "../lib/api";
  import {
    cacheCommitMessages,
    readCommitMessageSettings,
    setPendingCommitMessage,
  } from "../lib/commit-message-history";
  import type { CommandError, SvnLog, SvnLogEntry } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";

  let log: SvnLog | null = null;
  let loading = false;
  let error: CommandError | null = null;
  let keywordFilter = "";
  let authorFilter = "";
  let dateFromFilter = "";
  let dateToFilter = "";
  let limit = 50;
  let expandedRevisions = new Set<string>();
  let cachedCommitMessages: string[] = [];
  let historyPickerOpen = false;
  let selectedHistoryMessage = "";
  let historyNotice: string | null = null;
  let requestGeneration = 0;
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

  onMount(() => {
    cachedCommitMessages = readCommitMessageSettings().history;
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    void loadLog(false);
  });

  onDestroy(() => {
    requestGeneration += 1;
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
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
    loading = true;
    error = null;
    try {
      const page = await getPathSvnLog({
        path,
        svn_executable: svnExecutable?.trim() || undefined,
        limit,
        start_revision: startRevision ?? undefined,
      });
      if (generation !== requestGeneration) {
        return;
      }
      log = append && log ? mergeLogPage(log, page) : page;
      cachedCommitMessages = cacheCommitMessages(
        page.entries.map((entry) => entry.message).filter(Boolean),
      );
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

  function openHistoryPicker() {
    cachedCommitMessages = readCommitMessageSettings().history;
    selectedHistoryMessage = cachedCommitMessages[0] ?? "";
    historyNotice = null;
    historyPickerOpen = true;
  }

  function closeHistoryPicker() {
    historyPickerOpen = false;
  }

  function useSelectedHistoryMessage() {
    if (!selectedHistoryMessage.trim()) {
      return;
    }
    setPendingCommitMessage(selectedHistoryMessage);
    cachedCommitMessages = cacheCommitMessages([selectedHistoryMessage]);
    historyNotice = "已填充到提交日志";
    historyPickerOpen = false;
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
      <button
        type="button"
        disabled={cachedCommitMessages.length === 0}
        on:click={openHistoryPicker}
      >
        获取历史日志
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

  <ErrorNotice {error} />

  <section class="log-list" aria-label="Revision 列表" aria-busy={loading}>
    {#if filteredEntries.length > 0}
      {#each filteredEntries as entry (entry.revision)}
        <article class="log-entry">
          <header>
            <strong>r{entry.revision}</strong>
            <span title={entry.author || undefined}>{entry.author || "-"}</span>
            <time datetime={entry.date} title={entry.date}>{formatDate(entry.date)}</time>
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
          {#if entry.changed_paths.length > 0}
            {#if expandedRevisions.has(entry.revision)}
              <div class="changed-paths" aria-label={`r${entry.revision} 改变路径`}>
                {#each entry.changed_paths as path (`${entry.revision}:${path.action}:${path.path}`)}
                  <div class="changed-path">
                    <span data-action={path.action}>{path.action || "-"}</span>
                    <code>{path.path}</code>
                    <small>{path.kind || "-"}</small>
                  </div>
                {/each}
              </div>
            {/if}
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
</main>

{#if historyNotice}
  <div class="history-notice" role="status">{historyNotice}</div>
{/if}

{#if historyPickerOpen}
  <div class="history-backdrop" role="presentation" on:click|self={closeHistoryPicker}>
    <div
      class="history-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="选择历史提交日志"
    >
      <header>
        <h2>选择历史提交日志</h2>
        <button type="button" class="icon-button" aria-label="关闭" title="关闭" on:click={closeHistoryPicker}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <select
        class="history-select"
        size="8"
        aria-label="历史提交日志"
        bind:value={selectedHistoryMessage}
      >
        {#each cachedCommitMessages as message}
          <option value={message}>{message}</option>
        {/each}
      </select>
      <footer>
        <button type="button" on:click={closeHistoryPicker}>取消</button>
        <button
          type="button"
          class="primary-action"
          disabled={!selectedHistoryMessage.trim()}
          on:click={useSelectedHistoryMessage}
        >
          填充提交日志
        </button>
      </footer>
    </div>
  </div>
{/if}

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

  :global(.standalone-log > .error-notice) {
    margin: 8px 14px 0;
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
    grid-template-columns: 84px minmax(100px, 160px) 150px minmax(72px, 1fr);
    align-items: center;
    gap: 10px;
    min-width: 0;
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

  .changed-path > span {
    color: var(--accent);
    font-weight: 700;
  }

  .changed-path code {
    overflow-wrap: anywhere;
    font-family: "SFMono-Regular", Consolas, monospace;
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

  .history-notice {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 3;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel);
    box-shadow: 0 4px 14px rgb(0 0 0 / 14%);
    color: var(--text);
    padding: 8px 12px;
    font-size: 12px;
  }

  .history-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2;
    display: grid;
    background: rgb(10 18 26 / 28%);
    padding: 24px;
    place-items: center;
  }

  .history-dialog {
    display: grid;
    grid-template-rows: auto minmax(180px, 1fr) auto;
    width: min(560px, 100%);
    max-height: min(560px, 100%);
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    box-shadow: 0 12px 34px rgb(0 0 0 / 22%);
    color: var(--text);
    padding: 14px;
  }

  .history-dialog > header,
  .history-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .history-dialog > header {
    padding-bottom: 10px;
  }

  .history-dialog > footer {
    justify-content: flex-end;
    padding-top: 10px;
  }

  .history-dialog h2 {
    margin: 0;
    font-size: 15px;
  }

  .history-select {
    min-height: 220px;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--control);
    color: var(--text);
    padding: 4px;
    font: inherit;
    font-size: 12px;
  }

  .history-select option {
    padding: 7px 8px;
    white-space: pre-wrap;
  }

  .primary-action {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  @media (max-width: 1040px) {
    .log-entry > header {
      grid-template-columns: 72px minmax(90px, 1fr) 145px auto;
    }
  }
</style>
