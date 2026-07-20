<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { RefreshCw, X } from "@lucide/svelte";
  import { getSvnBlame, inspectUpdateTarget } from "../lib/api";
  import type {
    CommandError,
    SvnBlame,
    SvnBlameLine,
    UpdateTargetSummary,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";

  const rowHeight = 29;
  const tableHeaderHeight = 30;
  const overscan = 12;
  const contentColumnMinWidth = 240;
  const columnLimits = {
    revision: { min: 64, max: 180 },
    author: { min: 80, max: 300 },
    date: { min: 120, max: 260 },
    line: { min: 48, max: 120 },
  } as const;
  type ResizableColumn = keyof typeof columnLimits;

  let target: UpdateTargetSummary | null = null;
  let blame: SvnBlame | null = null;
  let loading = false;
  let error: CommandError | null = null;
  let filterText = "";
  let requestGeneration = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let tableElement: HTMLDivElement | null = null;
  let tableScrollTop = 0;
  let tableViewportHeight = 500;
  let resizeObserver: ResizeObserver | null = null;
  let columnWidths: Record<ResizableColumn, number> = {
    revision: 86,
    author: 140,
    date: 166,
    line: 64,
  };
  let activeColumnResize: {
    column: ResizableColumn;
    startX: number;
    startWidth: number;
  } | null = null;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: filteredLines = filterBlameLines(blame?.lines ?? [], filterText);
  $: revisionCount = new Set(blame?.lines.map((line) => line.revision).filter(Boolean)).size;
  $: authorCount = new Set(blame?.lines.map((line) => line.author).filter(Boolean)).size;
  $: firstVisibleIndex = Math.max(
    0,
    Math.floor(Math.max(tableScrollTop - tableHeaderHeight, 0) / rowHeight) - overscan,
  );
  $: visibleLineCount = Math.ceil(tableViewportHeight / rowHeight) + overscan * 2;
  $: visibleLines = filteredLines.slice(
    firstVisibleIndex,
    firstVisibleIndex + visibleLineCount,
  );
  $: beforeHeight = firstVisibleIndex * rowHeight;
  $: afterHeight = Math.max(
    0,
    (filteredLines.length - firstVisibleIndex - visibleLines.length) * rowHeight,
  );
  $: columnTemplate = `${columnWidths.revision}px ${columnWidths.author}px ${columnWidths.date}px ${columnWidths.line}px minmax(${contentColumnMinWidth}px, 1fr)`;
  $: tableMinWidth =
    columnWidths.revision +
    columnWidths.author +
    columnWidths.date +
    columnWidths.line +
    contentColumnMinWidth;

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    if (tableElement && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(([entry]) => {
        tableViewportHeight = entry.contentRect.height;
      });
      resizeObserver.observe(tableElement);
    }
    void loadBlame();
  });

  onDestroy(() => {
    requestGeneration += 1;
    stopColumnResize();
    resizeObserver?.disconnect();
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  async function loadBlame() {
    const path = targetPath.trim();
    if (!path) {
      error = {
        code: "SVN_BLAME_TARGET_MISSING",
        message: "没有可读取的 Blame 文件",
        detail: "请从 Windows 资源管理器中的 SVN 文件右键打开 NovaSVN Blame。",
        recoverable: false,
      };
      return;
    }

    const generation = ++requestGeneration;
    loading = true;
    error = null;
    blame = null;
    try {
      const inspected = await inspectUpdateTarget({
        path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (generation !== requestGeneration) {
        return;
      }
      target = inspected;
      if (inspected.kind !== "file" || !inspected.relative_path) {
        throw {
          code: "SVN_BLAME_FILE_REQUIRED",
          message: "Blame 仅支持文件",
          detail: "请在 Windows 资源管理器中右键选择一个受版本控制的文件。",
          recoverable: true,
        } satisfies CommandError;
      }
      const result = await getSvnBlame({
        working_copy_root: inspected.working_copy_root,
        file_path: inspected.relative_path,
        svn_executable: svnExecutable?.trim() || undefined,
        max_lines: 5000,
      });
      if (generation !== requestGeneration) {
        return;
      }
      blame = result;
      resetTableScroll();
    } catch (caught) {
      if (generation === requestGeneration) {
        error = caught as CommandError;
      }
    } finally {
      if (generation === requestGeneration) {
        loading = false;
      }
    }
  }

  function filterBlameLines(lines: SvnBlameLine[], value: string) {
    const query = value.trim().toLowerCase();
    if (!query) {
      return lines;
    }
    return lines.filter((line) =>
      `${line.revision} ${line.author} ${line.line_number} ${line.content}`
        .toLowerCase()
        .includes(query),
    );
  }

  function updateFilter(event: Event) {
    filterText = (event.currentTarget as HTMLInputElement).value;
    resetTableScroll();
  }

  function clearFilter() {
    filterText = "";
    resetTableScroll();
  }

  function resetTableScroll() {
    tableScrollTop = 0;
    if (tableElement) {
      tableElement.scrollTop = 0;
    }
  }

  function handleTableScroll(event: Event) {
    const element = event.currentTarget as HTMLDivElement;
    tableScrollTop = element.scrollTop;
    tableViewportHeight = element.clientHeight;
  }

  function startColumnResize(column: ResizableColumn, event: PointerEvent) {
    event.preventDefault();
    activeColumnResize = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column],
    };
    window.addEventListener("pointermove", handleColumnResize);
    window.addEventListener("pointerup", stopColumnResize);
    window.addEventListener("pointercancel", stopColumnResize);
  }

  function handleColumnResize(event: PointerEvent) {
    if (!activeColumnResize) {
      return;
    }
    setColumnWidth(
      activeColumnResize.column,
      activeColumnResize.startWidth + event.clientX - activeColumnResize.startX,
    );
  }

  function stopColumnResize() {
    activeColumnResize = null;
    window.removeEventListener("pointermove", handleColumnResize);
    window.removeEventListener("pointerup", stopColumnResize);
    window.removeEventListener("pointercancel", stopColumnResize);
  }

  function handleColumnResizeKeydown(column: ResizableColumn, event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    setColumnWidth(column, columnWidths[column] + (event.key === "ArrowRight" ? 10 : -10));
  }

  function setColumnWidth(column: ResizableColumn, width: number) {
    const limits = columnLimits[column];
    columnWidths = {
      ...columnWidths,
      [column]: Math.min(Math.max(Math.round(width), limits.min), limits.max),
    };
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
</script>

<main
  class="standalone-blame"
  class:resizing-columns={activeColumnResize !== null}
  data-theme={resolvedTheme}
  aria-label="NovaSVN Blame"
>
  <header class="blame-titlebar">
    <div>
      <h1>NovaSVN Blame</h1>
      <p title={targetPath}>{target?.target_path ?? targetPath}</p>
    </div>
    <button
      type="button"
      class="icon-button"
      aria-label="刷新 Blame"
      title="刷新 Blame"
      disabled={loading}
      on:click={loadBlame}
    >
      <RefreshCw size={17} class={loading ? "spinning" : undefined} aria-hidden="true" />
    </button>
  </header>

  <section class="blame-summary" aria-label="Blame 摘要">
    <span>Revision <strong>{target?.revision ?? "-"}</strong></span>
    <span>行数 <strong>{blame?.total_lines ?? 0}</strong></span>
    <span>Revision 数 <strong>{revisionCount}</strong></span>
    <span>作者 <strong>{authorCount}</strong></span>
    {#if blame?.truncated}
      <span class="truncated">仅显示前 {blame.lines.length} 行</span>
    {/if}
  </section>

  <section class="blame-filter" aria-label="Blame 过滤">
    <input
      type="search"
      aria-label="过滤 Blame"
      placeholder="过滤 Revision、作者、行号或内容"
      value={filterText}
      on:input={updateFilter}
    />
    {#if filterText}
      <button type="button" class="icon-button" aria-label="清除过滤" title="清除过滤" on:click={clearFilter}>
        <X size={15} aria-hidden="true" />
      </button>
    {/if}
    <span aria-live="polite">{filteredLines.length} / {blame?.lines.length ?? 0} 行</span>
  </section>

  <div class="blame-notice"><ErrorNotice {error} /></div>

  <section class="blame-content-pane" aria-label="逐行历史" aria-busy={loading}>
    <div
      class="standalone-blame-table"
      role="table"
      aria-label={`${target?.relative_path ?? targetPath} Blame`}
      bind:this={tableElement}
      on:scroll={handleTableScroll}
    >
      <div
        class="standalone-blame-row standalone-blame-head"
        role="row"
        style={`grid-template-columns: ${columnTemplate}; min-width: ${tableMinWidth}px`}
      >
        <span role="columnheader">
          <span class="header-label">Revision</span>
          <button
            type="button"
            class="column-resizer"
            aria-label="调整 Revision 列宽"
            data-width={columnWidths.revision}
            title="拖动调整列宽"
            on:pointerdown={(event) => startColumnResize("revision", event)}
            on:keydown={(event) => handleColumnResizeKeydown("revision", event)}
          ></button>
        </span>
        <span role="columnheader">
          <span class="header-label">作者</span>
          <button
            type="button"
            class="column-resizer"
            aria-label="调整作者列宽"
            data-width={columnWidths.author}
            title="拖动调整列宽"
            on:pointerdown={(event) => startColumnResize("author", event)}
            on:keydown={(event) => handleColumnResizeKeydown("author", event)}
          ></button>
        </span>
        <span role="columnheader">
          <span class="header-label">日期</span>
          <button
            type="button"
            class="column-resizer"
            aria-label="调整日期列宽"
            data-width={columnWidths.date}
            title="拖动调整列宽"
            on:pointerdown={(event) => startColumnResize("date", event)}
            on:keydown={(event) => handleColumnResizeKeydown("date", event)}
          ></button>
        </span>
        <span role="columnheader">
          <span class="header-label">行</span>
          <button
            type="button"
            class="column-resizer"
            aria-label="调整行号列宽"
            data-width={columnWidths.line}
            title="拖动调整列宽"
            on:pointerdown={(event) => startColumnResize("line", event)}
            on:keydown={(event) => handleColumnResizeKeydown("line", event)}
          ></button>
        </span>
        <span role="columnheader">内容</span>
      </div>
      {#if beforeHeight > 0}
        <div class="virtual-spacer" style={`height: ${beforeHeight}px; min-width: ${tableMinWidth}px`} aria-hidden="true"></div>
      {/if}
      {#each visibleLines as line (line.line_number)}
        <div
          class="standalone-blame-row"
          role="row"
          style={`grid-template-columns: ${columnTemplate}; min-width: ${tableMinWidth}px`}
        >
          <span role="cell">{line.revision ? `r${line.revision}` : "-"}</span>
          <span role="cell" title={line.author || undefined}>{line.author || "-"}</span>
          <span role="cell"><time datetime={line.date} title={line.date}>{formatDate(line.date)}</time></span>
          <span role="cell" class="line-number">{line.line_number}</span>
          <span role="cell" class="line-content"><code title={line.content}>{line.content || " "}</code></span>
        </div>
      {/each}
      {#if afterHeight > 0}
        <div class="virtual-spacer" style={`height: ${afterHeight}px; min-width: ${tableMinWidth}px`} aria-hidden="true"></div>
      {/if}
      {#if loading}
        <div class="empty-state" role="status">正在读取 Blame...</div>
      {:else if !error && filteredLines.length === 0}
        <div class="empty-state">{blame?.lines.length ? "没有符合过滤条件的行" : "没有可显示的逐行历史"}</div>
      {/if}
    </div>
  </section>
</main>

<style>
  .standalone-blame {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f1f3f5;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --control: #ffffff;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto auto auto minmax(0, 1fr);
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
    -webkit-user-select: none;
  }

  .standalone-blame[data-theme="dark"] {
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

  .blame-titlebar,
  .blame-summary,
  .blame-filter {
    display: flex;
    align-items: center;
  }

  .blame-titlebar {
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 10px 14px;
  }

  .blame-titlebar > div {
    min-width: 0;
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    font-size: 18px;
  }

  .blame-titlebar p {
    overflow: hidden;
    margin-top: 2px;
    color: var(--secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button,
  input {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--control);
    color: var(--text);
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .icon-button {
    display: grid;
    width: 30px;
    flex: 0 0 30px;
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

  .blame-summary {
    gap: 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-subtle);
    padding: 8px 14px;
    color: var(--secondary);
    font-size: 12px;
  }

  .blame-summary strong {
    margin-left: 4px;
    color: var(--text);
  }

  .blame-summary .truncated {
    margin-left: auto;
    color: #a35b17;
  }

  .blame-filter {
    gap: 8px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 8px 14px;
  }

  .blame-filter input {
    width: min(520px, 100%);
    padding: 4px 9px;
    font-size: 12px;
  }

  .blame-filter > span {
    margin-left: auto;
    color: var(--secondary);
    font-size: 12px;
  }

  .blame-notice:empty {
    display: none;
  }

  .blame-content-pane {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .standalone-blame-table {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    border: 0;
    background: var(--panel);
  }

  .standalone-blame-row {
    display: grid;
    height: 29px;
    width: 100%;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }

  .standalone-blame-row > span {
    min-width: 0;
    overflow: hidden;
    padding: 6px 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .standalone-blame-row > :global(* + *) {
    border-left: 1px solid var(--border);
  }

  .standalone-blame-head {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 30px;
    background: var(--panel-subtle);
    color: var(--secondary);
    font-weight: 700;
  }

  .standalone-blame-head > span {
    position: relative;
    overflow: visible;
    padding-right: 10px;
  }

  .header-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .column-resizer {
    position: absolute;
    top: 0;
    right: -5px;
    z-index: 2;
    width: 10px;
    height: 100%;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 0;
    cursor: col-resize;
    touch-action: none;
  }

  .column-resizer::after {
    position: absolute;
    top: 5px;
    bottom: 5px;
    left: 4px;
    width: 1px;
    background: var(--border);
    content: "";
  }

  .column-resizer:hover::after,
  .column-resizer:focus-visible::after {
    width: 2px;
    background: var(--accent);
  }

  .column-resizer:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -2px;
  }

  .standalone-blame.resizing-columns,
  .standalone-blame.resizing-columns :global(*) {
    cursor: col-resize !important;
  }

  .line-number {
    color: var(--secondary);
    text-align: right;
  }

  .line-content code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: var(--text);
    font-family: Consolas, "SFMono-Regular", monospace;
  }

  .empty-state {
    display: grid;
    min-height: 180px;
    color: var(--secondary);
    font-size: 12px;
    place-items: center;
  }

  @media (max-width: 760px) {
    .blame-summary {
      gap: 12px;
      overflow-x: auto;
      white-space: nowrap;
    }
  }
</style>
