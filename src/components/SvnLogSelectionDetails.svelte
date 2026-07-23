<script lang="ts">
  import { File, Folder, ListTree } from "@lucide/svelte";
  import type { SvnChangedPath, SvnLogEntry } from "../types/api";

  export let entries: SvnLogEntry[] = [];
  export let selectedRevisions: string[] = [];
  export let diffLoading = false;
  export let theme: "light" | "dark" = "light";
  export let onOpenDiff: (entry: SvnLogEntry, path: SvnChangedPath) => void = () => {};
  export let onOpenContextMenu: (
    event: MouseEvent,
    entry: SvnLogEntry,
    path: SvnChangedPath,
  ) => void = () => {};

  $: entriesByRevision = new Map(entries.map((entry) => [entry.revision, entry]));
  $: selectedEntries = selectedRevisions
    .map((revision) => entriesByRevision.get(revision))
    .filter((entry): entry is SvnLogEntry => entry !== undefined);
  $: totalChangedPaths = selectedEntries.reduce(
    (total, entry) => total + entry.changed_paths.length,
    0,
  );
</script>

<aside
  class="svn-log-selection-details"
  data-theme={theme}
  aria-label="已选 Revision 文件变化"
>
  <header class="selection-heading">
    <span class="selection-mark" aria-hidden="true"><ListTree size={17} /></span>
    <div>
      <h2>文件变化</h2>
      <p>{selectedEntries.length} 个 Revision，{totalChangedPaths} 个路径</p>
    </div>
  </header>

  <div class="selection-body">
    {#each selectedEntries as entry (entry.revision)}
      <section class="revision-paths" aria-label={`r${entry.revision} 文件变化`}>
        <header>
          <strong>r{entry.revision}</strong>
          <span title={entry.message || undefined}>{entry.message || "无提交信息"}</span>
          <em>{entry.changed_paths.length}</em>
        </header>

        {#if entry.changed_paths.length > 0}
          <div class="path-list">
            {#each entry.changed_paths as path (`${entry.revision}:${path.action}:${path.path}`)}
              {#if path.kind === "dir"}
                <div class="path-row directory">
                  <span class="change-action" data-action={path.action}>{path.action || "-"}</span>
                  <span class="path-icon" aria-hidden="true"><Folder size={15} /></span>
                  <code title={path.path}>{path.path}</code>
                  <small>目录</small>
                </div>
              {:else}
                <button
                  type="button"
                  class="path-row"
                  aria-label={`查看 r${entry.revision} 的 ${path.path} diff`}
                  disabled={diffLoading}
                  on:click={() => onOpenDiff(entry, path)}
                  on:contextmenu={(event) => onOpenContextMenu(event, entry, path)}
                >
                  <span class="change-action" data-action={path.action}>{path.action || "-"}</span>
                  <span class="path-icon" aria-hidden="true"><File size={15} /></span>
                  <code title={path.path}>{path.path}</code>
                  <small>文件</small>
                </button>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="empty-paths">该 Revision 没有路径变化</p>
        {/if}
      </section>
    {/each}
  </div>
</aside>

<style>
  .svn-log-selection-details {
    --details-panel: #ffffff;
    --details-subtle: #f3f5f7;
    --details-border: #cfd6dd;
    --details-text: #17202a;
    --details-secondary: #687482;
    --details-accent: #2674b9;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--details-panel);
    color: var(--details-text);
  }

  .svn-log-selection-details[data-theme="dark"] {
    --details-panel: #29292b;
    --details-subtle: #242426;
    --details-border: #505054;
    --details-text: #f2f2f4;
    --details-secondary: #aaaab0;
    --details-accent: #55a7ef;
    color-scheme: dark;
  }

  .selection-heading {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    border-bottom: 1px solid var(--details-border);
    background: var(--details-subtle);
    padding: 10px 12px;
  }

  .selection-mark {
    display: grid;
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    border-radius: 5px;
    background: var(--details-accent);
    color: #ffffff;
    place-items: center;
  }

  .selection-heading div,
  .revision-paths header span,
  .path-row code {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 13px;
  }

  .selection-heading p {
    margin-top: 2px;
    color: var(--details-secondary);
    font-size: 11px;
  }

  .selection-body {
    min-height: 0;
    overflow: auto;
  }

  .revision-paths {
    border-bottom: 1px solid var(--details-border);
    padding: 10px 12px 12px;
  }

  .revision-paths > header {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }

  .revision-paths header strong {
    color: var(--details-accent);
    font-size: 12px;
  }

  .revision-paths header span {
    overflow: hidden;
    color: var(--details-secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .revision-paths header em {
    color: var(--details-secondary);
    font-size: 11px;
    font-style: normal;
  }

  .path-list {
    display: grid;
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--details-border);
    border-radius: 5px;
    background: var(--details-border);
  }

  .path-row {
    display: grid;
    grid-template-columns: 24px 16px minmax(0, 1fr) 32px;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: 31px;
    width: 100%;
    border: 0;
    border-radius: 0;
    background: var(--details-panel);
    padding: 4px 7px;
    color: var(--details-text);
    text-align: left;
  }

  button.path-row {
    cursor: pointer;
  }

  button.path-row:hover:not(:disabled),
  button.path-row:focus-visible {
    background: color-mix(in srgb, var(--details-accent) 10%, var(--details-panel));
    color: var(--details-accent);
    outline: none;
  }

  button.path-row:disabled {
    color: var(--details-secondary);
    cursor: default;
  }

  .path-icon {
    display: grid;
    color: var(--details-secondary);
    place-items: center;
  }

  .path-row code {
    overflow: hidden;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path-row small {
    color: var(--details-secondary);
    font-size: 10px;
    text-align: right;
  }

  .change-action {
    display: grid;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: #dfe6ed;
    color: #536070;
    font-size: 10px;
    font-weight: 700;
    place-items: center;
  }

  .change-action[data-action="A"] {
    background: #dff2e4;
    color: #24733a;
  }

  .change-action[data-action="M"] {
    background: #fff0c7;
    color: #805900;
  }

  .change-action[data-action="D"] {
    background: #fbe0df;
    color: #a12f2b;
  }

  .svn-log-selection-details[data-theme="dark"] .change-action[data-action="A"] {
    background: #1f4b2d;
    color: #8fdaa2;
  }

  .svn-log-selection-details[data-theme="dark"] .change-action[data-action="M"] {
    background: #4b3b16;
    color: #f6cf73;
  }

  .svn-log-selection-details[data-theme="dark"] .change-action[data-action="D"] {
    background: #522725;
    color: #ffaaa7;
  }

  .empty-paths {
    border: 1px solid var(--details-border);
    border-radius: 5px;
    padding: 12px;
    color: var(--details-secondary);
    font-size: 11px;
    text-align: center;
  }
</style>
