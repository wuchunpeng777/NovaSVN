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
      lineNumbersMinChars: 3,
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

  function disposeModels() {
    originalModel?.dispose();
    modifiedModel?.dispose();
    originalModel = null;
    modifiedModel = null;
  }
</script>

<div class="monaco-diff-viewer" data-theme={theme}>
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

</style>
