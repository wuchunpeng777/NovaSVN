<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  import type * as Monaco from "monaco-editor";
  import type { FileContentDiff } from "../../types/api";
  import {
    hasEncodingChange,
    hasTextContentChange,
  } from "../../lib/file-content-diff";
  import DiffNavigation from "./DiffNavigation.svelte";

  export let contentDiff: FileContentDiff | null = null;
  export let inlineMode = false;
  export let showWhitespace = false;
  export let theme: "light" | "dark" = "light";

  let container: HTMLDivElement;
  let monacoEditor: typeof Monaco.editor | null = null;
  let editor: import("monaco-editor").editor.IStandaloneDiffEditor | null = null;
  let originalModel: import("monaco-editor").editor.ITextModel | null = null;
  let modifiedModel: import("monaco-editor").editor.ITextModel | null = null;
  let diffUpdateDisposable: import("monaco-editor").IDisposable | null = null;
  let cursorUpdateDisposable: import("monaco-editor").IDisposable | null = null;
  let differenceCount = 0;
  let currentDifference = 0;
  let revealFirstDifference = false;

  onMount(async () => {
    window.MonacoEnvironment = {
      getWorker() {
        return new EditorWorker();
      },
    };
    await Promise.all([
      import("monaco-editor/esm/vs/basic-languages/css/css.contribution"),
      import("monaco-editor/esm/vs/basic-languages/html/html.contribution"),
      import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"),
      import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
      import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution"),
      import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution"),
      import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution"),
      import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"),
      import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution"),
      import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution"),
    ]);
    const editorModule = await import("monaco-editor/esm/vs/editor/editor.api");
    monacoEditor = editorModule.editor;
    await tick();
    if (!container || !contentDiff) {
      return;
    }

    createEditor();
  });

  onDestroy(() => {
    diffUpdateDisposable?.dispose();
    cursorUpdateDisposable?.dispose();
    disposeModels();
    editor?.dispose();
  });

  $: if (editor && contentDiff) {
    updateModels();
  }

  $: if (editor) {
    editor.updateOptions({
      renderSideBySide: !inlineMode,
      renderWhitespace: showWhitespace ? "all" : "none",
      lineNumbersMinChars: lineNumberMinimumCharacters(
        originalModel,
        modifiedModel,
      ),
    });
  }

  $: if (monacoEditor) {
    monacoEditor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }

  function createEditor() {
    if (!monacoEditor || editor || !contentDiff) {
      return;
    }

    editor = monacoEditor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      // 只读 Diff 仍允许查找高亮，便于在大 diff 中定位关键字
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: "never",
        seedSearchStringFromSelection: "always",
      },
      minimap: { enabled: false },
      renderSideBySide: !inlineMode,
      renderWhitespace: showWhitespace ? "all" : "none",
      scrollBeyondLastLine: false,
      wordWrap: "off",
      scrollbar: {
        horizontal: "auto",
        horizontalScrollbarSize: 12,
      },
      fontSize: 12,
      lineNumbersMinChars: lineNumberMinimumCharacters(
        originalModel,
        modifiedModel,
      ),
      overviewRulerLanes: 0,
    });
    diffUpdateDisposable = editor.onDidUpdateDiff(updateDifferenceCount);
    cursorUpdateDisposable = editor
      .getModifiedEditor()
      .onDidChangeCursorPosition(({ position }) => syncDifferenceFromLine(position.lineNumber));
    monacoEditor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    updateModels();
  }

  function updateModels() {
    if (!monacoEditor || !editor || !contentDiff) {
      return;
    }

    differenceCount = 0;
    currentDifference = 0;
    revealFirstDifference = true;
    disposeModels();
    originalModel = monacoEditor.createModel(
      contentDiff.original_text,
      contentDiff.language,
    );
    modifiedModel = monacoEditor.createModel(
      contentDiff.modified_text,
      contentDiff.language,
    );
    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
  }

  function updateDifferenceCount() {
    const nextCount = editor?.getLineChanges()?.length ?? 0;
    differenceCount = nextCount;
    if (nextCount === 0) {
      currentDifference = 0;
      return;
    }
    if (revealFirstDifference) {
      revealFirstDifference = false;
      currentDifference = 1;
      editor?.goToDiff("next");
      return;
    }
    currentDifference = Math.min(Math.max(currentDifference, 1), nextCount);
  }

  function syncDifferenceFromLine(lineNumber: number) {
    const changes = editor?.getLineChanges() ?? [];
    const index = changes.findIndex((change) => {
      const start = change.modifiedStartLineNumber;
      const end = Math.max(start, change.modifiedEndLineNumber);
      return lineNumber >= start && lineNumber <= end;
    });
    if (index >= 0) {
      currentDifference = index + 1;
    }
  }

  function goToDifference(target: "next" | "previous") {
    if (!editor || differenceCount === 0) {
      return;
    }
    currentDifference = target === "next"
      ? (currentDifference % differenceCount) + 1
      : ((currentDifference - 2 + differenceCount) % differenceCount) + 1;
    editor.goToDiff(target);
    editor.getModifiedEditor().focus();
  }

  function openSearch() {
    const modified = editor?.getModifiedEditor();
    if (!modified) {
      return;
    }
    modified.focus();
    // Monaco 内置查找：在 modified 侧搜索，覆盖左右对照内容
    void modified.getAction("actions.find")?.run();
  }

  function handleViewerKeydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") {
      return;
    }
    if (!editor) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openSearch();
  }

  function lineNumberMinimumCharacters(
    original: import("monaco-editor").editor.ITextModel | null,
    modified: import("monaco-editor").editor.ITextModel | null,
  ) {
    const largestLineNumber = Math.max(
      original?.getLineCount() ?? 1,
      modified?.getLineCount() ?? 1,
    );
    return Math.max(5, String(largestLineNumber).length + 2);
  }

  function disposeModels() {
    originalModel?.dispose();
    modifiedModel?.dispose();
    originalModel = null;
    modifiedModel = null;
  }

  function formatEncodingLabel(encoding: string | null | undefined): string {
    const value = encoding?.trim();
    return value ? value : "—";
  }

  $: originalEncodingLabel = formatEncodingLabel(contentDiff?.original_encoding);
  $: modifiedEncodingLabel = formatEncodingLabel(contentDiff?.modified_encoding);
  $: encodingMismatch = hasEncodingChange(contentDiff);
  $: encodingOnlyChange =
    encodingMismatch && !hasTextContentChange(contentDiff);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="monaco-diff-viewer"
  class:inline-mode={inlineMode}
  data-theme={theme}
  on:keydown={handleViewerKeydown}
