<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ArrowLeft, CircleCheck, FilePenLine, History, RefreshCw, RotateCw, Square, X } from "@lucide/svelte";
  import {
    cancelTask,
    createSvnOperationTask,
    getSvnLog,
    getTask,
    getWorkspacePathSizes,
    inspectUpdateTarget,
    launchCommitWindow,
    launchConflictWindow,
    scanWorkspaceStatus,
  } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import { extractSvnFileChanges, normalizeSvnOutputPath } from "../lib/svn-operation-output";
  import type {
    ChangedFile,
    CommandError,
    SvnOperationKind,
    SvnLog,
    Task,
    TaskStatus,
    UpdateTargetSummary,
    WorkingCopyStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import OperationMetrics from "./OperationMetrics.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";
  import SvnLogRevisionList from "./SvnLogRevisionList.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let showReturnToMain = false;
  export let onReturnToMain: () => void = () => {};
  export let returnToCommit = false;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  let target: UpdateTargetSummary | null = null;
  let updateTask: Task | null = null;
  let resolutionTask: Task | null = null;
  let resolutionHistory: Task[] = [];
  let resolutionPath: string | null = null;
  let resolutionKind: SvnOperationKind | null = null;
  let resolvedUpdateActions = new Map<string, "L" | "U">();
  let resolvedConflictPaths = new Set<string>();
  let status: WorkingCopyStatus | null = null;
  let conflicts: ChangedFile[] = [];
  let conflictScanCompleted = false;
  let fileContextMenu: { path: string; x: number; y: number } | null = null;
  let fileContextMenuElement: HTMLDivElement | null = null;
  let fileLog: SvnLog | null = null;
  let fileLogPath: string | null = null;
  let fileLogLoading = false;
  let fileLogError: CommandError | null = null;
  let fileLogGeneration = 0;
  let fileLogDialogElement: HTMLDivElement | null = null;
  let expandedFileLogRevisions = new Set<string>();
  let initializing = true;
  let scanning = false;
  let error: CommandError | null = null;
  let statusError: CommandError | null = null;
  let actionError: string | null = null;
  let outputLinesElement: HTMLDivElement | null = null;
  let autoFollowOutput = true;
  let expectedAutoScrollTop: number | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let returningToCommit = false;
  let updatedFileSizes = new Map<string, number>();

  const terminalStatuses: TaskStatus[] = [
    "success",
    "failed",
    "cancelled",
    "interrupted",
  ];

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: statusAuthenticationFailure = detectSvnAuthenticationFailure(
    commandErrorText(statusError),
  );
  $: fileLogAuthenticationFailure = detectSvnAuthenticationFailure(
    commandErrorText(fileLogError),
  );
  $: authenticationFailure =
    statusAuthenticationFailure ??
    fileLogAuthenticationFailure ??
    detectSvnAuthenticationFailure(commandErrorText(error)) ??
    detectSvnAuthenticationFailure(actionError) ??
    detectSvnAuthenticationFailure(updateTask?.error) ??
    detectSvnAuthenticationFailure(resolutionTask?.error);
  $: authenticationRetry = statusAuthenticationFailure
    ? () => refreshConflicts()
    : fileLogAuthenticationFailure && fileLogPath
      ? () => showFileLog(fileLogPath!)
      : null;
  $: updateRunning = isTaskRunning(updateTask);
  $: resolutionRunning = isTaskRunning(resolutionTask);
  $: updateComplete =
    updateTask?.status === "success" && conflictScanCompleted && !scanning;
  $: updatedFiles = applyResolvedUpdateActions(
    extractSvnFileChanges(updateTask?.logs ?? [], target?.working_copy_root),
    resolvedUpdateActions,
  );
  $: updatedBytes = updatedFiles.reduce(
    (total, file) => total + (updatedFileSizes.get(file.path) ?? 0),
    0,
  );
  $: provisionalConflictPaths = updatedFiles
    .filter((file) => file.action.includes("C"))
    .map((file) => file.path)
    .filter(
      (path) =>
        !conflicts.some((file) => file.path === path) &&
        (updateRunning || scanning || statusError !== null),
    );
  $: conflictCount = new Set([
    ...conflicts.map((file) => file.path),
    ...provisionalConflictPaths,
  ]).size;
  $: if (updateComplete) {
    void followUpdateOutput(true);
  }

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("click", closeFileContextMenu);
    window.addEventListener("blur", closeFileContextMenu);
    window.addEventListener("resize", closeFileContextMenu);
    window.addEventListener("keydown", handleWindowKeydown);
    window.addEventListener("focus", handleWindowFocus);
    void startUpdate();
  });

  onDestroy(() => {
    generation += 1;
    fileLogGeneration += 1;
    clearPollTimer();
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
    window.removeEventListener("click", closeFileContextMenu);
    window.removeEventListener("blur", closeFileContextMenu);
    window.removeEventListener("resize", closeFileContextMenu);
    window.removeEventListener("keydown", handleWindowKeydown);
    window.removeEventListener("focus", handleWindowFocus);
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
    conflictScanCompleted = false;
    updateTask = null;
    resolutionTask = null;
    resolutionHistory = [];
    resolutionPath = null;
    resolutionKind = null;
    resolvedUpdateActions = new Map();
    resolvedConflictPaths = new Set();
    updatedFileSizes = new Map();
    autoFollowOutput = true;
    expectedAutoScrollTop = null;
    closeFileContextMenu();
    closeFileLog();

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
        await refreshUpdatedFileSizes(task.logs, currentGeneration);
        if (currentGeneration !== generation) {
          return;
        }
        updateTask = task;
        void followUpdateOutput();
      } else {
        resolutionTask = task;
      }

      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, role, currentGeneration, 350);
        return;
      }

      if (role === "resolution") {
        resolutionHistory = [...resolutionHistory, task];
        if (task.status === "success" && resolutionPath && resolutionKind) {
          const resolvedPath = resolutionPath;
          const action = resolutionKind === "resolve_theirs_full" ? "U" : "L";
          resolvedUpdateActions = new Map(resolvedUpdateActions).set(resolvedPath, action);
          resolvedConflictPaths = new Set(resolvedConflictPaths).add(resolvedPath);
          conflicts = conflicts.filter((file) => file.path !== resolvedPath);
        } else if (task.status !== "success") {
          actionError = task.error ?? "冲突处理失败";
        }
      }
      await refreshConflicts(currentGeneration, role !== "resolution");
      if (role === "update" && task.status === "success" && conflictScanCompleted) {
        await followUpdateOutput(true);
      }
      if (role === "resolution") {
        resolutionKind = null;
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        error = caught as CommandError;
      }
    }
  }

  async function refreshConflicts(
    currentGeneration = generation,
    showScanning = true,
  ) {
    if (!target) {
      return;
    }
    if (showScanning) {
      scanning = true;
      conflictScanCompleted = false;
    }
    statusError = null;
    try {
      const nextStatus = await scanWorkspaceStatus({
        working_copy_root: target.working_copy_root,
        scope_path: target.relative_path ?? undefined,
        include_content_digests: false,
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
          isPathInUpdateTarget(file.path) &&
          !resolvedConflictPaths.has(file.path),
      );
      if (showScanning) {
        conflictScanCompleted = true;
      }
      if (!isTaskRunning(resolutionTask)) {
        resolutionPath = null;
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        statusError = caught as CommandError;
      }
    } finally {
      if (currentGeneration === generation) {
        if (showScanning) {
          scanning = false;
        }
      }
    }
  }

  function handleWindowFocus() {
    if (
      !target ||
      updateRunning ||
      resolutionRunning ||
      scanning ||
      !conflictScanCompleted ||
      updateTask?.status !== "success"
    ) {
      return;
    }
    void refreshConflicts(generation, false);
  }

  async function openFileContextMenu(event: MouseEvent, path: string) {
    event.preventDefault();
    if (updateRunning || resolutionRunning || scanning || initializing) {
      return;
    }
    fileContextMenu = {
      path,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 54)),
    };
    await tick();
    fileContextMenuElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  function closeFileContextMenu() {
    fileContextMenu = null;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeFileContextMenu();
      if (fileLog) {
        closeFileLog();
      }
    }
  }

  async function showFileLog(path: string) {
    closeFileContextMenu();
    if (!target) {
      return;
    }
    const requestGeneration = ++fileLogGeneration;
    fileLogPath = path;
    fileLog = null;
    fileLogError = null;
    fileLogLoading = true;
    await tick();
    fileLogDialogElement?.focus();
    try {
      const nextLog = await getSvnLog({
        working_copy_root: target.working_copy_root,
        file_path: path,
        svn_executable: svnExecutable?.trim() || undefined,
        limit: 50,
      });
      if (requestGeneration !== fileLogGeneration) {
        return;
      }
      fileLog = nextLog;
    } catch (caught) {
      if (requestGeneration === fileLogGeneration) {
        fileLogError = caught as CommandError;
      }
    } finally {
      if (requestGeneration === fileLogGeneration) {
        fileLogLoading = false;
      }
    }
  }

  function closeFileLog() {
    fileLogGeneration += 1;
    fileLog = null;
    fileLogPath = null;
    fileLogLoading = false;
    fileLogError = null;
    expandedFileLogRevisions = new Set();
  }

  function toggleFileLogPaths(revision: string) {
    const next = new Set(expandedFileLogRevisions);
    if (next.has(revision)) next.delete(revision);
    else next.add(revision);
    expandedFileLogRevisions = next;
  }

  function formatLogDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || "-";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
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
    resolutionKind = kind;
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
      resolutionKind = null;
    }
  }

  async function openConflict(file: ChangedFile) {
    if (!target) {
      return;
    }
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

  async function followUpdateOutput(force = false) {
    await tick();
    if ((!autoFollowOutput && !force) || !outputLinesElement) {
      return;
    }
    const targetScrollTop = Math.max(
      0,
      outputLinesElement.scrollHeight - outputLinesElement.clientHeight,
    );
    expectedAutoScrollTop = targetScrollTop;
    outputLinesElement.scrollTop = targetScrollTop;
  }

  function handleOutputScroll() {
    if (!outputLinesElement) {
      return;
    }
    if (
      expectedAutoScrollTop !== null &&
      Math.abs(outputLinesElement.scrollTop - expectedAutoScrollTop) <= 1
    ) {
      expectedAutoScrollTop = null;
      return;
    }
    expectedAutoScrollTop = null;
    autoFollowOutput = false;
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
        if (statusError) {
          return "冲突检查失败";
        }
        return updateComplete ? "更新完成" : "正在检查冲突";
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

  async function refreshUpdatedFileSizes(
    logs: Task["logs"],
    currentGeneration: number,
  ) {
    if (!target) {
      return;
    }
    const paths = extractSvnFileChanges(logs, target.working_copy_root).map((file) => file.path);
    if (paths.length === 0) {
      return;
    }
    try {
      const sizes = await getWorkspacePathSizes({
        working_copy_root: target.working_copy_root,
        paths,
      });
      if (currentGeneration !== generation) {
        return;
      }
      const next = new Map(updatedFileSizes);
      for (const entry of sizes) {
        next.set(normalizeSvnOutputPath(entry.path, target.working_copy_root), entry.bytes);
      }
      updatedFileSizes = next;
    } catch {
      // Size metrics are supplementary and must not turn a successful Update into an error.
    }
  }

  async function returnToCommitWindow() {
    if (!returnToCommit || !target || !updateComplete || conflictCount > 0 || returningToCommit) {
      return;
    }
    returningToCommit = true;
    actionError = null;
    try {
      await launchCommitWindow({ target_path: target.target_path });
      await getCurrentWindow().close();
    } catch (caught) {
      returningToCommit = false;
      actionError = caught as CommandError;
    }
  }

  function applyResolvedUpdateActions(
    files: Array<{ action: string; path: string }>,
    resolutions: Map<string, "L" | "U">,
  ) {
    const next = new Map(files.map((file) => [file.path, file]));
    for (const [path, action] of resolutions) {
      next.set(path, { action, path });
    }
    return [...next.values()];
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

  function commandErrorText(value: CommandError | null) {
    return value
      ? [value.code, value.message, value.detail].filter(Boolean).join("\n")
      : null;
  }
</script>

<main class="standalone-update" data-theme={resolvedTheme} aria-label="NovaSVN Update">
  <header class="update-titlebar">
    <div class="update-heading">
      {#if showReturnToMain}
        <button
          type="button"
          class="icon-button update-return"
          aria-label="返回主界面"
          title="返回主界面"
          disabled={initializing || updateRunning || resolutionRunning}
          on:click={onReturnToMain}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
      {/if}
      <div>
        <h1>NovaSVN Update</h1>
        <p title={targetPath}>{target?.target_path ?? targetPath}</p>
      </div>
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
          disabled={initializing || resolutionRunning || conflictCount > 0}
          on:click={startUpdate}
        >
          <RotateCw size={15} aria-hidden="true" /> 重新更新
        </button>
        {#if returnToCommit && updateComplete && conflictCount === 0}
          <button type="button" class="primary" disabled={returningToCommit} on:click={returnToCommitWindow}>
            返回提交
          </button>
        {/if}
      {/if}
    </div>
  </header>

  <section class="update-summary" aria-label="更新摘要">
    <span>目标 <strong>{target?.relative_path ?? "工作副本根目录"}</strong></span>
    <span>Revision <strong>{status?.revision_range ?? target?.revision ?? "-"}</strong></span>
    <span>冲突 <strong class:has-conflicts={conflictCount > 0}>{conflictCount}</strong></span>
    <OperationMetrics
      task={updateTask}
      totalBytes={updatedBytes}
      label="总更新量"
      active={updateRunning}
    />
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
    <div class="update-left-pane">
      <section class="update-output" aria-label="更新内容" aria-busy={updateRunning}>
        <header>
          <h2>更新内容</h2>
          <span>{updatedFiles.length} 个文件</span>
        </header>
        <div
          bind:this={outputLinesElement}
          class="output-lines"
          role="log"
          aria-live="polite"
          on:scroll={handleOutputScroll}
        >
          {#if updatedFiles.length > 0}
            {#each updatedFiles as file (file.path)}
              <div
                class="output-line"
                data-kind={file.action}
                role="listitem"
                aria-label={`更新文件 ${file.path}`}
                on:contextmenu={(event) => openFileContextMenu(event, file.path)}
              >
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
          {#if updateComplete}
            <div
              class="update-complete-line"
              class:has-conflicts={conflictCount > 0}
              role="status"
              aria-label="更新完成"
            >
              <CircleCheck size={18} strokeWidth={2.2} aria-hidden="true" />
              <strong>更新完成</strong>
              <span>
                工作副本已更新到 Revision {status?.revision_range ?? target?.revision ?? "-"}
                · 冲突 {conflictCount}
              </span>
            </div>
          {/if}
        </div>
      </section>

    </div>

    <aside class="conflict-pane" aria-label="冲突处理">
      <header>
        <div>
          <h2>冲突处理</h2>
          <p>{conflictCount > 0 ? `${conflictCount} 个路径待处理` : "没有待处理冲突"}</p>
        </div>
      </header>

      <div class="conflict-list">
        {#each provisionalConflictPaths as path (path)}
          <article class="conflict-item provisional-conflict">
            <header>
              <strong title={path}>{path}</strong>
              <span>更新中检测到冲突</span>
            </header>
            <p class="resolving" role="status">等待 Update 完成后读取冲突详情...</p>
          </article>
        {/each}
        {#each conflicts as file (file.path)}
          <article class="conflict-item">
            <header>
              <strong title={file.path}>{file.path}</strong>
              <span>{conflictKindLabel(file)}</span>
            </header>
            <div class="conflict-actions">
              <button
                type="button"
                aria-label="编辑冲突"
                disabled={resolutionRunning}
                on:click={() => openConflict(file)}
              >
                <FilePenLine size={15} aria-hidden="true" /> 编辑
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

        {#if conflictCount === 0 && updateComplete && !scanning}
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

  {#if fileContextMenu}
    <div
      bind:this={fileContextMenuElement}
      class="file-context-menu"
      role="menu"
      tabindex="-1"
      aria-label={`文件菜单 ${fileContextMenu.path}`}
      style={`left: ${fileContextMenu.x}px; top: ${fileContextMenu.y}px`}
    >
      <button type="button" role="menuitem" on:click={() => showFileLog(fileContextMenu?.path ?? "")}>
        <History size={15} aria-hidden="true" /> 显示 Log
      </button>
    </div>
  {/if}

  {#if fileLogPath}
    <div
      class="file-log-backdrop"
      role="presentation"
      tabindex="-1"
      on:click|self={closeFileLog}
      on:keydown={(event) => event.key === "Escape" && closeFileLog()}
    >
      <div
        bind:this={fileLogDialogElement}
        class="file-log-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`文件 Log ${fileLogPath}`}
        tabindex="-1"
      >
        <header>
          <div>
            <h2>文件 Log</h2>
            <code title={fileLogPath}>{fileLogPath}</code>
          </div>
          <button type="button" class="icon-button" aria-label="关闭文件 Log" title="关闭" on:click={closeFileLog}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <ErrorNotice error={fileLogError} />
        <div class="file-log-list" aria-busy={fileLogLoading}>
          <SvnLogRevisionList
            entries={fileLog?.entries ?? []}
            totalEntries={fileLog?.entries.length ?? 0}
            loading={fileLogLoading}
            hasLoadError={fileLogError !== null}
            expandedRevisions={expandedFileLogRevisions}
            theme={resolvedTheme}
            formatDate={formatLogDate}
            emptyText="没有可显示的 Log"
            onTogglePaths={toggleFileLogPaths}
          />
        </div>
      </div>
    </div>
  {/if}
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
    isolation: isolate;
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

  .update-heading {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .update-heading > div {
    min-width: 0;
  }

  .update-return {
    flex: 0 0 auto;
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

  .update-left-pane {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--border);
  }

  .update-output,
  .conflict-pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--panel);
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

  .output-line[data-kind="L"] > span {
    color: #276fa8;
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

  .update-complete-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    margin-top: 8px;
    border-top: 1px solid color-mix(in srgb, #24783d 35%, var(--border));
    border-bottom: 1px solid color-mix(in srgb, #24783d 35%, var(--border));
    background: color-mix(in srgb, #24783d 10%, var(--panel));
    color: #24783d;
    padding: 8px 12px;
  }

  .update-complete-line strong {
    font-size: 13px;
  }

  .update-complete-line span {
    color: var(--secondary);
    font-size: 11px;
  }

  .standalone-update[data-theme="dark"] .update-complete-line {
    border-color: #376d47;
    background: #203729;
    color: #8fdaa2;
  }

  .update-complete-line.has-conflicts {
    border-color: #c5922e;
    background: color-mix(in srgb, #c5922e 12%, var(--panel));
    color: #8a5b00;
  }

  .standalone-update[data-theme="dark"] .update-complete-line.has-conflicts {
    border-color: #7d642d;
    background: #3a311f;
    color: #f0c96c;
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

  .file-context-menu {
    position: fixed;
    z-index: 3000;
    min-width: 170px;
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
    background: var(--panel);
    padding: 4px;
  }

  .file-context-menu button {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: flex-start;
    gap: 7px;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .file-context-menu button:hover {
    background: var(--panel-subtle);
  }

  .file-log-backdrop {
    position: fixed;
    z-index: 3100;
    inset: 0;
    display: grid;
    background: rgb(0 0 0 / 38%);
    padding: 5vh 7vw;
    place-items: center;
  }

  .file-log-dialog {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: min(760px, 100%);
    max-height: 90vh;
    min-height: 260px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
  }

  .file-log-dialog > header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--border);
    padding: 12px 14px;
  }

  .file-log-dialog > header > div {
    min-width: 0;
  }

  .file-log-dialog h2 {
    margin-bottom: 4px;
  }

  .file-log-dialog code {
    display: block;
    overflow: hidden;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-log-dialog .icon-button {
    flex: 0 0 auto;
    margin: 0;
  }

  .file-log-list {
    min-height: 0;
    overflow: auto;
    padding: 8px 12px 14px;
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

  @media (max-width: 760px) {
    .update-layout {
      grid-template-columns: 1fr;
      overflow: auto;
    }

    .update-left-pane {
      min-height: 680px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .conflict-pane {
      min-height: 320px;
    }

    .file-log-backdrop {
      padding: 14px;
    }
  }
</style>
