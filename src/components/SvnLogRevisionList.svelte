<script lang="ts">
  import { ChevronDown, ChevronUp, FolderClock, Undo2 } from "@lucide/svelte";
  import { summarizeSvnChangeActions } from "../lib/svn-log";
  import type { SvnChangedPath, SvnLogEntry } from "../types/api";

  export let entries: SvnLogEntry[] = [];
  export let totalEntries = 0;
  export let loading = false;
  export let hasLoadError = false;
  export let expandedRevisions = new Set<string>();
  export let mergeRevisions: Set<string> | null = null;
  export let diffLoading = false;
  export let compact = false;
  export let currentRevision: string | null = null;
  export let theme: "light" | "dark" = "light";
  export let emptyText = "没有可显示的日志记录";
  export let loadingText = "正在读取日志...";
  export let filteredEmptyText = "没有符合当前过滤条件的 revision";
  export let formatDate: (value: string) => string = (value) => value || "-";
  export let revertDisabled: (entry: SvnLogEntry) => boolean = () => true;
  export let revertTitle: (entry: SvnLogEntry) => string = (entry) =>
    `撤销提交 r${entry.revision}`;
  export let workspaceRevertDisabled: (entry: SvnLogEntry) => boolean = () => true;
  export let workspaceRevertTitle: (entry: SvnLogEntry) => string = (entry) =>
    `回退工作区到 r${entry.revision}`;
  export let onTogglePaths: (revision: string) => void = () => {};
  export let onToggleMerge: (event: MouseEvent, revision: string) => void = () => {};
  export let onOpenDiff: (entry: SvnLogEntry, path: SvnChangedPath) => void = () => {};
  export let onOpenContextMenu: (
    event: MouseEvent,
    entry: SvnLogEntry,
    path: SvnChangedPath,
  ) => void = () => {};
  export let onRevert: (entry: SvnLogEntry) => void = () => {};
  export let onRevertWorkspace: (entry: SvnLogEntry) => void = () => {};

  function isCurrentRevision(revision: string) {
    const normalize = (value: string | null) => value?.trim().replace(/^r/i, "") ?? "";
    const normalizedCurrent = normalize(currentRevision);
    return normalizedCurrent.length > 0 && normalize(revision) === normalizedCurrent;
  }
</script>

<section
  class="svn-log-list"
  class:compact
  data-theme={theme}
  aria-label="Revision 列表"
  aria-busy={loading}
