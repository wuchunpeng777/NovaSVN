<script lang="ts">
  import { tick } from "svelte";
  import DiffNavigation from "./DiffNavigation.svelte";

  export let text = "";
  export let theme: "light" | "dark" = "light";

  let contentElement: HTMLPreElement;
  let sourceText = "";
  let hunkLineIndexes: number[] = [];
  let activeHunkIndex = -1;
  let searchOpen = false;
  let searchQuery = "";
  let searchMatches: number[] = [];
  let activeMatchIndex = -1;
  let searchInputElement: HTMLInputElement | null = null;

  $: if (text !== sourceText) {
    sourceText = text;
    hunkLineIndexes = text
      .split(/\r?\n/)
      .map((line, index) => (line.startsWith("@@") ? index : -1))
      .filter((index) => index >= 0);
    activeHunkIndex = hunkLineIndexes.length > 0 ? 0 : -1;
    recomputeSearchMatches(searchQuery);
    if (activeHunkIndex >= 0) {
      void revealFirstHunk(sourceText);
    }
  }

  async function revealFirstHunk(expectedText: string) {
    await tick();
    if (sourceText !== expectedText || activeHunkIndex !== 0) {
      return;
    }
    scrollToHunk(0, "auto");
  }

  function goToHunk(offset: -1 | 1) {
    if (!contentElement || hunkLineIndexes.length === 0) {
      return;
    }

    if (activeHunkIndex < 0) {
      activeHunkIndex = offset > 0 ? 0 : hunkLineIndexes.length - 1;
    } else {
      activeHunkIndex =
        (activeHunkIndex + offset + hunkLineIndexes.length) % hunkLineIndexes.length;
    }

    scrollToHunk(activeHunkIndex, "smooth");
  }

  function scrollToHunk(index: number, behavior: ScrollBehavior) {
    if (!contentElement || index < 0 || index >= hunkLineIndexes.length) {
      return;
    }
    scrollToLine(hunkLineIndexes[index], behavior);
  }

  function scrollToLine(lineIndex: number, behavior: ScrollBehavior) {
    if (!contentElement) {
      return;
    }
    const computedLineHeight = Number.parseFloat(getComputedStyle(contentElement).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 16;
    const top = Math.max(0, lineIndex * lineHeight - 12);
    if (typeof contentElement.scrollTo === "function") {
      contentElement.scrollTo({ top, behavior });
    } else {
      contentElement.scrollTop = top;
    }
  }

  function syncHunkFromScroll() {
    if (!contentElement || hunkLineIndexes.length === 0) {
      return;
    }
    const computedLineHeight = Number.parseFloat(getComputedStyle(contentElement).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 16;
    const visibleLine = Math.max(0, Math.round((contentElement.scrollTop + 12) / lineHeight));
    let closestIndex = 0;
    for (let index = 1; index < hunkLineIndexes.length; index += 1) {
      if (hunkLineIndexes[index] > visibleLine) {
        break;
      }
      closestIndex = index;
    }
    activeHunkIndex = closestIndex;
  }

  async function openSearch() {
    searchOpen = true;
    await tick();
    searchInputElement?.focus();
    searchInputElement?.select();
  }

  function closeSearch() {
    searchOpen = false;
    searchQuery = "";
    searchMatches = [];
    activeMatchIndex = -1;
  }

  function recomputeSearchMatches(query: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      searchMatches = [];
      activeMatchIndex = -1;
      return;
    }
    const lines = sourceText.split(/\r?\n/);
    const matches: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].toLowerCase().includes(needle)) {
        matches.push(index);
      }
    }
    searchMatches = matches;
    if (matches.length === 0) {
      activeMatchIndex = -1;
      return;
    }
    activeMatchIndex = 0;
    scrollToLine(matches[0], "smooth");
  }

  function handleSearchInput(event: Event) {
    searchQuery = (event.currentTarget as HTMLInputElement).value;
    recomputeSearchMatches(searchQuery);
  }

  function goToSearchMatch(offset: -1 | 1) {
    if (searchMatches.length === 0) {
      return;
    }
    if (activeMatchIndex < 0) {
      activeMatchIndex = offset > 0 ? 0 : searchMatches.length - 1;
    } else {
      activeMatchIndex =
        (activeMatchIndex + offset + searchMatches.length) % searchMatches.length;
    }
    scrollToLine(searchMatches[activeMatchIndex], "smooth");
  }

  function handleViewerKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      void openSearch();
      return;
    }
    if (event.key === "Escape" && searchOpen) {
      event.preventDefault();
      closeSearch();
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      goToSearchMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="raw-diff-viewer" data-theme={theme} on:keydown={handleViewerKeydown}>
  <DiffNavigation
    differenceCount={hunkLineIndexes.length}
    currentDifference={activeHunkIndex >= 0 ? activeHunkIndex + 1 : 0}
    {theme}
    searchEnabled={true}
    onPrevious={() => goToHunk(-1)}
    onNext={() => goToHunk(1)}
    onSearch={() => void openSearch()}
  />
  {#if searchOpen}
    <div class="raw-diff-search" role="search" aria-label="Diff 搜索">
      <input
        bind:this={searchInputElement}
        type="search"
        value={searchQuery}
        placeholder="搜索 Diff 内容"
        aria-label="搜索 Diff 内容"
        on:input={handleSearchInput}
        on:keydown={handleSearchKeydown}
      />
      <span aria-live="polite">
        {searchQuery.trim()
          ? searchMatches.length > 0
            ? `${activeMatchIndex + 1} / ${searchMatches.length}`
            : "无匹配"
          : "输入关键字"}
      </span>
      <button type="button" aria-label="上一个匹配" disabled={searchMatches.length === 0} on:click={() => goToSearchMatch(-1)}>
        上一个
      </button>
      <button type="button" aria-label="下一个匹配" disabled={searchMatches.length === 0} on:click={() => goToSearchMatch(1)}>
        下一个
      </button>
      <button type="button" aria-label="关闭搜索" on:click={closeSearch}>关闭</button>
    </div>
  {/if}
  <pre class="raw-diff-content" bind:this={contentElement} on:scroll={syncHunkFromScroll}>{text}</pre>
</div>

<style>
  .raw-diff-viewer {
    display: grid;
    grid-template-rows: 34px minmax(0, 1fr);
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .raw-diff-viewer:has(.raw-diff-search) {
    grid-template-rows: 34px auto minmax(0, 1fr);
  }

  .raw-diff-search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    border-bottom: 1px solid var(--border, #d5d9de);
    background: var(--panel, #ffffff);
    padding: 5px 8px;
  }

  .raw-diff-search input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 28px;
    border: 1px solid var(--border, #cfd6dd);
    border-radius: 4px;
    background: var(--control, #ffffff);
    color: var(--text, #27313a);
    padding: 3px 8px;
    font-size: 12px;
  }

  .raw-diff-search span {
    flex: 0 0 auto;
    color: var(--secondary, #68737d);
    font-size: 11px;
    white-space: nowrap;
  }

  .raw-diff-search button {
    flex: 0 0 auto;
    min-height: 28px;
    border: 1px solid var(--border, #cfd6dd);
    border-radius: 4px;
    background: var(--control, #ffffff);
    color: var(--text, #27313a);
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .raw-diff-search button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .raw-diff-content {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: auto;
    box-sizing: border-box;
    margin: 0;
    border: 0;
    border-radius: 0;
    background: var(--panel-subtle, #f7f8f9);
    padding: 10px 12px;
    color: var(--text, #27313a);
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    outline: 0;
    user-select: text;
    white-space: pre;
    -webkit-user-select: text;
  }

  .raw-diff-viewer[data-theme="dark"] .raw-diff-content {
    background: var(--panel-subtle, #181c21);
  }

  .raw-diff-viewer[data-theme="dark"] .raw-diff-search {
    border-color: var(--border, #454d55);
    background: var(--panel, #29292b);
  }

  .raw-diff-viewer[data-theme="dark"] .raw-diff-search input,
  .raw-diff-viewer[data-theme="dark"] .raw-diff-search button {
    border-color: var(--border, #505054);
    background: var(--control, #353538);
    color: var(--text, #f2f2f4);
  }
</style>
