<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  import type * as Monaco from "monaco-editor";
  import type { FileContentDiff } from "../../types/api";

  export let contentDiff: FileContentDiff | null = null;
  export let inlineMode = false;
  export let showWhitespace = false;

  let container: HTMLDivElement;
  let monacoModule: typeof Monaco | null = null;
  let editor: import("monaco-editor").editor.IStandaloneDiffEditor | null = null;
  let originalModel: import("monaco-editor").editor.ITextModel | null = null;
  let modifiedModel: import("monaco-editor").editor.ITextModel | null = null;

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
    monacoModule = await import("monaco-editor/esm/vs/editor/editor.api");
    await tick();
    if (!container || !contentDiff) {
      return;
    }

    createEditor();
  });

  onDestroy(() => {
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

  function createEditor() {
    if (!monacoModule || editor || !contentDiff) {
      return;
    }

    editor = monacoModule.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      minimap: { enabled: false },
      renderSideBySide: !inlineMode,
      renderWhitespace: showWhitespace ? "all" : "none",
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineNumbersMinChars: 3,
      overviewRulerLanes: 0,
    });
    updateModels();
  }

  function updateModels() {
    if (!monacoModule || !editor || !contentDiff) {
      return;
    }

    disposeModels();
    originalModel = monacoModule.editor.createModel(
      contentDiff.original_text,
      contentDiff.language,
    );
    modifiedModel = monacoModule.editor.createModel(
      contentDiff.modified_text,
      contentDiff.language,
    );
    editor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });
  }

  function disposeModels() {
    originalModel?.dispose();
    modifiedModel?.dispose();
    originalModel = null;
    modifiedModel = null;
  }
</script>

<div class="monaco-diff-viewer" bind:this={container}></div>
