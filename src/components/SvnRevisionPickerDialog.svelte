<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { History, RefreshCw, X } from "@lucide/svelte";
  import { getRepositoryFileLog } from "../lib/api";
  import { isRepositoryUrl } from "../lib/repository-url";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import { loadAllSvnLogPages, mergeSvnLogPage, normalizeSvnRevisionInput } from "../lib/svn-log";
  import type { CommandError, SvnLog, SvnLogEntry } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";

  export let repositoryUrl = "";
  export let svnExecutable: string | undefined = undefined;
  export let theme: "light" | "dark" = "light";
  export let currentRevision = "";
  export let title = "选择 Revision";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;
  export let onSelect: (revision: string) => void = () => {};
  export let onClose: () => void = () => {};

  const PAGE_LIMIT = 50;

  let dialogElement: HTMLDivElement | null = null;
  let log: SvnLog | null = null;
  let loading = false;
  let loadingMore = false;
  let error: CommandError | null = null;
  let selectedRevision = normalizeSvnRevisionInput(currentRevision) ?? "";
  let searchText = "";
  let requestGeneration = 0;

  $: authenticationFailure = detectSvnAuthenticationFailure(commandErrorText(error));
  $: entries = log?.entries ?? [];
  $: searchKeyword = searchText.trim().toLowerCase();
  $: visibleEntries = filterRevisionEntries(entries, searchKeyword);
  $: showHeadOption = !searchKeyword || "head".includes(searchKeyword);
  $: selectedLabel = selectedRevision ? `r${selectedRevision}` : "HEAD";

  onMount(() => {
    queueMicrotask(() => dialogElement?.focus());
    void loadLog();
  });

  onDestroy(() => {
    requestGeneration += 1;
  });

  async function loadLog() {
    const url = repositoryUrl.trim();
    if (!url || !isRepositoryUrl(url)) {
      error = commandError(
        "REVISION_PICKER_URL_INVALID",
        "请先输入有效的仓库 URL",
        "选择 Revision 需要一个 SVN 仓库 URL。",
      );
      return;
    }

    const generation = ++requestGeneration;
    loading = true;
    loadingMore = false;
    error = null;
    log = null;
    try {
      const next = await fetchLogPage();
      if (generation !== requestGeneration) {
        return;
      }
      log = next;
    } catch (caught) {
      if (generation === requestGeneration) {
        error = normalizeCommandError(caught);
      }
    } finally {
      if (generation === requestGeneration) {
        loading = false;
      }
    }
  }

  async function loadMore() {
    const url = repositoryUrl.trim();
    const currentLog = log;
    const startRevision = currentLog?.next_start_revision;
    if (!url || !currentLog?.has_more || !startRevision || loading || loadingMore) {
      return;
    }

    const generation = requestGeneration;
    loadingMore = true;
    error = null;
    try {
      const next = await fetchLogPage(startRevision);
      if (generation !== requestGeneration) {
        return;
      }
      log = mergeSvnLogPage(currentLog, next);
    } catch (caught) {
      if (generation === requestGeneration) {
        error = normalizeCommandError(caught);
      }
    } finally {
      if (generation === requestGeneration) {
        loadingMore = false;
      }
    }
  }

  async function loadAll() {
    const url = repositoryUrl.trim();
    const currentLog = log;
    if (!url || !currentLog?.has_more || !currentLog.next_start_revision || loading || loadingMore) {
      return;
    }

    const generation = requestGeneration;
    loadingMore = true;
    error = null;
    try {
      await loadAllSvnLogPages(
        currentLog,
        (startRevision) => fetchLogPage(startRevision),
        (merged) => {
          if (generation === requestGeneration) {
            log = merged;
          }
        },
        () => generation === requestGeneration,
      );
    } catch (caught) {
      if (generation === requestGeneration) {
        error = normalizeCommandError(caught);
      }
    } finally {
      if (generation === requestGeneration) {
        loadingMore = false;
      }
    }
  }

  function fetchLogPage(startRevision?: string) {
    return getRepositoryFileLog({
      url: repositoryUrl.trim(),
      svn_executable: svnExecutable?.trim() || undefined,
      limit: PAGE_LIMIT,
      ...(startRevision ? { start_revision: startRevision } : {}),
    });
  }

  function filterRevisionEntries(items: SvnLogEntry[], keyword: string) {
    if (!keyword) {
      return items;
    }
    return items.filter((entry) =>
      `${entry.revision} ${entry.author} ${entry.message} ${entry.changed_paths
        .map((path) => path.path)
        .join(" ")}`
        .toLowerCase()
        .includes(keyword),
    );
  }

  function confirmSelection(revision = selectedRevision) {
    const normalized = normalizeSvnRevisionInput(revision);
    if (normalized === null) {
      return;
    }
    onSelect(normalized);
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter" && !loading && !error) {
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      event.preventDefault();
      confirmSelection();
    }
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

  function messagePreview(entry: SvnLogEntry) {
    const line = entry.message.trim().split(/\r?\n/, 1)[0] ?? "";
    return line || "无提交信息";
  }

  function normalizeCommandError(value: unknown): CommandError {
    if (value && typeof value === "object" && "message" in value) {
      const candidate = value as Partial<CommandError>;
      return {
        code: candidate.code || "REVISION_PICKER_FAILED",
        message: String(candidate.message || "无法读取 Revision 日志"),
        detail: candidate.detail ?? null,
        recoverable: candidate.recoverable ?? true,
      };
    }
    return commandError("REVISION_PICKER_FAILED", "无法读取 Revision 日志", String(value));
  }

  function commandError(code: string, message: string, detail: string): CommandError {
    return { code, message, detail, recoverable: true };
  }

  function commandErrorText(value: CommandError | null) {
    return value
      ? [value.code, value.message, value.detail].filter(Boolean).join("\n")
      : null;
  }
