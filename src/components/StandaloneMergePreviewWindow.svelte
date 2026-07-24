<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    ChevronLeft,
    ChevronRight,
    CircleCheck,
    FileWarning,
    GitMerge,
    LoaderCircle,
    Play,
    X,
  } from "@lucide/svelte";
  import {
    createApplyMergePreviewTask,
    getMergePreview,
    getMergePreviewFile,
    getTask,
    releaseMergePreview,
  } from "../lib/api";
  import type {
    CommandError,
    FileContentDiff,
    MergePreviewFile,
    MergePreviewSession,
    Task,
    TaskStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import MonacoDiffViewer from "./workbench/MonacoDiffViewer.svelte";

  export let previewId: string;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let diffMode: "side_by_side" | "inline" = "side_by_side";
  export let showWhitespace = false;

  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];
  let session: MergePreviewSession | null = null;
  let selectedPath: string | null = null;
  let contentDiff: FileContentDiff | null = null;
  let loading = true;
  let fileLoading = false;
  let error: CommandError | null = null;
  let fileError: CommandError | null = null;
  let applyTask: Task | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let releasing = false;

  $: resolvedTheme = themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: selectedIndex = session?.files.findIndex((file) => file.path === selectedPath) ?? -1;
  $: selectedFile = selectedIndex >= 0 ? session?.files[selectedIndex] ?? null : null;
  $: applyRunning = applyTask !== null && !terminalStatuses.includes(applyTask.status);
  $: applyResult = applyTask?.result?.merge_result ?? null;

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("keydown", handleWindowKeydown);
    void loadSession();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    window.removeEventListener("keydown", handleWindowKeydown);
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
    if (!applyRunning && !releasing) {
      void releaseMergePreview(previewId).catch(() => undefined);
    }
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented || applyRunning) {
      return;
    }
    event.preventDefault();
    void closeWindow();
  }

  async function loadSession() {
    const currentGeneration = ++generation;
    loading = true;
    error = null;
    try {
      const nextSession = await getMergePreview(previewId);
      if (currentGeneration !== generation) return;
      session = nextSession;
      selectedPath = nextSession.files[0]?.path ?? null;
      if (selectedPath) await loadFile(selectedPath, currentGeneration);
    } catch (caught) {
      if (currentGeneration === generation) error = normalizeError(caught, "无法打开 Merge 预览");
    } finally {
      if (currentGeneration === generation) loading = false;
    }
  }

  async function loadFile(path: string, currentGeneration = ++generation) {
    selectedPath = path;
    fileLoading = true;
    fileError = null;
    contentDiff = null;
    try {
      const content = await getMergePreviewFile(previewId, path);
      if (currentGeneration !== generation || selectedPath !== path) return;
      contentDiff = {
        path: content.path,
        original_text: content.original_text,
        modified_text: content.modified_text,
        language: content.language,
        binary: content.binary,
        too_large: content.too_large,
        max_bytes: content.max_bytes,
      };
    } catch (caught) {
      if (currentGeneration === generation) fileError = normalizeError(caught, "无法读取预览文件");
    } finally {
      if (currentGeneration === generation) fileLoading = false;
    }
  }

  function moveFile(offset: -1 | 1) {
    if (!session || session.files.length === 0 || fileLoading) return;
    const current = selectedIndex >= 0 ? selectedIndex : 0;
    const next = (current + offset + session.files.length) % session.files.length;
    void loadFile(session.files[next].path);
  }

  async function applyMerge() {
    if (applyRunning || !session) return;
    error = null;
    try {
      applyTask = await createApplyMergePreviewTask({ preview_id: previewId });
      schedulePoll(applyTask.task_id, generation, 0);
    } catch (caught) {
      error = normalizeError(caught, "无法应用 Merge 预览");
    }
  }

  function schedulePoll(taskId: string, currentGeneration: number, delay: number) {
    clearPollTimer();
    pollTimer = window.setTimeout(() => void pollTask(taskId, currentGeneration), delay);
  }

  async function pollTask(taskId: string, currentGeneration: number) {
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) return;
      applyTask = task;
      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, currentGeneration, 350);
      } else if (task.status !== "success") {
        error = normalizeError(task.error ?? "Merge 执行失败", "Merge 执行失败");
      }
    } catch (caught) {
      if (currentGeneration === generation) error = normalizeError(caught, "无法读取 Merge 任务状态");
    }
  }

  async function closeWindow() {
    if (applyRunning || releasing) return;
    releasing = true;
    try {
      await releaseMergePreview(previewId);
    } catch {
      // Closing the window is still safe when stale preview cleanup fails.
    }
    await getCurrentWindow().close();
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function normalizeError(caught: unknown, message: string): CommandError {
    if (typeof caught === "object" && caught !== null && "code" in caught && "message" in caught) {
      return caught as CommandError;
    }
    return {
      code: "MERGE_PREVIEW_FAILED",
      message,
      detail: caught instanceof Error ? caught.message : String(caught || message),
      recoverable: true,
    };
  }

  function statusLabel(file: MergePreviewFile) {
    if (file.conflicted) return "冲突";
    if (file.action === "A") return "新增";
    if (file.action === "D") return "删除";
    return file.property_only ? "属性" : "修改";
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<main class="merge-preview" data-theme={resolvedTheme} aria-label="NovaSVN Merge Preview">
  <header class="titlebar">
    <div class="heading">
      <GitMerge size={20} aria-hidden="true" />
      <div>
        <h1>Merge Preview</h1>
        <p title={session?.source_url}>{session?.source_url ?? previewId}</p>
      </div>
    </div>
    <div class="title-actions">
      {#if session}<span>r{session.revision_range} · {session.files.length} 个文件</span>{/if}
      <button type="button" class="primary" disabled={!session || applyRunning || applyTask?.status === "success"} on:click={applyMerge}>
        {#if applyRunning}<LoaderCircle class="spinning" size={15} aria-hidden="true" />{:else}<Play size={15} aria-hidden="true" />{/if}
        {applyRunning ? "正在应用" : applyTask?.status === "success" ? "已应用" : "应用 Merge"}
      </button>
      <button type="button" class="icon-button" aria-label="关闭 Merge Preview" title="关闭" disabled={applyRunning} on:click={closeWindow}>
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  </header>

  <div class="notices"><ErrorNotice {error} /><ErrorNotice error={fileError} /></div>

  {#if loading}
    <div class="loading-state" role="status"><LoaderCircle class="spinning" size={22} /> 正在读取 Merge 预览...</div>
  {:else if session}
    <div class="preview-layout">
      <aside class="file-pane">
        <header>
          <strong>影响文件</strong>
          <span>{selectedIndex >= 0 ? selectedIndex + 1 : 0} / {session.files.length}</span>
        </header>
        <div class="file-list">
          {#each session.files as file (file.path)}
            <button type="button" class:active={file.path === selectedPath} class:conflicted={file.conflicted} on:click={() => loadFile(file.path)}>
              <span class="status" data-action={file.action}>{statusLabel(file)}</span>
              <span class="path" title={file.path}>{file.path}</span>
              <small>{formatBytes(Math.max(file.original_bytes, file.modified_bytes))}</small>
            </button>
          {:else}
            <div class="empty">没有文件内容变化</div>
          {/each}
        </div>
      </aside>

      <section class="diff-pane">
        <header>
          <div>
            <strong title={selectedPath ?? undefined}>{selectedPath ?? "没有选择文件"}</strong>
            {#if selectedFile}<span>{statusLabel(selectedFile)}</span>{/if}
          </div>
          <div class="file-navigation" role="toolbar" aria-label="Merge 文件导航">
            <span>{selectedIndex >= 0 ? selectedIndex + 1 : 0} / {session.files.length}</span>
            <button type="button" class="icon-button" aria-label="上一个 Merge 文件" title="上一个文件" disabled={session.files.length === 0 || fileLoading} on:click={() => moveFile(-1)}><ChevronLeft size={16} /></button>
            <button type="button" class="icon-button" aria-label="下一个 Merge 文件" title="下一个文件" disabled={session.files.length === 0 || fileLoading} on:click={() => moveFile(1)}><ChevronRight size={16} /></button>
          </div>
        </header>
        {#if fileLoading}
          <div class="loading-state" role="status"><LoaderCircle class="spinning" size={20} /> 正在读取文件...</div>
        {:else if selectedFile?.binary || selectedFile?.too_large || selectedFile?.property_only}
          <div class="unsupported-state">
            <FileWarning size={30} aria-hidden="true" />
            <strong>{selectedFile.binary ? "二进制文件不支持文本 Diff" : selectedFile.too_large ? "文件超过文本预览大小限制" : "仅包含 SVN 属性变化"}</strong>
            <span>Merge 状态：{statusLabel(selectedFile)}</span>
          </div>
        {:else if contentDiff}
          <MonacoDiffViewer {contentDiff} inlineMode={diffMode === "inline"} {showWhitespace} theme={resolvedTheme} />
        {:else}
          <div class="loading-state">没有可显示的文件差异</div>
        {/if}
      </section>
    </div>
  {/if}

  {#if applyTask}
    <footer class="apply-result" class:success={applyTask.status === "success"} class:failed={applyTask.status === "failed"}>
      {#if applyTask.status === "success"}<CircleCheck size={17} aria-hidden="true" />{/if}
      <strong>{applyTask.title}</strong>
      <span>{applyTask.status}</span>
      {#if applyResult}<span>{applyResult.file_count} 文件 · {applyResult.conflicted} 冲突</span>{/if}
    </footer>
  {/if}
</main>

<style>
  .merge-preview { --background:#f5f6f7; --panel:#fff; --subtle:#f0f2f4; --text:#17202a; --secondary:#66727e; --border:#ccd3da; --accent:#2674b9; display:grid; grid-template-rows:auto auto minmax(0,1fr) auto; position:fixed; inset:0; overflow:hidden; background:var(--background); color:var(--text); }
  .merge-preview[data-theme="dark"] { --background:#1f1f21; --panel:#29292b; --subtle:#242426; --text:#f2f2f4; --secondary:#aaaab0; --border:#505054; --accent:#55a7ef; color-scheme:dark; }
  .titlebar,.title-actions,.heading,.file-navigation,.diff-pane>header,.apply-result { display:flex; align-items:center; }
  .titlebar { justify-content:space-between; gap:16px; border-bottom:1px solid var(--border); background:var(--panel); padding:10px 12px; }
  .heading,.title-actions { gap:10px; min-width:0; }
  .heading>div { min-width:0; }
  h1,p { margin:0; }
  h1 { font-size:17px; }
  p { overflow:hidden; margin-top:2px; color:var(--secondary); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
  button { min-height:30px; border:1px solid var(--border); border-radius:5px; background:var(--panel); color:var(--text); cursor:pointer; }
  button:disabled { cursor:default; opacity:.5; }
  button.primary { display:flex; align-items:center; gap:6px; border-color:var(--accent); background:var(--accent); padding:0 10px; color:#fff; }
  .icon-button { display:grid; width:30px; min-width:30px; padding:0; place-items:center; }
  .title-actions>span,.file-navigation>span { color:var(--secondary); font-size:11px; white-space:nowrap; }
  .notices:empty { display:none; }
  .preview-layout { display:grid; grid-template-columns:minmax(240px,320px) minmax(0,1fr); min-width:0; min-height:0; overflow:hidden; }
  .file-pane { display:grid; grid-template-rows:auto minmax(0,1fr); min-width:0; min-height:0; border-right:1px solid var(--border); background:var(--panel); }
  .file-pane>header { display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding:9px 10px; font-size:12px; }
  .file-pane>header span { color:var(--secondary); }
  .file-list { min-height:0; overflow:auto; }
  .file-list>button { display:grid; grid-template-columns:44px minmax(0,1fr) auto; align-items:center; gap:7px; width:100%; min-height:38px; border:0; border-bottom:1px solid var(--border); border-radius:0; padding:4px 8px; text-align:left; }
  .file-list>button:hover,.file-list>button.active { background:color-mix(in srgb,var(--accent) 10%,var(--panel)); }
  .file-list>button.active { box-shadow:inset 3px 0 var(--accent); }
  .file-list>button.conflicted { box-shadow:inset 3px 0 #c44343; }
  .status { font-size:10px; font-weight:700; }
  .status[data-action="A"] { color:#16834f; } .status[data-action="D"],.status[data-action="C"] { color:#bd3d3d; }
  .path { overflow:hidden; font-family:Consolas,monospace; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
  small { color:var(--secondary); font-size:9px; white-space:nowrap; }
  .diff-pane { display:grid; grid-template-rows:auto minmax(0,1fr); min-width:0; min-height:0; overflow:hidden; background:var(--panel); }
  .diff-pane>header { justify-content:space-between; gap:12px; min-width:0; border-bottom:1px solid var(--border); padding:6px 8px 6px 12px; }
  .diff-pane>header>div:first-child { display:flex; min-width:0; gap:8px; }
  .diff-pane>header strong { overflow:hidden; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
  .diff-pane>header span { color:var(--secondary); font-size:11px; }
  .file-navigation { gap:4px; }
  .file-navigation>span { margin-right:3px; }
  .loading-state,.unsupported-state,.empty { display:flex; align-items:center; justify-content:center; gap:8px; min-height:0; color:var(--secondary); }
  .unsupported-state { flex-direction:column; }
  .unsupported-state strong { color:var(--text); }
  .empty { padding:24px; }
  .apply-result { gap:10px; border-top:1px solid var(--border); background:var(--subtle); padding:8px 12px; font-size:11px; }
  .apply-result.success { color:#16834f; } .apply-result.failed { color:#bd3d3d; }
  .apply-result span:last-child { margin-left:auto; }
  :global(.spinning) { animation:spin 900ms linear infinite; } @keyframes spin { to { transform:rotate(360deg); } }
  @media (max-width:720px) { .preview-layout { grid-template-columns:minmax(180px,38vw) minmax(0,1fr); } .title-actions>span { display:none; } }
</style>