>
  {#if entries.length > 0}
    {#each entries as entry (entry.revision)}
      <article
        class="svn-log-entry"
        class:current-revision={isCurrentRevision(entry.revision)}
        aria-current={isCurrentRevision(entry.revision) ? "true" : undefined}
      >
        <header
          class="svn-log-entry-header"
          class:with-merge={mergeRevisions !== null}
        >
          {#if mergeRevisions !== null}
            <input
              type="checkbox"
              class="svn-log-revision-checkbox"
              aria-label={`选择 r${entry.revision} 用于 Merge`}
              checked={mergeRevisions.has(entry.revision)}
              on:click={(event) => onToggleMerge(event, entry.revision)}
            />
          {/if}
          <button
            type="button"
            class="svn-log-entry-summary"
            aria-label={`${expandedRevisions.has(entry.revision) ? "收起" : "展开"} r${entry.revision} 日志`}
            aria-expanded={expandedRevisions.has(entry.revision)}
            on:click={() => onTogglePaths(entry.revision)}
          >
            <span class="svn-log-revision">
              <strong>r{entry.revision}</strong>
              {#if isCurrentRevision(entry.revision)}
                <span class="svn-log-current-revision" aria-label={`本地版本 r${entry.revision}`}>本地</span>
              {/if}
              <span class="svn-log-change-counts">
                {#each summarizeSvnChangeActions(entry.changed_paths) as summary (summary.action)}
                  <span
                    class="svn-log-change-count"
                    data-action={summary.action}
                    aria-label={`${summary.action} ${summary.count}`}
                  >{summary.action}{summary.count}</span>
                {/each}
              </span>
            </span>
            <span class="svn-log-author" title={entry.author || undefined}>
              {entry.author || "-"}
            </span>
            <time datetime={entry.date} title={entry.date}>{formatDate(entry.date)}</time>
          </button>
          <div class="svn-log-entry-meta">
            <em>{entry.changed_paths.length} paths</em>
            {#if entry.changed_paths.length > 0}
              <button
                type="button"
                class="svn-log-path-toggle"
                aria-expanded={expandedRevisions.has(entry.revision)}
                on:click={() => onTogglePaths(entry.revision)}
              >
                {#if expandedRevisions.has(entry.revision)}
                  <ChevronUp size={13} aria-hidden="true" /> 收起
                {:else}
                  <ChevronDown size={13} aria-hidden="true" /> 查看路径
                {/if}
              </button>
            {/if}
            <button
              type="button"
              class="svn-log-revert"
              aria-label={`撤销提交 r${entry.revision}`}
              title={revertTitle(entry)}
              disabled={revertDisabled(entry)}
              on:click={() => onRevert(entry)}
            >
              <Undo2 size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="svn-log-revert svn-log-revert-workspace"
              aria-label={`回退工作区到 r${entry.revision}`}
              title={workspaceRevertTitle(entry)}
              disabled={workspaceRevertDisabled(entry)}
              on:click={() => onRevertWorkspace(entry)}
            >
              <FolderClock size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>
        <p class="svn-log-message">{entry.message || "无提交信息"}</p>
        {#if entry.changed_paths.length > 0 && expandedRevisions.has(entry.revision)}
          <div
            class="svn-log-changed-paths"
            aria-label={`r${entry.revision} 改变路径`}
          >
            {#each entry.changed_paths as path (`${entry.revision}:${path.action}:${path.path}`)}
              <div class="svn-log-changed-path">
                <span class="svn-log-change-action" data-action={path.action}>
                  {path.action || "-"}
                </span>
                {#if path.kind === "dir"}
                  <code>{path.path}</code>
                {:else}
                  <button
                    type="button"
                    class="svn-log-changed-path-button"
                    aria-label={`查看 r${entry.revision} 的 ${path.path} diff`}
                    disabled={diffLoading}
                    on:click={() => onOpenDiff(entry, path)}
                    on:contextmenu={(event) => onOpenContextMenu(event, entry, path)}
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
    <div class="svn-log-empty" role="status">{loadingText}</div>
  {:else if totalEntries > 0}
    <div class="svn-log-empty">{filteredEmptyText}</div>
  {:else if !hasLoadError}
    <div class="svn-log-empty">{emptyText}</div>
  {/if}
</section>

<style>
  .svn-log-list {
    --log-panel: #ffffff;
    --log-panel-subtle: #f8f9fa;
    --log-border: #cfd6dd;
    --log-text: #17202a;
    --log-secondary: #6b7784;
    --log-accent: #245f91;
    min-height: 0;
    overflow: auto;
    background: var(--log-panel);
    padding: 0 14px 18px;
    color: var(--log-text);
  }

  .svn-log-list[data-theme="dark"] {
    --log-panel: #1f1f21;
    --log-panel-subtle: #29292b;
    --log-border: #505054;
    --log-text: #f2f2f4;
    --log-secondary: #a9a9ae;
    --log-accent: #55a7ef;
  }

  .svn-log-entry {
    border-left: 4px solid transparent;
    border-bottom: 1px solid var(--log-border);
    padding: 9px 6px;
  }

  .svn-log-entry.current-revision {
    border-left-color: var(--log-accent);
    background: color-mix(in srgb, var(--log-accent) 18%, var(--log-panel));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--log-accent) 34%, transparent);
  }

  .svn-log-entry.current-revision .svn-log-revision > strong {
    border-radius: 4px;
    background: color-mix(in srgb, var(--log-accent) 24%, var(--log-panel));
    padding: 2px 5px;
    color: var(--log-accent);
  }

  .svn-log-entry-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(150px, auto);
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .svn-log-entry-header.with-merge {
    grid-template-columns: 24px minmax(0, 1fr) minmax(150px, auto);
  }

  .svn-log-revision-checkbox {
    width: 15px;
    min-width: 15px;
    min-height: 15px;
    margin: 0;
    justify-self: center;
  }

  .svn-log-entry-summary {
    display: grid;
    grid-template-columns: max-content minmax(80px, 160px) 150px;
    align-items: center;
    justify-content: start;
    gap: 10px;
    min-width: 0;
    min-height: 30px;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
    text-align: left;
  }

  .svn-log-entry-summary:hover,
  .svn-log-entry-summary:focus-visible {
    color: var(--log-accent);
  }

  .svn-log-entry-summary > span,
  .svn-log-entry-summary > time,
  .svn-log-entry-meta em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .svn-log-author,
  .svn-log-entry-summary > time,
  .svn-log-entry-meta em {
    color: var(--log-secondary);
  }

  .svn-log-entry-meta {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .svn-log-entry-meta em {
    font-style: normal;
    text-align: right;
  }

  .svn-log-revision,
  .svn-log-change-counts {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .svn-log-revision {
    gap: 7px;
  }

  .svn-log-current-revision {
    flex: 0 0 auto;
    border: 1px solid var(--log-accent);
    border-radius: 4px;
    background: var(--log-accent);
    padding: 1px 5px;
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.25;
  }

  .svn-log-revision strong,
  .svn-log-change-count {
    flex: 0 0 auto;
  }

  .svn-log-change-counts {
    gap: 4px;
  }

  .svn-log-change-count {
    border-radius: 4px;
    padding: 2px 5px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
  }

  .svn-log-message {
    margin: 4px 0 0;
    color: inherit;
    white-space: pre-wrap;
  }

  .svn-log-changed-paths {
    display: grid;
    gap: 1px;
    margin-top: 5px;
    overflow: hidden;
    border: 1px solid var(--log-border);
    border-radius: 5px;
    background: var(--log-border);
  }

  .svn-log-changed-path {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 54px;
    align-items: start;
    gap: 8px;
    background: var(--log-panel-subtle);
    padding: 5px 8px;
    font-size: 11px;
  }

  .svn-log-changed-path code,
  .svn-log-changed-path-button {
    min-width: 0;
  }

  .svn-log-changed-path code {
    overflow-wrap: anywhere;
    font-family: "SFMono-Regular", Consolas, monospace;
  }

  .svn-log-changed-path-button {
    min-height: 0;
    border: 0;
    border-radius: 2px;
    background: transparent;
    padding: 1px 2px;
    color: var(--log-accent);
    text-align: left;
  }

  .svn-log-changed-path-button:hover,
  .svn-log-changed-path-button:focus-visible {
    background: color-mix(in srgb, var(--log-accent) 10%, transparent);
    outline: 1px solid color-mix(in srgb, var(--log-accent) 60%, transparent);
  }

  .svn-log-changed-path-button:disabled {
    background: transparent;
    color: var(--log-secondary);
  }

  .svn-log-changed-path small {
    color: var(--log-secondary);
    text-align: right;
  }

  .svn-log-change-action {
    display: grid;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: #dfe6ed;
    color: #536070;
    font-size: 11px;
    font-weight: 700;
    place-items: center;
  }

  .svn-log-path-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 22px;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 1px 0;
    color: var(--log-accent);
    font-size: 11px;
  }

  .svn-log-revert {
    display: inline-grid;
    flex: 0 0 28px;
    width: 28px;
    min-width: 28px;
    min-height: 28px;
    border: 1px solid color-mix(in srgb, var(--log-accent) 45%, var(--log-border));
    border-radius: 5px;
    background: color-mix(in srgb, var(--log-accent) 7%, var(--log-panel));
    padding: 0;
    color: var(--log-accent);
    place-items: center;
  }

  .svn-log-revert-workspace {
    border-color: #d1a24d;
    background: #fff4d6;
    color: #805900;
  }

  .svn-log-list[data-theme="dark"] .svn-log-revert-workspace {
    border-color: #80651f;
    background: #4b3b16;
    color: #f6cf73;
  }

  .svn-log-empty {
    display: grid;
    min-height: 180px;
    color: var(--log-secondary);
    place-items: center;
  }

  .svn-log-change-count[data-action="A"],
  .svn-log-change-action[data-action="A"] {
    background: #dff2e4;
    color: #24733a;
  }

  .svn-log-change-count[data-action="M"],
  .svn-log-change-action[data-action="M"] {
    background: #fff0c7;
    color: #805900;
  }

  .svn-log-change-count[data-action="D"],
  .svn-log-change-action[data-action="D"] {
    background: #fbe0df;
    color: #a12f2b;
  }

  .svn-log-list[data-theme="dark"] .svn-log-change-count[data-action="A"],
  .svn-log-list[data-theme="dark"] .svn-log-change-action[data-action="A"] {
    background: #1f4b2d;
    color: #8fdaa2;
  }

  .svn-log-list[data-theme="dark"] .svn-log-change-count[data-action="M"],
  .svn-log-list[data-theme="dark"] .svn-log-change-action[data-action="M"] {
    background: #4b3b16;
    color: #f6cf73;
  }

  .svn-log-list[data-theme="dark"] .svn-log-change-count[data-action="D"],
  .svn-log-list[data-theme="dark"] .svn-log-change-action[data-action="D"] {
    background: #522725;
    color: #ffaaa7;
  }

  .svn-log-list.compact .svn-log-entry-header {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .svn-log-list.compact .svn-log-entry-header.with-merge {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .svn-log-list.compact .svn-log-entry-meta {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .svn-log-list.compact .svn-log-entry-header.with-merge .svn-log-entry-meta {
    grid-column: 2;
  }

  .svn-log-list.compact .svn-log-entry-summary {
    grid-template-columns: max-content minmax(64px, 110px) 140px;
  }
</style>
