<script lang="ts">
  import { tick } from "svelte";
  import DiffNavigation from "./DiffNavigation.svelte";

  export let text = "";
  export let theme: "light" | "dark" = "light";

  let contentElement: HTMLPreElement;
  let sourceText = "";
  let hunkLineIndexes: number[] = [];
  let activeHunkIndex = -1;

  $: if (text !== sourceText) {
    sourceText = text;
    hunkLineIndexes = text
      .split(/\r?\n/)
      .map((line, index) => (line.startsWith("@@") ? index : -1))
      .filter((index) => index >= 0);
    activeHunkIndex = hunkLineIndexes.length > 0 ? 0 : -1;
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
    const computedLineHeight = Number.parseFloat(getComputedStyle(contentElement).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 16;
    const top = Math.max(0, hunkLineIndexes[index] * lineHeight - 12);
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
</script>

<div class="raw-diff-viewer" data-theme={theme}>
  <DiffNavigation
    differenceCount={hunkLineIndexes.length}
    currentDifference={activeHunkIndex >= 0 ? activeHunkIndex + 1 : 0}
    {theme}
    onPrevious={() => goToHunk(-1)}
    onNext={() => goToHunk(1)}
  />
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
</style>
