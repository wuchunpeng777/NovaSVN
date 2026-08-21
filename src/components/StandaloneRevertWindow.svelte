<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { CheckSquare, FilePenLine, RefreshCw, RotateCcw, Square, X } from "@lucide/svelte";
  import {
    cancelTask,
    createSvnBatchOperationTask,
    createSvnOperationTask,
    getTask,
    inspectUpdateTarget,
    launchConflictWindow,
    scanWorkspaceStatus,
  } from "../lib/api";
  import {
    conflictKindLabel,
    conflictReasonDescription,
    conflictResolutionActions,
    isConflictedFile,
    type ConflictResolutionAction,
  } from "../lib/svn-conflict";
  import { svnStatusMark, svnStatusMarkTitle } from "../lib/svn-file-status";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
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

  const REVERT_AUTO_CLOSE_SETTING_KEY = "novasvn:revert-close-after-completion";
  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  let target: UpdateTargetSummary | null = null;
  let status: WorkingCopyStatus | null = null;
  let revertTask: Task | null = null;
  let resolutionTask: Task | null = null;
  let resolutionPath: string | null = null;
  let selectedPaths = new Set<string>();
  let pendingPaths: string[] = [];
  let revertedCount = 0;
  let confirmationOpen = false;
  let confirmationElement: HTMLDivElement | null = null;
  let initializing = true;
  let scanning = false;
  let creatingTask = false;
  let error: CommandError | null = null;
  let statusError: CommandError | null = null;
  let actionError: string | null = null;
  let notice: string | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let closeAfterCompletion = readCloseAfterCompletionSetting();
  let closeCurrentRevertAfterCompletion = false;
  let submittedRevertTaskId: string | null = null;
  let autoCloseTriggered = false;
  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: visibleFiles = (status?.files ?? []).filter(
    (file) => isVisibleFile(file) && isPathInTarget(file.path),
  );
  $: revertableFiles = visibleFiles.filter(isRevertableFile);
  $: conflictFiles = visibleFiles.filter(isConflictedFile);
  $: selectedFiles = revertableFiles.filter((file) => selectedPaths.has(file.path));
  $: allSelected = revertableFiles.length > 0 && selectedFiles.length === revertableFiles.length;
  $: revertRunning = isTaskRunning(revertTask);
  $: resolutionRunning = isTaskRunning(resolutionTask);
  $: operationRunning = revertRunning || resolutionRunning || creatingTask;
  $: authenticationFailure =
    detectSvnAuthenticationFailure(commandErrorText(statusError)) ??
    detectSvnAuthenticationFailure(commandErrorText(error)) ??
    detectSvnAuthenticationFailure(actionError) ??
    detectSvnAuthenticationFailure(revertTask?.error) ??
    detectSvnAuthenticationFailure(resolutionTask?.error);
  $: authenticationRetry = statusError
    ? () => refreshStatus(generation, true)
    : error
      ? startRevertWindow
      : null;

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("keydown", handleWindowKeydown);
    void startRevertWindow();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    window.removeEventListener("keydown", handleWindowKeydown);
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  async function startRevertWindow() {
    const currentGeneration = ++generation;
    clearPollTimer();
    initializing = true;
    scanning = false;
    target = null;
    status = null;
    revertTask = null;
    resolutionTask = null;
    resolutionPath = null;
    selectedPaths = new Set();
    pendingPaths = [];
    revertedCount = 0;
    confirmationOpen = false;
    error = null;
    statusError = null;
    actionError = null;
    notice = null;
    submittedRevertTaskId = null;
    autoCloseTriggered = false;

    try {
      const path = targetPath.trim();
      if (!path) {
        throw {
          code: "REVERT_TARGET_MISSING",
          message: "没有可 Revert 的目标",
          detail: "请从 Windows 资源管理器中的 SVN 文件或目录右键打开 NovaSVN Revert。",
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

  async function refreshStatus(currentGeneration = generation, preserveSelection = false) {
    if (!target) {
      return;
    }
    scanning = true;
    statusError = null;
    try {
      const nextStatus = await scanWorkspaceStatus({
        working_copy_root: target.working_copy_root,
        scope_path: target.relative_path ?? undefined,
        include_content_digests: false,
        include_revision_summary: false,
        include_unversioned: false,
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
        .filter((file) => isRevertableFile(file) && isPathInTarget(file.path))
        .map((file) => file.path);
      selectedPaths = preserveSelection
        ? new Set(inScope.filter((path) => selectedPaths.has(path)))
        : new Set(inScope);
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

  function togglePath(path: string) {
    const next = new Set(selectedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    selectedPaths = next;
  }

  function selectAll() {
    selectedPaths = new Set(revertableFiles.map((file) => file.path));
  }

  function clearSelection() {
    selectedPaths = new Set();
  }

  async function requestRevert() {
    if (initializing || scanning || operationRunning || selectedFiles.length === 0) {
      return;
    }
    pendingPaths = selectedFiles.map((file) => file.path);
    confirmationOpen = true;
    await tick();
    confirmationElement?.focus();
  }

  function cancelConfirmation() {
    if (!creatingTask) {
      confirmationOpen = false;
      pendingPaths = [];
    }
  }

  async function confirmRevert() {
    if (!target || pendingPaths.length === 0 || operationRunning) {
      return;
    }
    const paths = [...pendingPaths];
    confirmationOpen = false;
    creatingTask = true;
    error = null;
    statusError = null;
    notice = null;
    closeCurrentRevertAfterCompletion = closeAfterCompletion;
    submittedRevertTaskId = null;
    try {
      const task = await createSvnBatchOperationTask({
        working_copy_root: target.working_copy_root,
        kind: "revert_paths",
        file_paths: paths,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      revertTask = task;
      submittedRevertTaskId = task.task_id;
      revertedCount = paths.length;
      autoCloseTriggered = false;
      schedulePoll(task.task_id, "revert", generation, 0);
    } catch (caught) {
      closeCurrentRevertAfterCompletion = false;
      error = caught as CommandError;
    } finally {
      creatingTask = false;
      pendingPaths = [];
    }
  }

  async function stopRevert() {
    if (!revertTask || !revertRunning) {
      return;
    }
    try {
      revertTask = await cancelTask(revertTask.task_id);
      if (isTaskRunning(revertTask)) {
        schedulePoll(revertTask.task_id, "revert", generation, 200);
      } else {
        clearPollTimer();
      }
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  async function runConflictAction(file: ChangedFile, action: ConflictResolutionAction) {
    if (!target || operationRunning || scanning || initializing) {
      return;
    }
    if (action.kind === "edit") {
      actionError = null;
      try {
        const root = target.working_copy_root.replace(/[\\/]+$/, "");
        const relativePath = file.path.replaceAll("/", "\\").replace(/^[\\/]+/, "");
        await launchConflictWindow({ target_path: `${root}\\${relativePath}` });
      } catch (caught) {
        const commandError = caught as CommandError;
        actionError = commandError.detail
          ? `${commandError.message}：${commandError.detail}`
          : commandError.message;
      }
      return;
    }
    if (action.confirm && !window.confirm(`${action.description}？\n${file.path}`)) {
      return;
    }

    actionError = null;
    resolutionPath = file.path;
    try {
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind: action.kind as SvnOperationKind,
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

  function schedulePoll(
    taskId: string,
    role: "revert" | "resolution",
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
    role: "revert" | "resolution",
    currentGeneration: number,
  ) {
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      if (role === "revert") {
        revertTask = task;
      } else {
        resolutionTask = task;
      }
      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, role, currentGeneration, 350);
        return;
      }
      clearPollTimer();
      if (task.status === "success") {
        if (role === "revert") {
          notice = `已 Revert ${revertedCount} 个项目`;
        } else {
          notice = resolutionPath
            ? `已解决冲突：${resolutionPath}`
            : "冲突已解决";
          resolutionPath = null;
        }
        await refreshStatus(currentGeneration, true);
        if (role === "revert") {
          await maybeCloseCompletedRevert();
        }
      } else if (role === "resolution") {
        resolutionPath = null;
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        error = caught as CommandError;
        if (role === "resolution") {
          resolutionPath = null;
        }
      }
    }
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    if (confirmationOpen) {
      event.preventDefault();
      cancelConfirmation();
    } else if (!operationRunning) {
      event.preventDefault();
      void getCurrentWindow().close();
    }
  }

  function isTaskRunning(task: Task | null) {
    return task?.status === "pending" || task?.status === "running";
  }

  function isVisibleFile(file: ChangedFile) {
    return isRevertableFile(file) || isConflictedFile(file);
  }

  function isRevertableFile(file: ChangedFile) {
    if (["unversioned", "external", "ignored"].includes(file.status)) {
      return false;
    }
    // Tree conflicts often keep a normal item status; still allow Revert to clear them.
    if (isConflictedFile(file)) {
      return true;
    }
    if (file.status === "obstructed") {
      return false;
    }
    return file.property_changed || !["normal", "none"].includes(file.status);
  }

  function isPathInTarget(path: string) {
    const relativeTarget = target?.relative_path?.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!relativeTarget) {
      return true;
    }
    const normalizedPath = path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    return target?.kind === "dir"
      ? normalizedPath === relativeTarget || normalizedPath.startsWith(`${relativeTarget}/`)
      : normalizedPath === relativeTarget;
  }

  function taskStatusLabel() {
    if (creatingTask) return "正在准备 Revert";
    switch (revertTask?.status) {
      case "pending": return "等待执行";
      case "running": return "正在 Revert";
      case "success": return "Revert 完成";
      case "failed": return "Revert 失败";
      case "cancelled": return "已取消";
      case "interrupted": return "已中断";
      default: return initializing || scanning ? "正在扫描" : "就绪";
    }
  }

  function commandErrorText(value: CommandError | null) {
    return value ? [value.code, value.message, value.detail].filter(Boolean).join("\n") : null;
  }

  async function maybeCloseCompletedRevert() {
    if (
      !closeCurrentRevertAfterCompletion ||
      autoCloseTriggered ||
      revertTask?.status !== "success" ||
      submittedRevertTaskId !== revertTask.task_id ||
      !notice ||
      scanning ||
      statusError !== null
    ) {
      return;
    }
    autoCloseTriggered = true;
    try {
      await getCurrentWindow().close();
    } catch (caught) {
      autoCloseTriggered = false;
      error = caught as CommandError;
    }
  }

  function handleCloseAfterCompletionChange(event: Event) {
    closeAfterCompletion = (event.currentTarget as HTMLInputElement).checked;
    writeCloseAfterCompletionSetting(closeAfterCompletion);
    if (revertTask?.status !== "success") {
      closeCurrentRevertAfterCompletion = closeAfterCompletion;
    }
  }

  function readCloseAfterCompletionSetting() {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(REVERT_AUTO_CLOSE_SETTING_KEY) === "true";
    } catch {
      return false;
    }
  }

  function writeCloseAfterCompletionSetting(value: boolean) {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(REVERT_AUTO_CLOSE_SETTING_KEY, String(value));
    } catch {
      // 偏好持久化失败不能影响 Revert
    }
  }
</script>

<main class="standalone-revert" data-theme={resolvedTheme} aria-label="NovaSVN Revert">
  <header class="revert-titlebar">
    <div>
      <h1>NovaSVN Revert</h1>
      <p title={targetPath}>{target?.target_path ?? targetPath}</p>
    </div>
    <div class="title-actions">
      <span class:running={operationRunning}>{taskStatusLabel()}</span>
      {#if revertRunning}
        <button type="button" on:click={stopRevert}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else}
        <button
          type="button"
          disabled={initializing || scanning || operationRunning}
          on:click={() => refreshStatus(generation, true)}
        >
          <RefreshCw size={15} aria-hidden="true" /> 刷新
        </button>
      {/if}
    </div>
  </header>

  <section class="revert-summary" aria-label="Revert 摘要">
    <span>目标 <strong>{target?.relative_path ?? "工作副本根目录"}</strong></span>
    <span>Revision <strong>{status?.revision_range ?? target?.revision ?? "-"}</strong></span>
    <span>已选择 <strong>{selectedFiles.length} / {revertableFiles.length}</strong></span>
  </section>

  <section
    class="revert-notices"
    class:has-notices={Boolean(error || statusError || actionError || revertTask?.error || resolutionTask?.error || notice)}
  >
    <ErrorNotice {error} />
    <ErrorNotice error={statusError} />
    {#if actionError}<div class="inline-error" role="alert">{actionError}</div>{/if}
    {#if revertTask?.error}<div class="inline-error" role="alert">{revertTask.error}</div>{/if}
    {#if resolutionTask?.error}<div class="inline-error" role="alert">{resolutionTask.error}</div>{/if}
    {#if notice}<div class="success-notice" role="status">{notice}</div>{/if}
  </section>

  <section class="revert-files" aria-label="选择 Revert 项目">
    <header>
      <div>
        <h2>本地修改</h2>
        <p>
          {revertableFiles.length} 个可 Revert 项目{conflictFiles.length > 0
            ? ` · ${conflictFiles.length} 个冲突（含树冲突）`
            : ""}
        </p>
      </div>
      <div class="selection-actions">
        <button type="button" on:click={selectAll} disabled={operationRunning || allSelected || revertableFiles.length === 0}>
          <CheckSquare size={15} aria-hidden="true" /> 全选
        </button>
        <button type="button" on:click={clearSelection} disabled={operationRunning || selectedFiles.length === 0}>清除</button>
      </div>
    </header>
    <div class="file-list">
      {#each visibleFiles as file (file.path)}
        {@const conflicted = isConflictedFile(file)}
        {@const reason = conflicted ? conflictReasonDescription(file) : null}
        {@const actions = conflicted ? conflictResolutionActions(file) : []}
        <div
          class="file-row"
          class:running={pendingPaths.includes(file.path) || resolutionPath === file.path}
          class:conflicted
        >
          <label class="file-main">
            {#if isRevertableFile(file)}
              <input
                type="checkbox"
                aria-label={file.path}
                checked={selectedPaths.has(file.path)}
                disabled={operationRunning || scanning || initializing}
                on:change={() => togglePath(file.path)}
              />
            {:else}
              <span class="file-selection-placeholder" aria-hidden="true"></span>
            {/if}
            <span
              class="file-status"
              data-action={svnStatusMark(file)}
              title={svnStatusMarkTitle(file)}
            >{svnStatusMark(file)}</span>
            <span class="file-path" title={file.path}>{file.path}</span>
            {#if conflicted}
              <span class="file-conflict-kind" title={conflictKindLabel(file) ?? "冲突"}>
                {conflictKindLabel(file) ?? "冲突"}
              </span>
            {/if}
          </label>
          {#if conflicted}
            {#if reason}
              <p class="conflict-reason" title={reason}>{reason}</p>
            {/if}
            <div class="conflict-actions" role="group" aria-label={`冲突操作 ${file.path}`}>
              {#each actions as action (action.kind + action.label)}
                <button
                  type="button"
                  aria-label={`${action.label} ${file.path}`}
                  title={action.description}
                  disabled={operationRunning || scanning || initializing}
                  on:click={() => runConflictAction(file, action)}
                >
                  {#if action.kind === "edit"}
                    <FilePenLine size={14} aria-hidden="true" />
                  {/if}
                  {action.label}
                </button>
              {/each}
            </div>
            {#if resolutionPath === file.path && resolutionRunning}
              <p class="resolving" role="status">正在处理冲突...</p>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="empty-files" role="status">
          {initializing || scanning ? "正在扫描工作副本..." : "目标范围内没有可 Revert 的本地修改或冲突"}
        </div>
      {/each}
    </div>
  </section>

  <section class="task-output" aria-label="Revert 输出">
    <header>
      <h2>任务输出</h2>
      <span>{revertTask?.logs.length ?? 0} 条</span>
    </header>
    <div class="output-lines" role="log" aria-live="polite">
      {#each revertTask?.logs ?? [] as log, index (`${log.created_at}:${index}`)}
        <code>{log.message}</code>
      {:else}
        <div>等待 Revert 操作</div>
      {/each}
    </div>
  </section>

  <footer>
    <label>
      <input
        type="checkbox"
        checked={closeAfterCompletion}
        disabled={autoCloseTriggered}
        on:change={handleCloseAfterCompletionChange}
      />
      <span>Revert 完成后自动关闭</span>
    </label>
    <span>Revert 会永久丢弃所选项目的本地修改</span>
    <button
      type="button"
      class="danger-primary"
      disabled={initializing || scanning || operationRunning || selectedFiles.length === 0}
      on:click={requestRevert}
    >
      <RotateCcw size={16} aria-hidden="true" /> Revert {selectedFiles.length} 个项目
    </button>
  </footer>

  {#if confirmationOpen}
    <div class="dialog-backdrop" role="presentation" on:click|self={cancelConfirmation}>
      <div
        bind:this={confirmationElement}
        class="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revert-confirmation-title"
        tabindex="-1"
      >
        <header>
          <div>
            <h2 id="revert-confirmation-title">确认 Revert</h2>
            <p>所选 {pendingPaths.length} 个项目的本地修改将被永久丢弃。</p>
          </div>
          <button type="button" class="icon-button" aria-label="关闭 Revert 确认" title="关闭" on:click={cancelConfirmation}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div class="confirmation-paths" aria-label="将 Revert 的项目">
          {#each pendingPaths as path (path)}<code title={path}>{path}</code>{/each}
        </div>
        <footer>
          <button type="button" on:click={cancelConfirmation}>取消</button>
          <button type="button" class="danger-primary" on:click={confirmRevert}>
            <RotateCcw size={15} aria-hidden="true" /> 确认 Revert
          </button>
        </footer>
      </div>
    </div>
  {/if}

  <SvnAuthenticationDialog
    failure={authenticationFailure}
    localPath={target?.working_copy_root ?? targetPath}
    repositoryUrl={target?.repository_url ?? ""}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={authenticationRetry}
    onSubmit={onSvnAuthenticationSubmit}
  />
</main>

<style>
  .standalone-revert {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f1f3f5;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --control: #ffffff;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto auto minmax(180px, 1fr) minmax(120px, 30vh) auto;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
  }
  .standalone-revert[data-theme="dark"] {
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
  h1, h2, p { margin: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 14px; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; border: 1px solid var(--border); border-radius: 4px; padding: 5px 10px; background: var(--control); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; }
  button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  button:disabled { cursor: default; opacity: .55; }
  button:focus-visible, input:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 1px; }
  .revert-titlebar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 22px 14px; border-bottom: 1px solid var(--border); background: var(--panel); }
  .revert-titlebar p { max-width: 68vw; margin-top: 6px; overflow: hidden; color: var(--secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .title-actions, .selection-actions { display: flex; align-items: center; gap: 8px; }
  .title-actions > span { color: var(--secondary); font-size: 12px; white-space: nowrap; }
  .title-actions > span.running { color: var(--accent); }
  .revert-summary { display: flex; flex-wrap: wrap; gap: 20px; padding: 10px 22px; border-bottom: 1px solid var(--border); background: var(--panel-subtle); color: var(--secondary); font-size: 12px; }
  .revert-summary strong { color: var(--text); }
  .revert-notices { display: grid; gap: 8px; padding: 0 22px; }
  .revert-notices.has-notices { padding-top: 10px; }
  .inline-error, .success-notice { border: 1px solid #df8b8b; background: #fff1f1; color: #a12a2a; padding: 8px 10px; font-size: 12px; }
  .success-notice { border-color: #91bf9a; background: #eff9f1; color: #276b35; }
  [data-theme="dark"] .inline-error { background: #3b2424; color: #ffb0b0; }
  [data-theme="dark"] .success-notice { background: #213629; color: #9de3aa; }
  .revert-files, .task-output { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; margin: 12px 22px 0; border: 1px solid var(--border); background: var(--panel); }
  .task-output { margin-top: 10px; }
  .revert-files > header, .task-output > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
  .revert-files > header p { margin-top: 4px; color: var(--secondary); font-size: 12px; }
  .task-output > header span { color: var(--secondary); font-size: 11px; }
  .file-list, .output-lines { min-height: 0; overflow: auto; padding: 6px; }
  .file-row { display: grid; gap: 6px; padding: 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); font-size: 12px; }
  .file-row:hover { background: var(--panel-subtle); }
  .file-row.running { background: color-mix(in srgb, #b93d3d 8%, var(--panel)); }
  .file-row.conflicted { background: color-mix(in srgb, #c64040 8%, var(--panel)); }
  .file-main { display: grid; grid-template-columns: 18px 22px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 28px; }
  .file-list input { width: 15px; height: 15px; accent-color: var(--accent); }
  .file-selection-placeholder { width: 15px; height: 15px; }
  .file-status {
    display: inline-grid;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    font-family: Consolas, "Courier New", monospace;
  }
  .file-status[data-action="A"] { background: #dff2e4; color: #24733a; }
  .file-status[data-action="M"] { background: #fff0c7; color: #805900; }
  .file-status[data-action="D"] { background: #fbe0df; color: #a12f2b; }
  .file-status[data-action="R"] { background: #e4e9ff; color: #3b4db8; }
  .file-status[data-action="C"] { background: #fbe0df; color: #a12f2b; }
  .file-status[data-action="!"],
  .file-status[data-action="~"] { background: #fff0c7; color: #805900; }
  .standalone-revert[data-theme="dark"] .file-status[data-action="A"] { background: #1f4b2d; color: #8fdaa2; }
  .standalone-revert[data-theme="dark"] .file-status[data-action="M"] { background: #4b3b16; color: #f6cf73; }
  .standalone-revert[data-theme="dark"] .file-status[data-action="D"],
  .standalone-revert[data-theme="dark"] .file-status[data-action="C"] { background: #522725; color: #ffaaa7; }
  .standalone-revert[data-theme="dark"] .file-status[data-action="R"] { background: #2a3358; color: #a8b5ff; }
  .standalone-revert[data-theme="dark"] .file-status[data-action="!"],
  .standalone-revert[data-theme="dark"] .file-status[data-action="~"] { background: #4b3b16; color: #f6cf73; }
  .file-conflict-kind { color: #a12a2a; font-size: 11px; white-space: nowrap; }
  .standalone-revert[data-theme="dark"] .file-conflict-kind { color: #ffaaa7; }
  .standalone-revert[data-theme="dark"] .file-row.conflicted { background: color-mix(in srgb, #c64040 14%, var(--panel)); }
  .file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conflict-reason { margin: 0; color: var(--secondary); font-size: 11px; line-height: 1.45; }
  .conflict-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .conflict-actions button { min-height: 27px; padding: 3px 8px; border-color: color-mix(in srgb, #c64040 55%, var(--border)); color: #a12a2a; }
  .standalone-revert[data-theme="dark"] .conflict-actions button { color: #ffaaa7; }
  .resolving { margin: 0; color: var(--accent); font-size: 11px; }
  .empty-files, .output-lines > div { display: grid; min-height: 80px; color: var(--secondary); font-size: 12px; place-items: center; }
  .output-lines { padding: 8px 12px; }
  .output-lines code { display: block; padding: 3px 0; font-size: 11px; }
  code { font-family: Consolas, "Courier New", monospace; white-space: pre-wrap; word-break: break-word; user-select: text; }
  .standalone-revert > footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 22px; border-top: 1px solid var(--border); background: var(--panel); }
  .standalone-revert > footer label { display: inline-flex; align-items: center; gap: 7px; color: var(--secondary); font-size: 12px; cursor: pointer; }
  .standalone-revert > footer label input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
  .standalone-revert > footer span { color: var(--secondary); font-size: 12px; }
  button.danger-primary { border-color: #b93d3d; background: #b93d3d; color: #ffffff; font-weight: 600; }
  button.danger-primary:hover:not(:disabled) { border-color: #9f2f2f; background: #9f2f2f; color: #ffffff; }
  button.icon-button { width: 30px; min-width: 30px; padding: 0; }
  .dialog-backdrop { position: fixed; inset: 0; z-index: 3100; display: grid; overflow: hidden; padding: 24px; background: rgb(10 18 26 / 35%); place-items: center; }
  .confirmation-dialog { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 16px; width: min(560px, 100%); max-height: min(620px, calc(100vh - 48px)); max-height: min(620px, calc(100dvh - 48px)); overflow: hidden; border: 1px solid var(--border); border-radius: 6px; padding: 16px; background: var(--panel); color: var(--text); }
  .confirmation-dialog > header, .confirmation-dialog > footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .confirmation-dialog > header p { margin-top: 5px; color: var(--secondary); font-size: 12px; }
  .confirmation-dialog > footer { justify-content: flex-end; }
  .confirmation-paths { display: grid; min-height: 0; gap: 6px; overflow: auto; overscroll-behavior: contain; }
  .confirmation-paths code { border: 1px solid var(--border); background: var(--panel-subtle); padding: 8px 10px; font-size: 12px; }
</style>