>
  <div class="monaco-diff-toolbar">
    <div
      class="diff-encoding-labels"
      class:mismatch={encodingMismatch}
      class:side-by-side={!inlineMode}
      aria-label="文件编码"
    >
      {#if inlineMode}
        <span title={`旧版本编码：${originalEncodingLabel}`}>旧 {originalEncodingLabel}</span>
        <span class="encoding-separator" aria-hidden="true">·</span>
        <span title={`新版本编码：${modifiedEncodingLabel}`}>新 {modifiedEncodingLabel}</span>
      {:else}
        <span class="encoding-side original" title={`旧版本编码：${originalEncodingLabel}`}>
          旧 · {originalEncodingLabel}
        </span>
        <span class="encoding-side modified" title={`新版本编码：${modifiedEncodingLabel}`}>
          新 · {modifiedEncodingLabel}
        </span>
      {/if}
    </div>
    <DiffNavigation
      {differenceCount}
      {currentDifference}
      {theme}
      searchEnabled={true}
      onPrevious={() => goToDifference("previous")}
      onNext={() => goToDifference("next")}
      onSearch={openSearch}
    />
  </div>
  {#if encodingOnlyChange}
    <div class="encoding-only-notice" role="status">
      文本内容相同，编码不同：{originalEncodingLabel} → {modifiedEncodingLabel}
    </div>
  {/if}
  <div class="monaco-diff-editor" bind:this={container}></div>
</div>

<style>
  .monaco-diff-viewer {
    --inline-original-line-number: #b42318;
    --inline-modified-line-number: #18713f;
    --inline-original-line-number-background: rgba(180, 35, 24, 0.055);
    --inline-modified-line-number-background: rgba(24, 113, 63, 0.055);
    --inline-line-number-divider: rgba(180, 35, 24, 0.38);
    display: grid;
    grid-template-rows: 34px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .monaco-diff-viewer:has(.encoding-only-notice) {
    grid-template-rows: 34px auto minmax(0, 1fr);
  }

  .encoding-only-notice {
    min-width: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--warning-text, #9a6700) 28%, var(--border, #d5d9de));
    background: color-mix(in srgb, var(--warning-text, #9a6700) 12%, var(--panel-subtle, #f5f6f7));
    padding: 5px 10px;
    color: var(--warning-text, #9a6700);
    font-size: 11px;
    font-weight: 600;
  }

  .monaco-diff-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    min-width: 0;
    border-bottom: 1px solid var(--border, #d5d9de);
    background: var(--panel-subtle, #f5f6f7);
  }

  .diff-encoding-labels {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 10px;
    color: var(--secondary, #68737d);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-encoding-labels.side-by-side {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0;
    padding: 0;
  }

  .diff-encoding-labels .encoding-side {
    min-width: 0;
    padding: 0 10px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-encoding-labels .encoding-side.original {
    border-right: 1px solid var(--border, #d5d9de);
  }

  .diff-encoding-labels.mismatch {
    color: var(--warning-text, #9a6700);
    font-weight: 600;
  }

  .encoding-separator {
    opacity: 0.7;
  }

  .monaco-diff-editor {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .monaco-diff-viewer :global(.diff-navigation) {
    border-bottom: none;
    background: transparent;
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original .monaco-editor) {
    --vscode-editorLineNumber-foreground: var(--inline-original-line-number);
    --vscode-editorLineNumber-activeForeground: var(--inline-original-line-number);
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.modified .monaco-editor) {
    --vscode-editorLineNumber-foreground: var(--inline-modified-line-number);
    --vscode-editorLineNumber-activeForeground: var(--inline-modified-line-number);
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original::after) {
    position: absolute;
    z-index: 20;
    top: 0;
    right: 0;
    bottom: 0;
    width: 1px;
    background: var(--inline-line-number-divider);
    content: "";
    pointer-events: none;
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original .margin) {
    background-color: var(--inline-original-line-number-background);
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.modified .margin) {
    background-color: var(--inline-modified-line-number-background);
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original .margin-view-overlays .line-numbers) {
    box-sizing: border-box;
    padding-right: 6px;
    color: var(--inline-original-line-number);
  }

  .monaco-diff-viewer
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.modified .margin-view-overlays .line-numbers) {
    color: var(--inline-modified-line-number);
  }

  .monaco-diff-viewer[data-theme="dark"] {
    --inline-original-line-number: #ff8a80;
    --inline-modified-line-number: #7ee787;
    --inline-original-line-number-background: rgba(255, 138, 128, 0.075);
    --inline-modified-line-number-background: rgba(126, 231, 135, 0.065);
    --inline-line-number-divider: rgba(255, 138, 128, 0.46);
  }

  .monaco-diff-viewer[data-theme="dark"] .monaco-diff-toolbar {
    border-color: var(--border, #454d55);
    background: var(--panel-subtle, #252a2f);
  }

  .monaco-diff-viewer[data-theme="dark"] .diff-encoding-labels .encoding-side.original {
    border-color: var(--border, #454d55);
  }

  .monaco-diff-viewer[data-theme="dark"] .diff-encoding-labels.mismatch {
    color: var(--warning-text, #d4a72c);
  }

  .monaco-diff-viewer[data-theme="dark"] .encoding-only-notice {
    border-color: color-mix(in srgb, var(--warning-text, #d4a72c) 32%, var(--border, #454d55));
    background: color-mix(in srgb, var(--warning-text, #d4a72c) 14%, var(--panel-subtle, #252a2f));
    color: var(--warning-text, #d4a72c);
  }

</style>
