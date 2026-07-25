<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  import type * as Monaco from "monaco-editor";
  import type { FileContentDiff } from "../../types/api";
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
        inlineMode,
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
        inlineMode,
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
    currentDifference = nextCount === 0 ? 0 : Math.min(Math.max(currentDifference, 1), nextCount);
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

  function lineNumberMinimumCharacters(
    isInline: boolean,
    original: import("monaco-editor").editor.ITextModel | null,
    modified: import("monaco-editor").editor.ITextModel | null,
  ) {
    if (!isInline) {
      return 3;
    }
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
</script>

<div class="monaco-diff-viewer" class:inline-mode={inlineMode} data-theme={theme}>
  <DiffNavigation
    {differenceCount}
    {currentDifference}
    {theme}
    onPrevious={() => goToDifference("previous")}
    onNext={() => goToDifference("next")}
  />
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

  .monaco-diff-editor {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .monaco-diff-viewer.inline-mode
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original .monaco-editor) {
    --vscode-editorLineNumber-foreground: var(--inline-original-line-number);
    --vscode-editorLineNumber-activeForeground: var(--inline-original-line-number);
  }

  .monaco-diff-viewer.inline-mode
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.modified .monaco-editor) {
    --vscode-editorLineNumber-foreground: var(--inline-modified-line-number);
    --vscode-editorLineNumber-activeForeground: var(--inline-modified-line-number);
  }

  .monaco-diff-viewer.inline-mode
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

  .monaco-diff-viewer.inline-mode
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original .margin) {
    background-color: var(--inline-original-line-number-background);
  }

  .monaco-diff-viewer.inline-mode
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.modified .margin) {
    background-color: var(--inline-modified-line-number-background);
  }

  .monaco-diff-viewer.inline-mode
    :global(.monaco-diff-editor:not(.side-by-side) > .editor.original .margin-view-overlays .line-numbers) {
    box-sizing: border-box;
    padding-right: 6px;
    color: var(--inline-original-line-number);
  }

  .monaco-diff-viewer.inline-mode
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

</style>
