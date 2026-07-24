<script lang="ts">
  import { ArrowDown, ArrowUp } from "@lucide/svelte";

  export let differenceCount = 0;
  export let currentDifference = 0;
  export let theme: "light" | "dark" = "light";
  export let onPrevious: () => void = () => {};
  export let onNext: () => void = () => {};
</script>

<div class="diff-navigation" data-theme={theme} role="toolbar" aria-label="Diff 差异导航">
  <span aria-live="polite">{currentDifference} / {differenceCount} 处差异</span>
  <button
    type="button"
    aria-label="上一处差异"
    title="上一处差异"
    disabled={differenceCount === 0}
    on:click={onPrevious}
  >
    <ArrowUp size={15} strokeWidth={2} aria-hidden="true" />
  </button>
  <button
    type="button"
    aria-label="下一处差异"
    title="下一处差异"
    disabled={differenceCount === 0}
    on:click={onNext}
  >
    <ArrowDown size={15} strokeWidth={2} aria-hidden="true" />
  </button>
</div>

<style>
  .diff-navigation {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
    border-bottom: 1px solid var(--border, #d5d9de);
    background: var(--panel-subtle, #f5f6f7);
    padding: 3px 7px;
  }

  .diff-navigation span {
    margin-right: 3px;
    color: var(--secondary, #68737d);
    font-size: 11px;
    white-space: nowrap;
  }

  .diff-navigation button {
    display: grid;
    width: 26px;
    min-width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    padding: 0;
    color: var(--text, #27313a);
    place-items: center;
  }

  .diff-navigation button:hover:not(:disabled) {
    border-color: var(--border-strong, #b7c0c9);
    background: var(--control-hover, #e8ebee);
  }

  .diff-navigation button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent, #2878b8) 45%, transparent);
    outline-offset: -1px;
  }

  .diff-navigation button:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .diff-navigation[data-theme="dark"] {
    border-color: var(--border, #454d55);
    background: var(--panel-subtle, #252a2f);
  }
</style>
