<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    ArrowLeft,
    CheckSquare,
    ChevronDown,
    ChevronUp,
    CircleCheck,
    FilePenLine,
    History,
    RefreshCw,
    RotateCw,
    Square,
    X,
  } from "@lucide/svelte";
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
  import {
    commonConflictResolutionActions,
    conflictKindLabel,
    conflictReasonDescription,
    conflictResolutionActions,
    type ConflictResolutionAction,
  } from "../lib/svn-conflict";
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

  const UPDATE_AUTO_CLOSE_SETTING_KEY = "novasvn:update-close-after-completion";

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
  export let embedded = false;
  export let initialTask: Task | null = null;
  export let initialTarget: UpdateTargetSummary | null = null;
  export let autoStart = true;
  export let minimized = false;
  export let onToggleMinimized: () => void = () => {};
  export let onClose: () => void = () => {};
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
  /** Remaining resolve targets after the current one (sequential batch). */
  let resolutionQueue: Array<{ path: string; kind: SvnOperationKind }> = [];
  let resolvedUpdateActions = new Map<string, "L" | "U">();
  let resolvedConflictPaths = new Set<string>();
  let status: WorkingCopyStatus | null = null;
  let conflicts: ChangedFile[] = [];
  let selectedConflictPaths = new Set<string>();
  let conflictSelectionAnchorPath: string | null = null;
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
  /** 累计已见文件，避免后端日志截断后列表倒退/看似卡住 */
  let accumulatedUpdateFiles = new Map<string, { action: string; path: string }>();
  let sizeRefreshGeneration = 0;
  let closeAfterCompletion = readCloseAfterCompletionSetting();
  let closeCurrentUpdateAfterCompletion = closeAfterCompletion;
  let autoCloseTriggered = false;

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
  // Include queue + in-flight path so sequential batch cannot be double-started.
  $: resolutionRunning =
    isTaskRunning(resolutionTask) ||
    resolutionQueue.length > 0 ||
    (resolutionPath !== null && resolutionKind !== null);
  $: selectedConflicts = conflicts.filter((file) => selectedConflictPaths.has(file.path));
  $: allConflictsSelected =
    conflicts.length > 0 && conflicts.every((file) => selectedConflictPaths.has(file.path));
  $: batchConflictActions = commonConflictResolutionActions(selectedConflicts);
  $: updateComplete =
    updateTask?.status === "success" && conflictScanCompleted && !scanning;
  $: canCloseUpdateView =
    !initializing && !updateRunning && !resolutionRunning && !returningToCommit;
  // 合并日志中的新文件到累计表，后端裁剪旧日志时也不丢已展示项
  $: {
    const latest = extractSvnFileChanges(
      updateTask?.logs ?? [],
      target?.working_copy_root,
    );
    let changed = false;
    const next = new Map(accumulatedUpdateFiles);
    for (const file of latest) {
      const previous = next.get(file.path);
      if (!previous || previous.action !== file.action) {
        next.set(file.path, file);
        changed = true;
      }
    }
    if (changed) {
      accumulatedUpdateFiles = next;
    }
  }
  $: updatedFiles = applyResolvedUpdateActions(
    [...accumulatedUpdateFiles.values()],
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
    void (autoStart ? startUpdate() : initializeExistingUpdate());
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
    resolutionQueue = [];
    resolvedUpdateActions = new Map();
    resolvedConflictPaths = new Set();
    selectedConflictPaths = new Set();
    conflictSelectionAnchorPath = null;
    updatedFileSizes = new Map();
    accumulatedUpdateFiles = new Map();
    sizeRefreshGeneration += 1;
    closeCurrentUpdateAfterCompletion = closeAfterCompletion;
    autoCloseTriggered = false;
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
    let taskStatus: TaskStatus | null = null;
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      taskStatus = task.status;
      if (role === "update") {
        // 先刷新界面，体积查询放到后台，避免大项目卡死轮询
        updateTask = task;
        void followUpdateOutput();
        void refreshUpdatedFileSizes(task.logs, currentGeneration);
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
          pruneConflictSelection(conflicts.map((file) => file.path));
          // Continue sequential batch without intermediate full status scans.
          if (resolutionQueue.length > 0) {
            await startNextQueuedResolution(currentGeneration);
            return;
          }
        } else if (task.status !== "success") {
          actionError = task.error ?? "冲突处理失败";
          resolutionQueue = [];
        }
      }
      await refreshConflicts(currentGeneration);
      if (role === "update" && task.status === "success" && conflictScanCompleted) {
        await followUpdateOutput(true);
      }
      if (role === "resolution") {
        resolutionKind = null;
      }
      await maybeCloseCompletedUpdate();
    } catch (caught) {
      if (currentGeneration === generation) {
        error = caught as CommandError;
        // 轮询失败时继续重试，避免大项目偶发 IPC 失败后界面永久停更
        const stillRunning =
          taskStatus === "pending" ||
          taskStatus === "running" ||
          (role === "update"
            ? isTaskRunning(updateTask)
            : isTaskRunning(resolutionTask));
        if (stillRunning) {
          schedulePoll(taskId, role, currentGeneration, 800);
        }
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
      pruneConflictSelection(conflicts.map((file) => file.path));
      if (showScanning) {
        conflictScanCompleted = true;
      }
      if (!isTaskRunning(resolutionTask) && resolutionQueue.length === 0) {
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

  async function initializeExistingUpdate() {
    const currentGeneration = ++generation;
    clearPollTimer();
    initializing = true;
    error = null;
    statusError = null;
    actionError = null;
    status = null;
    conflicts = [];
    conflictScanCompleted = false;
    updateTask = initialTask;
    resolutionTask = null;
    resolutionHistory = [];
    resolutionPath = null;
    resolutionKind = null;
    resolutionQueue = [];
    resolvedUpdateActions = new Map();
    resolvedConflictPaths = new Set();
    selectedConflictPaths = new Set();
    conflictSelectionAnchorPath = null;
    updatedFileSizes = new Map();
    accumulatedUpdateFiles = new Map();
    sizeRefreshGeneration += 1;
    closeCurrentUpdateAfterCompletion = closeAfterCompletion;
    autoCloseTriggered = false;
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
          detail: "请先打开 SVN 工作副本。",
          recoverable: false,
        } satisfies CommandError;
      }
      target = initialTarget ?? await inspectUpdateTarget({
          path,
          svn_executable: svnExecutable?.trim() || undefined,
        });
      if (currentGeneration !== generation) {
        return;
      }
      if (updateTask) {
        schedulePoll(updateTask.task_id, "update", currentGeneration, 0);
      } else {
        throw {
          code: "UPDATE_TASK_MISSING",
          message: "Update 任务不存在",
          detail: "无法恢复内嵌 Update 任务，请重新执行 Update。",
          recoverable: true,
        } satisfies CommandError;
      }
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

  async function handleWindowFocus() {
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
    await refreshConflicts(generation, false);
    await maybeCloseCompletedUpdate();
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
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    if (fileContextMenu) {
      closeFileContextMenu();
    } else if (fileLogPath) {
      closeFileLog();
    } else if (canCloseUpdateView) {
      closeUpdateView();
    } else {
      return;
    }
    event.preventDefault();
  }

  function closeUpdateView() {
    if (!canCloseUpdateView) {
      return;
    }
    if (embedded) {
      onClose();
      return;
    }
    void getCurrentWindow().close();
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

  async function runConflictAction(file: ChangedFile, action: ConflictResolutionAction) {
    await runConflictActions([file], action);
  }

  async function runBatchConflictAction(action: ConflictResolutionAction) {
    await runConflictActions(selectedConflicts, action);
  }

  async function runConflictActions(files: ChangedFile[], action: ConflictResolutionAction) {
    if (!target || updateRunning || resolutionRunning || files.length === 0) {
      return;
    }
    if (action.kind === "edit") {
      if (files.length === 1) {
        await openConflict(files[0]);
      }
      return;
    }

    const paths = files.map((file) => file.path);
    if (action.confirm) {
      const message =
        paths.length === 1
          ? `${action.description}？\n${paths[0]}`
          : `${action.description}？\n将处理 ${paths.length} 个冲突路径`;
      if (!window.confirm(message)) {
        return;
      }
    }

    actionError = null;
    resolutionQueue = paths.map((path) => ({
      path,
      kind: action.kind as SvnOperationKind,
    }));
    await startNextQueuedResolution(generation);
  }

  async function startNextQueuedResolution(currentGeneration = generation) {
    if (!target || currentGeneration !== generation) {
      return;
    }
    const next = resolutionQueue[0];
    if (!next) {
      resolutionPath = null;
      resolutionKind = null;
      return;
    }
    resolutionQueue = resolutionQueue.slice(1);
    resolutionPath = next.path;
    resolutionKind = next.kind;
    try {
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind: next.kind,
        file_path: next.path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      resolutionTask = task;
      schedulePoll(task.task_id, "resolution", currentGeneration, 0);
    } catch (caught) {
      if (currentGeneration !== generation) {
        return;
      }
      const commandError = caught as CommandError;
      actionError = commandError.detail
        ? `${commandError.message}：${commandError.detail}`
        : commandError.message;
      resolutionPath = null;
      resolutionKind = null;
      resolutionQueue = [];
      resolutionTask = null;
    }
  }

  /**
   * Checkbox multi-select for conflicts:
   * - normal click follows the checkbox checked state
   * - Shift+click applies that state to the inclusive range from the selection anchor
   */
  function handleConflictCheckboxClick(event: MouseEvent, path: string) {
    if (updateRunning || resolutionRunning || scanning || initializing) {
      event.preventDefault();
      return;
    }

    const checkbox = event.currentTarget as HTMLInputElement;
    const next = new Set(selectedConflictPaths);
    const ordered = conflicts.map((file) => file.path);

    if (event.shiftKey && conflictSelectionAnchorPath) {
      const anchorIndex = ordered.indexOf(conflictSelectionAnchorPath);
      const targetIndex = ordered.indexOf(path);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        for (const item of ordered.slice(start, end + 1)) {
          if (checkbox.checked) {
            next.add(item);
          } else {
            next.delete(item);
          }
        }
      } else if (checkbox.checked) {
        next.add(path);
      } else {
        next.delete(path);
      }
    } else if (checkbox.checked) {
      next.add(path);
    } else {
      next.delete(path);
    }

    selectedConflictPaths = new Set(next);
    conflictSelectionAnchorPath = path;
  }

  function selectAllConflicts() {
    if (conflicts.length === 0 || resolutionRunning) {
      return;
    }
    selectedConflictPaths = new Set(conflicts.map((file) => file.path));
    conflictSelectionAnchorPath = conflicts.at(-1)?.path ?? null;
  }

  function clearConflictSelection() {
    selectedConflictPaths = new Set();
    conflictSelectionAnchorPath = null;
  }

  function toggleSelectAllConflicts() {
    if (allConflictsSelected) {
      clearConflictSelection();
    } else {
      selectAllConflicts();
    }
  }

  function pruneConflictSelection(paths: Iterable<string>) {
    const allowed = new Set(paths);
    const next = new Set([...selectedConflictPaths].filter((path) => allowed.has(path)));
    if (next.size !== selectedConflictPaths.size) {
      selectedConflictPaths = next;
    }
    if (conflictSelectionAnchorPath && !allowed.has(conflictSelectionAnchorPath)) {
      conflictSelectionAnchorPath = null;
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
    // 只补查尚未有体积的路径，避免每轮对全量路径做 metadata
    const paths = extractSvnFileChanges(logs, target.working_copy_root)
      .map((file) => file.path)
      .filter((path) => !updatedFileSizes.has(path));
    if (paths.length === 0) {
      return;
    }
    const requestId = ++sizeRefreshGeneration;
    try {
      const sizes = await getWorkspacePathSizes({
        working_copy_root: target.working_copy_root,
        paths,
      });
      if (currentGeneration !== generation || requestId !== sizeRefreshGeneration) {
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
      actionError = commandErrorMessage(caught, "无法返回 Commit 窗口");
    }
  }

  async function maybeCloseCompletedUpdate() {
    if (
      autoCloseTriggered ||
      !updateComplete ||
      conflictCount > 0 ||
      resolutionRunning ||
      statusError !== null
    ) {
      return;
    }

    if (returnToCommit) {
      autoCloseTriggered = true;
      await returnToCommitWindow();
      if (!returningToCommit) {
        autoCloseTriggered = false;
      }
      return;
    }
    if (embedded) {
      autoCloseTriggered = true;
      onClose();
      return;
    }
    if (!closeCurrentUpdateAfterCompletion) {
      return;
    }
    autoCloseTriggered = true;
    try {
      await getCurrentWindow().close();
    } catch (caught) {
      autoCloseTriggered = false;
      error = normalizeAutoCloseError(caught);
    }
  }

  function handleCloseAfterCompletionChange(event: Event) {
    closeAfterCompletion = (event.currentTarget as HTMLInputElement).checked;
    writeCloseAfterCompletionSetting(closeAfterCompletion);
    if (
      !closeAfterCompletion ||
      updateTask?.status !== "success" ||
      conflictCount > 0
    ) {
      closeCurrentUpdateAfterCompletion = closeAfterCompletion;
    }
  }

  function readCloseAfterCompletionSetting() {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(UPDATE_AUTO_CLOSE_SETTING_KEY) === "true";
    } catch {
      return false;
    }
  }

  function writeCloseAfterCompletionSetting(value: boolean) {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(UPDATE_AUTO_CLOSE_SETTING_KEY, String(value));
    } catch {
      // Preference persistence must not interfere with Update.
    }
  }

  function commandErrorMessage(value: unknown, fallback: string) {
    if (value && typeof value === "object" && "message" in value) {
      return String((value as { message?: unknown }).message || fallback);
    }
    return typeof value === "string" && value ? value : fallback;
  }

  function normalizeAutoCloseError(value: unknown): CommandError {
    const candidate = value && typeof value === "object"
      ? value as Partial<CommandError>
      : null;
    return {
      code: candidate?.code || "UPDATE_WINDOW_CLOSE_FAILED",
      message: commandErrorMessage(value, "Update 完成，但窗口无法自动关闭"),
      detail: candidate?.detail ?? null,
      recoverable: true,
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

<main
  class="standalone-update"
  class:embedded
  class:minimized={embedded && minimized}
  data-theme={resolvedTheme}
  aria-label={embedded ? "主界面 Update" : "NovaSVN Update"}
>
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
      {#if embedded}
        <button
          type="button"
          class="icon-button update-minimize"
          aria-label={minimized ? "展开 Update 详情" : "最小化 Update"}
          title={minimized ? "展开 Update 详情" : "最小化 Update"}
          on:click={onToggleMinimized}
        >
          {#if minimized}<ChevronDown size={16} aria-hidden="true" />{:else}<ChevronUp size={16} aria-hidden="true" />{/if}
        </button>
        <button
          type="button"
          class="icon-button update-close"
          aria-label="关闭 Update"
          title="关闭"
          disabled={!canCloseUpdateView}
          on:click={closeUpdateView}
        >
          <X size={16} aria-hidden="true" />
        </button>
      {/if}
    </div>
  </header>

  {#if embedded && minimized}
    <section class="update-minimized-summary" aria-label="Update 简要信息">
      <span>{taskStatusLabel(updateTask)}</span>
      <strong>{updatedFiles.length} 个文件</strong>
      <OperationMetrics task={updateTask} totalBytes={updatedBytes} label="总更新量" active={updateRunning} />
      <span class:has-conflicts={conflictCount > 0}>{conflictCount} 个冲突</span>
    </section>
  {/if}

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
    aria-hidden={embedded && minimized ? "true" : undefined}
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

  <div class="update-layout" aria-hidden={embedded && minimized ? "true" : undefined}>
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
          <p>
            {#if conflictCount > 0}
              {conflictCount} 个路径待处理
              {#if selectedConflicts.length > 0}
                · 已选 {selectedConflicts.length}
              {/if}
            {:else}
              没有待处理冲突
            {/if}
          </p>
        </div>
        {#if conflicts.length > 0}
          <div class="conflict-selection-toolbar" role="toolbar" aria-label="冲突选择">
            <button
              type="button"
              class="conflict-select-all"
              aria-label={allConflictsSelected ? "取消全选冲突" : "全选冲突"}
              title={allConflictsSelected ? "取消全选" : "全选"}
              disabled={resolutionRunning || scanning}
              on:click={toggleSelectAllConflicts}
            >
              <CheckSquare size={15} aria-hidden="true" />
              {allConflictsSelected ? "取消全选" : "全选"}
            </button>
            {#if selectedConflicts.length > 0}
              <button
                type="button"
                disabled={resolutionRunning || scanning}
                on:click={clearConflictSelection}
              >
                取消选择
              </button>
            {/if}
          </div>
        {/if}
      </header>

      {#if selectedConflicts.length > 0}
        <div class="conflict-batch-bar" role="toolbar" aria-label="批量冲突操作">
          <span>批量处理 {selectedConflicts.length} 项</span>
          <div class="conflict-batch-actions">
            {#if batchConflictActions.length > 0}
              {#each batchConflictActions as action (action.kind)}
                <button
                  type="button"
                  title={action.description}
                  disabled={resolutionRunning || scanning}
                  on:click={() => runBatchConflictAction(action)}
                >
                  {action.label}
                </button>
              {/each}
            {:else}
              <span class="conflict-batch-empty">所选冲突没有共同批量操作</span>
            {/if}
          </div>
        </div>
      {/if}

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
          {@const reason = conflictReasonDescription(file)}
          {@const actions = conflictResolutionActions(file)}
          {@const selected = selectedConflictPaths.has(file.path)}
          <article class="conflict-item" class:selected data-selected={selected ? "true" : undefined}>
            <header>
              <label class="conflict-select" title={file.path}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={resolutionRunning || scanning}
                  aria-label={`选择冲突 ${file.path}`}
                  on:click={(event) => handleConflictCheckboxClick(event, file.path)}
                />
                <strong>{file.path}</strong>
              </label>
              <span>{conflictKindLabel(file) ?? "冲突"}</span>
            </header>
            {#if reason}
              <p class="conflict-reason" title={reason}>{reason}</p>
            {/if}
            <div class="conflict-actions" role="group" aria-label={`冲突操作 ${file.path}`}>
              {#each actions as action (action.kind + action.label)}
                <button
                  type="button"
                  aria-label={action.label}
                  title={action.description}
                  disabled={resolutionRunning}
                  on:click={() => runConflictAction(file, action)}
                >
                  {#if action.kind === "edit"}
                    <FilePenLine size={15} aria-hidden="true" />
                  {/if}
                  {action.label}
                </button>
              {/each}
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

  {#if !embedded}
    <footer class="update-footer">
      <label>
        <input
          type="checkbox"
          checked={closeAfterCompletion}
          disabled={autoCloseTriggered}
          on:change={handleCloseAfterCompletionChange}
        />
        <span>更新完成且所有冲突解决后自动关闭</span>
      </label>
    </footer>
  {/if}

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
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
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

  .standalone-update.embedded {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border: 0;
  }

  .standalone-update.embedded.minimized {
    grid-template-rows: auto auto;
  }

  .standalone-update.embedded.minimized .update-summary,
  .standalone-update.embedded.minimized .update-notices,
  .standalone-update.embedded.minimized .update-layout {
    display: none;
  }

  .update-minimized-summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    min-height: 38px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-subtle);
    color: var(--secondary);
    padding: 6px 12px;
    font-size: 12px;
  }

  .update-minimized-summary strong,
  .update-minimized-summary .has-conflicts {
    color: var(--text);
  }

  .update-minimized-summary .has-conflicts {
    color: #bc3f39;
  }

  .update-titlebar,
  .update-summary,
  .update-actions,
  .update-actions button,
  .conflict-actions button,
  .conflict-selection-toolbar,
  .conflict-batch-bar,
  .conflict-batch-actions,
  .conflict-select {
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
  .conflict-actions button,
  .conflict-selection-toolbar button,
  .conflict-batch-actions button {
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

  .update-close {
    margin-left: 0;
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

  .update-output {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--panel);
  }

  .conflict-pane {
    display: flex;
    flex-direction: column;
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

  .update-footer {
    display: flex;
    align-items: center;
    min-width: 0;
    border-top: 1px solid var(--border);
    background: var(--panel);
    padding: 8px 14px;
  }

  .update-footer label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--secondary);
    font-size: 12px;
    cursor: pointer;
  }

  .update-footer input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
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
    background: var(--background);
  }

  .conflict-pane > header {
    flex: 0 0 auto;
    gap: 8px;
  }

  .conflict-selection-toolbar {
    flex: 0 0 auto;
    gap: 6px;
  }

  .conflict-selection-toolbar button,
  .conflict-batch-actions button {
    min-height: 28px;
    padding: 3px 8px;
    font-size: 11px;
  }

  .conflict-select-all {
    display: inline-flex;
    align-items: center;
  }

  .conflict-batch-bar {
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
    padding: 7px 12px;
  }

  .conflict-batch-bar > span {
    color: var(--secondary);
    font-size: 11px;
    white-space: nowrap;
  }

  .conflict-batch-actions {
    flex-wrap: wrap;
    gap: 6px;
  }

  .conflict-batch-empty {
    color: var(--secondary);
    font-size: 11px;
  }

  .conflict-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
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

  .conflict-item.selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  }

  .conflict-item > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .conflict-select {
    min-width: 0;
    gap: 8px;
    cursor: pointer;
  }

  .conflict-select input {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
  }

  .conflict-select strong,
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

  .conflict-reason {
    margin: 6px 0 0;
    color: var(--secondary);
    font-size: 11px;
    line-height: 1.45;
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
    flex: 0 0 auto;
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