</script>

<div
  class="revision-picker-backdrop"
  data-theme={theme}
  role="presentation"
  tabindex="-1"
  on:click|self={onClose}
>
  <div
    bind:this={dialogElement}
    class="revision-picker-dialog"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    on:keydown={handleKeydown}
  >
    <header>
      <div>
        <h2>{title}</h2>
        <p>{repositoryUrl.trim() || "未指定仓库 URL"}</p>
      </div>
      <button type="button" class="icon-button" aria-label="关闭 Revision 选择" title="关闭" on:click={onClose}>
        <X size={17} aria-hidden="true" />
      </button>
    </header>
    <div class="revision-picker-toolbar">
      <input
        type="search"
        aria-label="搜索 Revision"
        placeholder="搜索 revision、作者或提交信息"
        bind:value={searchText}
      />
      <button
        type="button"
        disabled={loading || loadingMore || !log?.has_more}
        on:click={loadAll}
      >
        {loadingMore ? "加载中..." : "加载全部"}
      </button>
    </div>

    <div class="revision-picker-body" aria-busy={loading || loadingMore}>
      {#if loading}
        <div class="dialog-status" role="status">正在读取仓库日志...</div>
      {:else if error && entries.length === 0}
        <ErrorNotice {error} />
        <button type="button" class="retry-button" on:click={loadLog}>
          <RefreshCw size={15} aria-hidden="true" /> 重试
        </button>
      {:else}
        {#if error}
          <ErrorNotice {error} />
        {/if}
        <div class="revision-picker-list" role="listbox" aria-label="Revision 列表">
          {#if showHeadOption}
            <button
              type="button"
              role="option"
              aria-selected={selectedRevision === ""}
              aria-label="选择 HEAD"
              on:click={() => (selectedRevision = "")}
              on:dblclick={() => confirmSelection("")}
            >
              <strong>HEAD</strong>
              <span class="meta">最新 revision</span>
              <p>检出仓库当前最新版本</p>
            </button>
          {/if}
          {#each visibleEntries as entry (entry.revision)}
            <button
              type="button"
              role="option"
              aria-selected={selectedRevision === entry.revision}
              aria-label={`选择 r${entry.revision}`}
              on:click={() => (selectedRevision = entry.revision)}
              on:dblclick={() => confirmSelection(entry.revision)}
            >
              <strong>r{entry.revision}</strong>
              <span class="meta">
                <span>{entry.author || "-"}</span>
                <time datetime={entry.date}>{formatDate(entry.date)}</time>
              </span>
              <p>{messagePreview(entry)}</p>
            </button>
          {/each}
        </div>
        {#if visibleEntries.length === 0 && !showHeadOption}
          <div class="dialog-status" role="status">没有匹配的 Revision</div>
        {/if}
        {#if log?.has_more}
          <button type="button" class="load-more" disabled={loadingMore} on:click={loadMore}>
            {loadingMore ? "加载中..." : "加载更多"}
          </button>
        {/if}
      {/if}
    </div>

    <footer>
      <button type="button" on:click={onClose}>取消</button>
      <button
        type="button"
        class="primary"
        disabled={loading || Boolean(error && entries.length === 0)}
        on:click={() => confirmSelection()}
      >
        <History size={15} aria-hidden="true" />
        使用 {selectedLabel}
      </button>
    </footer>
  </div>

  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={loadLog}
    onSubmit={onSvnAuthenticationSubmit}
  />
</div>

<style>
  .revision-picker-backdrop {
    --dialog-panel: #ffffff;
    --dialog-subtle: #f3f5f7;
    --dialog-border: #cfd6dd;
    --dialog-text: #17202a;
    --dialog-secondary: #687482;
    --dialog-accent: #2674b9;
    position: fixed;
    z-index: 80;
    display: grid;
    inset: 0;
    background: rgb(0 0 0 / 38%);
    padding: 24px;
    color: var(--dialog-text);
    place-items: center;
  }

  .revision-picker-backdrop[data-theme="dark"] {
    --dialog-panel: #29292b;
    --dialog-subtle: #242426;
    --dialog-border: #505054;
    --dialog-text: #f2f2f4;
    --dialog-secondary: #aaaab0;
    --dialog-accent: #55a7ef;
    color-scheme: dark;
  }

  .revision-picker-dialog {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    width: min(720px, calc(100vw - 32px));
    max-height: min(760px, calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid var(--dialog-border);
    border-radius: 8px;
    background: var(--dialog-panel);
    box-shadow: 0 18px 52px rgb(0 0 0 / 28%);
  }

  .revision-picker-dialog > header,
  .revision-picker-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
  }

  .revision-picker-dialog > header {
    border-bottom: 1px solid var(--dialog-border);
  }
  .revision-picker-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--dialog-border);
    background: var(--dialog-subtle);
  }

  .revision-picker-toolbar input {
    min-width: 0;
    min-height: 30px;
    border: 1px solid var(--dialog-border);
    border-radius: 5px;
    background: var(--dialog-panel);
    padding: 4px 10px;
    color: var(--dialog-text);
    font: inherit;
  }

  .revision-picker-toolbar input:hover,
  .revision-picker-toolbar input:focus-visible {
    border-color: var(--dialog-accent);
    outline: none;
  }

  .revision-picker-dialog > footer {
    justify-content: flex-end;
    border-top: 1px solid var(--dialog-border);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 16px;
  }

  header p {
    overflow: hidden;
    margin-top: 2px;
    color: var(--dialog-secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    min-height: 30px;
    border: 1px solid var(--dialog-border);
    border-radius: 5px;
    background: var(--dialog-panel);
    padding: 4px 12px;
    color: var(--dialog-text);
    font: inherit;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    border-color: var(--dialog-accent);
    color: var(--dialog-accent);
  }

  button:disabled {
    color: var(--dialog-secondary);
    cursor: default;
  }

  .icon-button {
    display: grid;
    width: 30px;
    padding: 0;
    place-items: center;
  }

  .primary {
    display: flex;
    align-items: center;
    gap: 6px;
    border-color: #1f639f;
    background: var(--dialog-accent);
    color: #ffffff;
  }

  .primary:hover:not(:disabled),
  .primary:focus-visible:not(:disabled) {
    border-color: #18578e;
    color: #ffffff;
  }

  .revision-picker-body {
    display: grid;
    align-content: start;
    gap: 10px;
    min-height: 280px;
    overflow: auto;
    padding: 12px;
  }

  .dialog-status,
  .retry-button,
  .load-more {
    justify-self: start;
  }

  .dialog-status {
    color: var(--dialog-secondary);
    font-size: 13px;
  }

  .retry-button,
  .load-more {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .revision-picker-list {
    display: grid;
    gap: 6px;
  }

  .revision-picker-list > button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      "revision meta"
      "message message";
    gap: 2px 10px;
    min-height: 52px;
    padding: 8px 10px;
    text-align: left;
    user-select: none;
  }

  .revision-picker-list > button[aria-selected="true"] {
    border-color: var(--dialog-accent);
    background: color-mix(in srgb, var(--dialog-accent) 14%, var(--dialog-panel));
  }

  .revision-picker-list strong {
    grid-area: revision;
    font-size: 13px;
  }

  .meta {
    display: flex;
    grid-area: meta;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    min-width: 0;
    color: var(--dialog-secondary);
    font-size: 11px;
  }

  .revision-picker-list p {
    grid-area: message;
    overflow: hidden;
    color: var(--dialog-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
