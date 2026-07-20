<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { CheckSquare, RefreshCw, Square } from "@lucide/svelte";
  import {
    cancelTask,
    createCommitTask,
    getTask,
    inspectUpdateTarget,
    scanWorkspaceStatus,
  } from "../lib/api";
  import type {
    ChangedFile,
    CommandError,
    Task,
    TaskStatus,
    UpdateTargetSummary,
    WorkingCopyStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";

  const commitSettingsKey = "novasvn:commit-message-settings";
  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  let target: UpdateTargetSummary | null = null;
  let status: WorkingCopyStatus | null = null;
  let commitTask: Task | null = null;
  let selectedPaths = new Set<string>();
  let history: string[] = [];
  let commitTemplate = "";
  let commitMessage = "";
  let selectedHistoryMessage = "";
  let initializing = true;
  let scanning = false;
  let error: CommandError | null = null;
  let statusError: CommandError | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let recordedTaskId: string | null = null;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: committableFiles = (status?.files ?? []).filter(
    (file) => isCommittable(file) && isPathInCommitTarget(file.path),
  );
  $: selectedCount = committableFiles.filter((file) => selectedPaths.has(file.path)).length;
  $: commitRunning = isTaskRunning(commitTask);
  $: taskStatus = taskStatusLabel(commitTask, initializing);
  $: allSelected = committableFiles.length > 0 && selectedCount === committableFiles.length;
  $: commitDisabled =
    initializing ||
    scanning ||
    commitRunning ||
    !commitMessage.trim() ||
    selectedCount === 0 ||
    !target;

  onMount(() => {
    loadCommitSettings();
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    void startCommit();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  function loadCommitSettings() {
    try {
      const raw = window.localStorage.getItem(commitSettingsKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { template?: unknown; history?: unknown };
      commitTemplate = typeof parsed.template === "string" ? parsed.template : "";
      history = Array.isArray(parsed.history)
        ? parsed.history.filter((item): item is string => typeof item === "string").slice(0, 8)
        : [];
      commitMessage = commitTemplate;
    } catch {
      history = [];
      commitTemplate = "";
    }
  }

  function saveCommitSettings(nextHistory: string[]) {
    try {
      window.localStorage.setItem(
        commitSettingsKey,
        JSON.stringify({ template: commitTemplate, history: nextHistory }),
      );
    } catch {
      // 本地历史写入失败不应阻断提交结果。
    }
  }

  function recordCommitHistory(message: string) {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    history = [normalized, ...history.filter((item) => item !== normalized)].slice(0, 8);
    saveCommitSettings(history);
  }

  async function startCommit() {
    const currentGeneration = ++generation;
    clearPollTimer();
    initializing = true;
    error = null;
    statusError = null;
    status = null;
    target = null;
    commitTask = null;
    selectedPaths = new Set();
    recordedTaskId = null;

    try {
      const path = targetPath.trim();
      if (!path) {
        throw {
          code: "COMMIT_TARGET_MISSING",
          message: "没有可提交的目标",
          detail: "请从 Windows 资源管理器中的 SVN 文件或目录右键打开 NovaSVN Commit。",
          recoverable: false,
        } satisfies CommandError;
      }
      target = await inspectUpdateTarget({
        path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      await refreshStatus(currentGeneration);
    } catch (caught) {
      if (currentGeneration === generation) {
        error = caught as CommandError;
      }
    } finally {
      if (currentGeneration === generation) {
        initializing = false;
      }
    }
  }

  async function refreshStatus(currentGeneration = generation) {
    if (!target) {
      return;
    }
    scanning = true;
    statusError = null;
    try {
      const nextStatus = await scanWorkspaceStatus({
        working_copy_root: target.working_copy_root,
        svn_executable: svnExecutable?.trim() || undefined,
        offset: 0,
        limit: 5000,
        check_remote_updates: false,
      });
      if (currentGeneration !== generation) {
        return;
      }
      status = nextStatus;
      const inScope = nextStatus.files
        .filter((file) => isCommittable(file) && isPathInCommitTarget(file.path))
        .map((file) => file.path);
      selectedPaths = new Set(inScope);
    } catch (caught) {
      if (currentGeneration === generation) {
        statusError = caught as CommandError;
      }
    } finally {
      if (currentGeneration === generation) {
        scanning = false;
      }
    }
  }

  function toggleFile(path: string) {
    const next = new Set(selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    selectedPaths = next;
  }

  function selectAll() {
    selectedPaths = new Set(committableFiles.map((file) => file.path));
  }

  function clearSelection() {
    selectedPaths = new Set();
  }

  function applyHistoryMessage() {
    if (selectedHistoryMessage) {
      commitMessage = selectedHistoryMessage;
    }
  }

  async function submitCommit() {
    if (commitDisabled || !target) {
      return;
    }
    error = null;
    statusError = null;
    try {
      const task = await createCommitTask({
        working_copy_root: target.working_copy_root,
        message: commitMessage.trim(),
        files: committableFiles
          .filter((file) => selectedPaths.has(file.path))
          .map((file) => file.path),
        svn_executable: svnExecutable?.trim() || undefined,
      });
      commitTask = task;
      recordedTaskId = null;
      schedulePoll(task.task_id, generation, 0);
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  async function stopCommit() {
    if (!commitTask || !commitRunning) {
      return;
    }
    try {
      commitTask = await cancelTask(commitTask.task_id);
      if (isTaskRunning(commitTask)) {
        schedulePoll(commitTask.task_id, generation, 200);
      } else {
        clearPollTimer();
      }
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  function schedulePoll(taskId: string, currentGeneration: number, delay: number) {
    clearPollTimer();
    pollTimer = window.setTimeout(() => void pollTask(taskId, currentGeneration), delay);
  }

  async function pollTask(taskId: string, currentGeneration: number) {
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      commitTask = task;
      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, currentGeneration, 350);
        return;
      }
      clearPollTimer();
      if (task.status === "success" && recordedTaskId !== task.task_id) {
        recordedTaskId = task.task_id;
        recordCommitHistory(commitMessage);
        await refreshStatus(currentGeneration);
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        error = caught as CommandError;
      }
    }
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function isTaskRunning(task: Task | null) {
    return task?.status === "pending" || task?.status === "running";
  }

  function taskStatusLabel(task: Task | null, isInitializing: boolean) {
    switch (task?.status) {
      case "pending":
        return "等待执行";
      case "running":
        return "正在提交";
      case "success":
        return "提交完成";
      case "failed":
        return "提交失败";
      case "cancelled":
        return "已取消";
      case "interrupted":
        return "已中断";
      default:
        return isInitializing ? "准备中" : "未提交";
    }
  }

  function isCommittable(file: ChangedFile) {
    return !["normal", "missing", "conflicted", "obstructed", "unversioned", "external"].includes(
      file.status,
    );
  }

  function isPathInCommitTarget(path: string) {
    const relativeTarget = target?.relative_path?.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!relativeTarget) {
      return true;
    }
    const normalizedPath = path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (target?.kind === "dir") {
      return normalizedPath === relativeTarget || normalizedPath.startsWith(`${relativeTarget}/`);
    }
    return normalizedPath === relativeTarget;
  }

  function statusLabel(file: ChangedFile) {
    const labels: Record<string, string> = {
      modified: "修改",
      added: "新增",
      deleted: "删除",
      replaced: "替换",
      property_modified: "属性修改",
    };
    return labels[file.status] ?? file.status;
  }

  function logKind(message: string) {
    return /^\s*([ACDMRUG!~])\s+/.exec(message)?.[1] ?? "info";
  }
</script>

<main class="standalone-commit" data-theme={resolvedTheme} aria-label="NovaSVN Commit">
  <header class="commit-titlebar">
    <div>
      <h1>NovaSVN Commit</h1>
      <p title={targetPath}>{target?.target_path ?? targetPath}</p>
    </div>
    <div class="commit-actions">
      <span class:running={commitRunning}>{taskStatus}</span>
      {#if commitRunning}
        <button type="button" on:click={stopCommit}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else}
        <button type="button" disabled={initializing || scanning} on:click={startCommit}>
          <RefreshCw size={15} aria-hidden="true" /> 刷新
        </button>
      {/if}
    </div>
  </header>

  <section class="commit-summary" aria-label="提交摘要">
    <span>目标 <strong>{target?.relative_path ?? "工作副本根目录"}</strong></span>
    <span>Revision <strong>{status?.revision_range ?? target?.revision ?? "-"}</strong></span>
    <span>已选择 <strong>{selectedCount} / {committableFiles.length}</strong></span>
  </section>

  <section
    class="commit-notices"
    class:has-notices={Boolean(error || statusError || commitTask?.error)}
    aria-label="Commit 错误"
  >
    <ErrorNotice {error} />
    <ErrorNotice error={statusError} />
    {#if commitTask?.error}
      <div class="inline-error" role="alert">{commitTask.error}</div>
    {/if}
  </section>

  <div class="commit-layout">
    <section class="file-pane" aria-label="选择提交文件">
      <header>
        <div>
          <h2>提交文件</h2>
          <p>{committableFiles.length} 个可提交文件</p>
        </div>
        <div class="selection-actions">
          <button type="button" on:click={selectAll} disabled={committableFiles.length === 0 || allSelected}>
            <CheckSquare size={15} aria-hidden="true" /> 全选
          </button>
          <button type="button" on:click={clearSelection} disabled={selectedCount === 0}>
            清除
          </button>
        </div>
      </header>
      <div class="file-list">
        {#each committableFiles as file (file.path)}
          <label class="file-item">
            <input
              type="checkbox"
              aria-label={file.path}
              checked={selectedPaths.has(file.path)}
              on:change={() => toggleFile(file.path)}
              disabled={commitRunning}
            />
            <span class="file-status">{statusLabel(file)}</span>
            <span class="file-path" title={file.path}>{file.path}</span>
          </label>
        {:else}
          {#if scanning || initializing}
            <div class="empty-files" role="status">正在扫描工作副本...</div>
          {:else}
            <div class="empty-files">目标范围内没有可提交的文件</div>
          {/if}
        {/each}
      </div>
    </section>

    <aside class="message-pane" aria-label="提交信息">
      <header>
        <div>
          <h2>提交信息</h2>
          <p>提交前请确认文件选择和日志内容</p>
        </div>
      </header>
      {#if history.length > 0}
        <label class="history-field">
          <span>历史日志</span>
          <select bind:value={selectedHistoryMessage} on:change={applyHistoryMessage} aria-label="最近提交信息">
            <option value="">从历史选择</option>
            {#each history as message}
              <option value={message}>{message}</option>
            {/each}
          </select>
        </label>
      {/if}
      <textarea
        bind:value={commitMessage}
        rows="8"
        placeholder="请输入提交日志"
        aria-label="提交日志"
        disabled={commitRunning}
      ></textarea>
      <button type="button" class="primary" on:click={submitCommit} disabled={commitDisabled}>
        提交 {selectedCount} 个文件
      </button>
      {#if commitTask}
        <section class="task-output" aria-label="提交输出">
          <header>
            <h3>任务输出</h3>
            <span>{commitTask.logs.length} 条</span>
          </header>
          <div class="output-lines" role="log" aria-live="polite">
            {#each commitTask.logs as log, index (`${log.created_at}:${index}`)}
              <div class="output-line" data-kind={logKind(log.message)}><code>{log.message}</code></div>
            {:else}
              <div class="empty-output">等待提交输出</div>
            {/each}
          </div>
        </section>
      {/if}
    </aside>
  </div>
</main>

<style>
  .standalone-commit {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f1f3f5;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --control: #ffffff;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
    -webkit-user-select: none;
  }

  .standalone-commit input,
  .standalone-commit textarea,
  .standalone-commit select {
    user-select: text;
    -webkit-user-select: text;
  }

  .standalone-commit[data-theme="dark"] {
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

  .commit-titlebar,
  .commit-summary,
  .commit-notices,
  .commit-layout { min-width: 0; }
  .commit-titlebar { display: flex; justify-content: space-between; gap: 16px; padding: 18px 22px 14px; border-bottom: 1px solid var(--border); background: var(--panel); }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 20px; line-height: 1.2; }
  h2 { font-size: 15px; }
  h3 { font-size: 13px; }
  .commit-titlebar p { margin-top: 6px; color: var(--secondary); font-size: 12px; max-width: 68vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .commit-actions, .selection-actions { display: flex; align-items: center; gap: 8px; }
  .commit-actions > span { color: var(--secondary); font-size: 12px; white-space: nowrap; }
  .commit-actions > span.running { color: var(--accent); }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; border: 1px solid var(--border); border-radius: 4px; padding: 5px 10px; background: var(--control); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { cursor: default; opacity: .55; }
  button.primary { min-height: 36px; border-color: var(--accent); background: var(--accent); color: white; font-weight: 600; }
  .commit-summary { display: flex; flex-wrap: wrap; gap: 20px; padding: 10px 22px; border-bottom: 1px solid var(--border); color: var(--secondary); font-size: 12px; background: var(--panel-subtle); }
  .commit-summary strong { color: var(--text); font-weight: 600; }
  .commit-notices { display: grid; gap: 8px; padding: 0 22px; background: var(--background); }
  .commit-notices.has-notices { padding-top: 10px; }
  .inline-error { border: 1px solid #df8b8b; background: #fff1f1; color: #a12a2a; padding: 8px 10px; font-size: 12px; }
  [data-theme="dark"] .inline-error { background: #3b2424; color: #ffb0b0; }
  .commit-layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, .75fr); gap: 14px; min-height: 0; padding: 14px 22px 20px; }
  .file-pane, .message-pane { min-width: 0; min-height: 0; border: 1px solid var(--border); background: var(--panel); }
  .file-pane { display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .message-pane { display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow: auto; }
  .file-pane > header, .message-pane > header, .task-output > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 13px 14px; border-bottom: 1px solid var(--border); }
  .message-pane > header { padding: 0 0 12px; }
  .file-pane header p, .message-pane header p { margin-top: 4px; color: var(--secondary); font-size: 12px; }
  .file-list { overflow: auto; padding: 6px; }
  .file-item { display: grid; grid-template-columns: 18px 72px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 36px; padding: 5px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); cursor: pointer; font-size: 12px; }
  .file-item:hover { background: var(--panel-subtle); }
  .file-item input { width: 15px; height: 15px; accent-color: var(--accent); }
  .file-status { color: var(--accent); font-weight: 600; }
  .file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-files, .empty-output { padding: 28px 16px; color: var(--secondary); text-align: center; font-size: 12px; }
  .history-field { display: grid; gap: 6px; color: var(--secondary); font-size: 12px; }
  select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; background: var(--control); color: var(--text); font: inherit; font-size: 13px; }
  select { min-height: 32px; padding: 5px 8px; }
  textarea { resize: vertical; min-height: 140px; padding: 9px 10px; line-height: 1.5; }
  textarea:focus, select:focus, button:focus-visible, input:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 1px; }
  .task-output { display: grid; grid-template-rows: auto minmax(80px, 1fr); min-height: 160px; border: 1px solid var(--border); }
  .task-output > header { padding: 9px 10px; }
  .task-output > header span { color: var(--secondary); font-size: 11px; }
  .output-lines { overflow: auto; padding: 6px 10px; }
  .output-line { padding: 3px 0; font-size: 11px; }
  code { font-family: Consolas, "Courier New", monospace; white-space: pre-wrap; word-break: break-word; }
  @media (max-width: 800px) {
    .commit-titlebar { padding: 14px; }
    .commit-summary, .commit-notices { padding-left: 14px; padding-right: 14px; }
    .commit-layout { grid-template-columns: 1fr; padding: 10px 14px 14px; overflow: auto; }
    .file-pane { min-height: 320px; }
  }
</style>
