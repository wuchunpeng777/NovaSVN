<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { BrushCleaning, CircleCheck, LoaderCircle, RotateCw, Square, X } from "@lucide/svelte";
  import {
    cancelTask,
    createSvnOperationTask,
    getTask,
    inspectUpdateTarget,
  } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import type { CommandError, Task, TaskStatus, UpdateTargetSummary } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  let target: UpdateTargetSummary | null = null;
  let cleanupTargetPath = "";
  let task: Task | null = null;
  let initializing = true;
  let cancelling = false;
  let closing = false;
  let error: CommandError | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let cancellationRequestedTaskId: string | null = null;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: taskRunning = task !== null && !terminalStatuses.includes(task.status);
  $: authenticationFailure = detectSvnAuthenticationFailure(
    [error?.code, error?.message, error?.detail, task?.error].filter(Boolean).join("\n"),
  );
  $: authenticationRetry = authenticationFailure ? startCleanup : null;

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("keydown", handleWindowKeydown);
    void startCleanup();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    window.removeEventListener("keydown", handleWindowKeydown);
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
    requestTaskCancellation();
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    requestClose();
  }

  function requestTaskCancellation() {
    const taskId = taskRunning ? task?.task_id : null;
    if (!taskId || cancellationRequestedTaskId === taskId) {
      return;
    }
    cancellationRequestedTaskId = taskId;
    void cancelTask(taskId).catch(() => undefined);
  }

  function requestClose() {
    if (closing) {
      return;
    }
    closing = true;
    generation += 1;
    clearPollTimer();
    requestTaskCancellation();
    void getCurrentWindow().close();
  }

  async function startCleanup() {
    const path = targetPath.trim();
    if (!path) {
      error = commandError(
        "CLEANUP_TARGET_MISSING",
        "没有可清理的目标",
        "请从 Windows 资源管理器中的 SVN 文件或目录右键打开 NovaSVN Clean Up。",
      );
      initializing = false;
      return;
    }

    const currentGeneration = ++generation;
    clearPollTimer();
    initializing = true;
    cancelling = false;
    cancellationRequestedTaskId = null;
    target = null;
    cleanupTargetPath = "";
    task = null;
    error = null;
    try {
      const nextTarget = await inspectUpdateTarget({
        path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      target = nextTarget;
      cleanupTargetPath = nextTarget.kind === "dir"
        ? nextTarget.target_path
        : nextTarget.working_copy_root;
      const created = await createSvnOperationTask({
        working_copy_root: cleanupTargetPath,
        kind: "cleanup",
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        if (!terminalStatuses.includes(created.status)) {
          cancellationRequestedTaskId = created.task_id;
          void cancelTask(created.task_id).catch(() => undefined);
        }
        return;
      }
      task = created;
      schedulePoll(created.task_id, currentGeneration, 0);
    } catch (caught) {
      if (currentGeneration === generation) {
        error = normalizeCommandError(caught);
      }
    } finally {
      if (currentGeneration === generation) {
        initializing = false;
      }
    }
  }

  async function stopCleanup() {
    if (!task || !taskRunning || cancelling) {
      return;
    }
    cancelling = true;
    cancellationRequestedTaskId = task.task_id;
    try {
      task = await cancelTask(task.task_id);
      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(task.task_id, generation, 200);
      } else {
        clearPollTimer();
      }
    } catch (caught) {
      cancellationRequestedTaskId = null;
      error = normalizeCommandError(caught);
    } finally {
      cancelling = false;
    }
  }

  function schedulePoll(taskId: string, currentGeneration: number, delay: number) {
    clearPollTimer();
    pollTimer = window.setTimeout(() => void pollTask(taskId, currentGeneration), delay);
  }

  async function pollTask(taskId: string, currentGeneration: number) {
    try {
      const nextTask = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      task = nextTask;
      if (!terminalStatuses.includes(nextTask.status)) {
        schedulePoll(taskId, currentGeneration, 350);
      } else {
        clearPollTimer();
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        error = normalizeCommandError(caught);
      }
    }
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function taskStatusLabel() {
    if (initializing) return "正在准备";
    if (cancelling) return "正在取消";
    switch (task?.status) {
      case "pending": return "等待执行";
      case "running": return "正在清理";
      case "success": return "清理完成";
      case "failed": return "清理失败";
      case "cancelled": return "已取消";
      case "interrupted": return "已中断";
      default: return "就绪";
    }
  }

  function commandError(code: string, message: string, detail?: string): CommandError {
    return { code, message, detail: detail ?? null, recoverable: true };
  }

  function normalizeCommandError(value: unknown): CommandError {
    if (typeof value === "object" && value !== null && "code" in value && "message" in value) {
      return value as CommandError;
    }
    return commandError(
      "SVN_CLEANUP_FAILED",
      "清理工作副本失败",
      value instanceof Error ? value.message : String(value || "未知错误"),
    );
  }
</script>

<main class="standalone-cleanup" data-theme={resolvedTheme} aria-label="NovaSVN Clean Up">
  <header class="cleanup-titlebar">
    <div class="cleanup-heading">
      <span class="cleanup-mark" aria-hidden="true"><BrushCleaning size={18} /></span>
      <div>
        <h1>NovaSVN Clean Up</h1>
        <p title={targetPath}>{target?.target_path ?? targetPath}</p>
      </div>
    </div>
    <div class="cleanup-actions">
      <span class:running={taskRunning}>{taskStatusLabel()}</span>
      {#if taskRunning}
        <button type="button" disabled={cancelling} on:click={stopCleanup}>
          <Square size={14} fill="currentColor" aria-hidden="true" />
          {cancelling ? "正在取消" : "停止"}
        </button>
      {:else}
        <button type="button" disabled={initializing} on:click={startCleanup}>
          <RotateCw size={15} aria-hidden="true" /> 再次清理
        </button>
      {/if}
      <button
        type="button"
        class="icon-button"
        aria-label="关闭 Clean Up 窗口"
        title="关闭"
        on:click={requestClose}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  </header>

  <section class="cleanup-summary" aria-label="Clean Up 摘要">
    <span>清理目标 <strong title={cleanupTargetPath}>{cleanupTargetPath || "正在检查"}</strong></span>
    <span>工作副本 <strong title={target?.working_copy_root}>{target?.working_copy_root ?? "-"}</strong></span>
    <span>Revision <strong>{target?.revision ? `r${target.revision}` : "-"}</strong></span>
  </section>

  <section class="cleanup-notices" class:has-notices={Boolean(error || task?.error)}>
    <ErrorNotice {error} />
    {#if task?.error}<div class="inline-error" role="alert">{task.error}</div>{/if}
  </section>

  <section class="cleanup-output" aria-label="Clean Up 输出">
    <header>
      <h2>任务输出</h2>
      <span>{task?.logs.length ?? 0} 条</span>
    </header>
    <div class="output-lines" role="log" aria-live="polite">
      {#if initializing && !task}
        <div class="empty-output"><LoaderCircle class="spinning" size={18} />正在检查目标...</div>
      {:else}
        {#each task?.logs ?? [] as log, index (`${log.created_at}:${index}`)}
          <code>{log.message}</code>
        {:else}
          <div class="empty-output">等待 Clean Up 操作</div>
        {/each}
      {/if}
    </div>
  </section>

  <footer>
    <span>Clean Up 会解除工作副本锁并整理 SVN 管理状态</span>
    {#if task?.status === "success"}
      <strong class="success"><CircleCheck size={16} /> 工作副本清理完成</strong>
    {/if}
  </footer>

  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={authenticationRetry}
    onSubmit={onSvnAuthenticationSubmit}
  />
</main>

<style>
  .standalone-cleanup {
    --background: #f5f6f7;
    --panel: #fff;
    --panel-subtle: #f1f3f5;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    font-family: "Segoe UI", sans-serif;
    color-scheme: light;
  }

  .standalone-cleanup[data-theme="dark"] {
    --background: #1f1f21;
    --panel: #29292b;
    --panel-subtle: #242426;
    --text: #f2f2f4;
    --secondary: #aaaab0;
    --border: #505054;
    --accent: #55a7ef;
    color-scheme: dark;
  }

  .cleanup-titlebar,
  .cleanup-heading,
  .cleanup-actions,
  .cleanup-summary,
  footer,
  .success {
    display: flex;
    align-items: center;
  }

  .cleanup-titlebar {
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 11px 15px;
  }

  .cleanup-heading { min-width: 0; gap: 10px; }
  .cleanup-heading > div { min-width: 0; }
  .cleanup-mark { display: grid; width: 30px; height: 30px; flex: 0 0 30px; border-radius: 6px; background: var(--accent); color: #fff; place-items: center; }
  h1, h2, p { margin: 0; }
  h1 { font-size: 18px; line-height: 1.2; }
  h2 { font-size: 13px; }
  .cleanup-heading p { max-width: min(60vw, 780px); overflow: hidden; margin-top: 3px; color: var(--secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .cleanup-actions { gap: 8px; }
  .cleanup-actions > span { color: var(--secondary); font-size: 12px; }
  .cleanup-actions > span.running { color: var(--accent); }
  button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; border: 1px solid var(--border); border-radius: 5px; background: var(--panel); color: var(--text); padding: 0 10px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { cursor: default; opacity: .55; }
  .icon-button { display: grid; width: 30px; padding: 0; place-items: center; }

  .cleanup-summary {
    gap: 18px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel-subtle);
    padding: 9px 15px;
  }
  .cleanup-summary span { min-width: 0; color: var(--secondary); font-size: 12px; }
  .cleanup-summary strong { display: inline-block; max-width: min(36vw, 520px); overflow: hidden; margin-left: 4px; color: var(--text); text-overflow: ellipsis; vertical-align: bottom; white-space: nowrap; }
  .cleanup-notices { min-height: 0; }
  .cleanup-notices:not(.has-notices) { display: none; }
  .inline-error { border-bottom: 1px solid #bd3a3a; background: rgb(189 58 58 / 12%); color: #b52e2e; padding: 9px 15px; font-size: 12px; }
  .cleanup-output { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; margin: 12px; border: 1px solid var(--border); background: var(--panel); }
  .cleanup-output > header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); padding: 9px 11px; }
  .cleanup-output > header span { color: var(--secondary); font-size: 11px; }
  .output-lines { min-height: 0; overflow: auto; padding: 10px; }
  .output-lines code { display: block; min-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 Consolas, monospace; }
  .empty-output { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 180px; color: var(--secondary); font-size: 13px; }
  footer { justify-content: space-between; gap: 16px; border-top: 1px solid var(--border); background: var(--panel); padding: 10px 15px; color: var(--secondary); font-size: 12px; }
  .success { gap: 6px; color: #267a45; }
  :global(.spinning) { animation: cleanup-spin 1s linear infinite; }
  @keyframes cleanup-spin { to { transform: rotate(360deg); } }
  @media (max-width: 720px) {
    .cleanup-summary { align-items: flex-start; flex-direction: column; gap: 5px; }
    .cleanup-summary strong { max-width: 70vw; }
    footer { align-items: flex-start; flex-direction: column; }
  }
</style>
