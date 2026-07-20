<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { FilePenLine, RefreshCw, RotateCw, Square } from "@lucide/svelte";
  import {
    cancelTask,
    createSvnOperationTask,
    getTask,
    inspectUpdateTarget,
    openWorkspaceFile,
    scanWorkspaceStatus,
  } from "../lib/api";
  import type {
    ChangedFile,
    CommandError,
    SvnOperationKind,
    Task,
    TaskStatus,
    UpdateTargetSummary,
    WorkingCopyStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";

  let target: UpdateTargetSummary | null = null;
  let updateTask: Task | null = null;
  let resolutionTask: Task | null = null;
  let resolutionHistory: Task[] = [];
  let resolutionPath: string | null = null;
  let status: WorkingCopyStatus | null = null;
  let conflicts: ChangedFile[] = [];
  let initializing = true;
  let scanning = false;
  let error: CommandError | null = null;
  let statusError: CommandError | null = null;
  let actionError: string | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;

  const terminalStatuses: TaskStatus[] = [
    "success",
    "failed",
    "cancelled",
    "interrupted",
  ];

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: updateRunning = isTaskRunning(updateTask);
  $: resolutionRunning = isTaskRunning(resolutionTask);
  $: updateComplete = updateTask !== null && terminalStatuses.includes(updateTask.status);
  $: updatedFiles = extractUpdatedFiles(updateTask?.logs ?? []);

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    void startUpdate();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  async function startUpdate() {
    const currentGeneration = ++generation;
    clearPollTimer();
    initializing = true;
    error = null;
    statusError = null;
    actionError = null;
    status = null;
    conflicts = [];
    updateTask = null;
    resolutionTask = null;
    resolutionHistory = [];
    resolutionPath = null;

    try {
      const path = targetPath.trim();
      if (!path) {
        throw {
          code: "UPDATE_TARGET_MISSING",
          message: "没有可更新的目标",
          detail: "请从 Windows 资源管理器中的 SVN 文件或目录右键打开 NovaSVN Update。",
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
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind: target.relative_path ? "update_path" : "update",
        file_path: target.relative_path ?? undefined,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      updateTask = task;
      schedulePoll(task.task_id, "update", currentGeneration, 0);
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

  function schedulePoll(
    taskId: string,
    role: "update" | "resolution",
    currentGeneration: number,
    delay: number,
  ) {
    clearPollTimer();
    pollTimer = window.setTimeout(
      () => void pollTask(taskId, role, currentGeneration),
      delay,
    );
  }

  async function pollTask(
    taskId: string,
    role: "update" | "resolution",
    currentGeneration: number,
  ) {
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      if (role === "update") {
        updateTask = task;
      } else {
        resolutionTask = task;
      }

      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, role, currentGeneration, 350);
        return;
      }

      if (role === "resolution") {
        resolutionHistory = [...resolutionHistory, task];
        if (task.status !== "success") {
          actionError = task.error ?? "冲突处理失败";
        }
      }
      await refreshConflicts(currentGeneration);
    } catch (caught) {
      if (currentGeneration === generation) {
        error = caught as CommandError;
      }
    }
  }

  async function refreshConflicts(currentGeneration = generation) {
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
      conflicts = nextStatus.files.filter(
        (file) =>
          (file.status === "conflicted" || file.conflict_kind !== null) &&
          isPathInUpdateTarget(file.path),
      );
      if (!isTaskRunning(resolutionTask)) {
        resolutionPath = null;
      }
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

  async function resolveConflict(file: ChangedFile, kind: SvnOperationKind) {
    if (!target || updateRunning || resolutionRunning) {
      return;
    }
    if (
      kind !== "resolve_working" &&
      !window.confirm(
        `${kind === "resolve_mine_full" ? "采用我的完整版本" : "采用仓库完整版本"}处理冲突吗？\n${file.path}`,
      )
    ) {
      return;
    }

    actionError = null;
    resolutionPath = file.path;
    try {
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind,
        file_path: file.path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      resolutionTask = task;
      schedulePoll(task.task_id, "resolution", generation, 0);
    } catch (caught) {
      const commandError = caught as CommandError;
      actionError = commandError.detail
        ? `${commandError.message}：${commandError.detail}`
        : commandError.message;
      resolutionPath = null;
    }
  }

  async function openConflict(file: ChangedFile) {
    if (!target) {
      return;
    }
    actionError = null;
    try {
      await openWorkspaceFile({
        working_copy_root: target.working_copy_root,
        file_path: file.path,
      });
    } catch (caught) {
      const commandError = caught as CommandError;
      actionError = commandError.detail
        ? `${commandError.message}：${commandError.detail}`
        : commandError.message;
    }
  }

  async function stopUpdate() {
    if (!updateTask || !updateRunning) {
      return;
    }
    try {
      updateTask = await cancelTask(updateTask.task_id);
      if (isTaskRunning(updateTask)) {
        schedulePoll(updateTask.task_id, "update", generation, 200);
      } else {
        clearPollTimer();
        await refreshConflicts();
      }
    } catch (caught) {
      error = caught as CommandError;
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

  function taskStatusLabel(task: Task | null) {
    switch (task?.status) {
      case "pending":
        return "等待执行";
      case "running":
        return "正在更新";
      case "success":
        return "更新完成";
      case "failed":
        return "更新失败";
      case "cancelled":
        return "已取消";
      case "interrupted":
        return "已中断";
      default:
        return initializing ? "准备中" : "未开始";
    }
  }

  function extractUpdatedFiles(logs: Task["logs"]) {
    const files = new Map<string, { action: string; path: string }>();
    for (const log of logs) {
      const match = /^\s*([ACDMRUGER!~])\s+(.+?)\s*$/.exec(log.message);
      if (!match) {
        continue;
      }
      const path = match[2].trim();
      if (path) {
        files.set(path, { action: match[1], path });
      }
    }
    return [...files.values()];
  }

  function conflictKindLabel(file: ChangedFile) {
    switch (file.conflict_kind) {
      case "text":
        return "文本冲突";
      case "property":
        return "属性冲突";
      case "tree":
        return "树冲突";
      default:
        return "冲突";
    }
  }

  function isPathInUpdateTarget(path: string) {
    const relativeTarget = target?.relative_path?.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!relativeTarget) {
      return true;
    }
    const normalizedPath = path.replaceAll("\\", "/");
    return target?.kind === "dir"
      ? normalizedPath === relativeTarget || normalizedPath.startsWith(`${relativeTarget}/`)
      : normalizedPath === relativeTarget;
  }
</script>

<main class="standalone-update" data-theme={resolvedTheme} aria-label="NovaSVN Update">
  <header class="update-titlebar">
    <div>
      <h1>NovaSVN Update</h1>
      <p title={targetPath}>{target?.target_path ?? targetPath}</p>
    </div>
    <div class="update-actions">
      <span class:running={updateRunning}>{taskStatusLabel(updateTask)}</span>
      {#if updateRunning}
        <button type="button" on:click={stopUpdate}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else}
        <button
          type="button"
          disabled={initializing || resolutionRunning || conflicts.length > 0}
          on:click={startUpdate}
        >
          <RotateCw size={15} aria-hidden="true" /> 重新更新
        </button>
      {/if}
    </div>
  </header>

  <section class="update-summary" aria-label="更新摘要">
    <span>目标 <strong>{target?.relative_path ?? "工作副本根目录"}</strong></span>
    <span>Revision <strong>{status?.revision_range ?? target?.revision ?? "-"}</strong></span>
    <span>冲突 <strong class:has-conflicts={conflicts.length > 0}>{conflicts.length}</strong></span>
    <button
      type="button"
      class="icon-button"
      aria-label="刷新冲突状态"
      title="刷新冲突状态"
      disabled={!target || updateRunning || scanning}
      on:click={() => refreshConflicts()}
    >
      <RefreshCw size={16} class={scanning ? "spinning" : undefined} aria-hidden="true" />
    </button>
  </section>

  <section
    class="update-notices"
    class:has-notices={Boolean(error || statusError || updateTask?.error || actionError)}
    aria-label="Update 错误"
  >
    <ErrorNotice {error} />
    <ErrorNotice error={statusError} />
    {#if updateTask?.error}
      <div class="inline-error" role="alert">{updateTask.error}</div>
    {/if}
    {#if actionError}
      <div class="inline-error" role="alert">{actionError}</div>
    {/if}
  </section>

  <div class="update-layout">
    <section class="update-output" aria-label="更新内容" aria-busy={updateRunning}>
      <header>
        <h2>更新内容</h2>
        <span>{updatedFiles.length} 个文件</span>
      </header>
      <div class="output-lines" role="log" aria-live="polite">
        {#if updatedFiles.length > 0}
          {#each updatedFiles as file (file.path)}
            <div class="output-line" data-kind={file.action}>
              <span>{file.action}</span>
              <code title={file.path}>{file.path}</code>
            </div>
          {/each}
        {:else if initializing}
          <div class="empty-output" role="status">正在检查 Update 目标...</div>
        {:else if updateRunning}
          <div class="empty-output" role="status">正在等待更新文件...</div>
        {:else}
          <div class="empty-output">没有更新文件</div>
        {/if}
      </div>
    </section>

    <aside class="conflict-pane" aria-label="冲突处理">
      <header>
        <div>
          <h2>冲突处理</h2>
          <p>{conflicts.length > 0 ? `${conflicts.length} 个路径待处理` : "没有待处理冲突"}</p>
        </div>
      </header>

      <div class="conflict-list">
        {#each conflicts as file (file.path)}
          <article class="conflict-item">
            <header>
              <strong title={file.path}>{file.path}</strong>
              <span>{conflictKindLabel(file)}</span>
            </header>
            <div class="conflict-actions">
              <button
                type="button"
                disabled={resolutionRunning}
                on:click={() => openConflict(file)}
              >
                <FilePenLine size={15} aria-hidden="true" /> 打开
              </button>
              <button
                type="button"
                disabled={resolutionRunning}
                on:click={() => resolveConflict(file, "resolve_working")}
              >
                保留当前内容
              </button>
              <button
                type="button"
                disabled={resolutionRunning}
                on:click={() => resolveConflict(file, "resolve_mine_full")}
              >
                采用我的版本
              </button>
              <button
                type="button"
                disabled={resolutionRunning}
                on:click={() => resolveConflict(file, "resolve_theirs_full")}
              >
                采用仓库版本
              </button>
            </div>
            {#if resolutionPath === file.path && resolutionRunning}
              <p class="resolving" role="status">正在处理...</p>
            {/if}
          </article>
        {/each}

        {#if conflicts.length === 0 && updateComplete && !scanning}
          <div class="conflict-empty">工作副本没有未解决冲突</div>
        {:else if scanning}
          <div class="conflict-empty" role="status">正在检查冲突...</div>
        {/if}
      </div>

      {#if resolutionHistory.length > 0}
        <section class="resolution-history" aria-label="冲突处理记录">
          <h3>处理记录</h3>
          {#each resolutionHistory as task (task.task_id)}
            <div>
              <span data-status={task.status}>{task.status === "success" ? "完成" : "失败"}</span>
              <p>{task.title}</p>
            </div>
          {/each}
        </section>
      {/if}
    </aside>
  </div>
</main>

<style>
  .standalone-update {
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

  .standalone-update[data-theme="dark"] {
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

  .update-titlebar,
  .update-summary,
  .update-actions,
  .update-actions button,
  .conflict-actions button {
    display: flex;
    align-items: center;
  }

  .update-titlebar {
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 10px 14px;
  }

  .update-titlebar > div:first-child {
    min-width: 0;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    font-size: 18px;
  }

  h2 {
    font-size: 13px;
  }

  h3 {
    font-size: 12px;
  }

  .update-titlebar p {
    overflow: hidden;
    margin-top: 2px;
    color: var(--secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .update-actions {
    gap: 8px;
  }

  .update-actions > span {
    color: var(--secondary);
    font-size: 12px;
  }

  .update-actions > span.running {
    color: var(--accent);
  }

  button {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--control);
    color: var(--text);
    padding: 4px 10px;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .update-actions button,
  .conflict-actions button {
    gap: 5px;
  }

  .update-summary {
    gap: 24px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-subtle);
    padding: 8px 14px;
    color: var(--secondary);
    font-size: 12px;
  }

  .update-summary strong {
    margin-left: 4px;
    color: var(--text);
  }

  .update-summary strong.has-conflicts {
    color: #bc3f39;
  }

  .icon-button {
    display: grid;
    width: 30px;
    margin-left: auto;
    padding: 0;
    place-items: center;
  }

  :global(.spinning) {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .update-notices {
    min-height: 0;
  }

  .update-notices.has-notices {
    display: grid;
    gap: 6px;
    padding: 8px 14px 0;
  }

  .update-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    min-height: 0;
  }

  .update-output,
  .conflict-pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--panel);
  }

  .update-output {
    border-right: 1px solid var(--border);
  }

  .update-output > header,
  .conflict-pane > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 42px;
    border-bottom: 1px solid var(--border);
    padding: 8px 12px;
  }

  .update-output > header span,
  .conflict-pane > header p {
    color: var(--secondary);
    font-size: 11px;
  }

  .output-lines,
  .conflict-list {
    min-height: 0;
    overflow: auto;
  }

  .output-lines {
    background: var(--panel-subtle);
    padding: 8px 0 16px;
  }

  .output-line {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 7px;
    min-height: 26px;
    padding: 4px 12px;
  }

  .output-line:hover {
    background: var(--panel);
  }

  .output-line > span {
    color: var(--secondary);
    font-family: Consolas, monospace;
    font-weight: 700;
    text-align: center;
  }

  .output-line[data-kind="U"] > span,
  .output-line[data-kind="G"] > span {
    color: #24783d;
  }

  .output-line[data-kind="A"] > span {
    color: var(--accent);
  }

  .output-line[data-kind="D"] > span,
  .output-line[data-kind="C"] > span {
    color: #bc3f39;
  }

  .output-line code {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: Consolas, "SFMono-Regular", monospace;
    font-size: 12px;
    white-space: pre-wrap;
  }

  .empty-output,
  .conflict-empty {
    display: grid;
    min-height: 160px;
    color: var(--secondary);
    place-items: center;
  }

  .conflict-pane {
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--background);
  }

  .conflict-list {
    padding: 10px;
  }

  .conflict-item {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    padding: 10px;
  }

  .conflict-item + .conflict-item {
    margin-top: 8px;
  }

  .conflict-item > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .conflict-item > header strong {
    min-width: 0;
    overflow: hidden;
    font-family: Consolas, monospace;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-item > header span {
    flex: 0 0 auto;
    color: #bc3f39;
    font-size: 11px;
  }

  .conflict-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin-top: 9px;
  }

  .conflict-actions button {
    justify-content: center;
    min-width: 0;
    font-size: 12px;
  }

  .resolving {
    margin-top: 7px;
    color: var(--accent);
    font-size: 11px;
  }

  .resolution-history {
    border-top: 1px solid var(--border);
    background: var(--panel);
    padding: 9px 12px;
  }

  .resolution-history > div {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 6px;
    margin-top: 5px;
    font-size: 11px;
  }

  .resolution-history span[data-status="success"] {
    color: #24783d;
  }

  .resolution-history span:not([data-status="success"]) {
    color: #bc3f39;
  }

  .resolution-history p {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 1040px) {
    .update-layout {
      grid-template-columns: minmax(0, 1fr) 360px;
    }
  }
</style>
