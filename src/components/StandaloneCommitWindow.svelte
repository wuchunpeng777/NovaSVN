<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { CheckSquare, GitMergeConflict, History, Minus, Plus, RefreshCw, RotateCcw, Square, Trash2, X } from "@lucide/svelte";
  import {
    cancelTask,
    createCommitTask,
    createSvnBatchOperationTask,
    createSvnOperationTask,
    getFileContentDiff,
    getFileDiff,
    getTask,
    inspectUpdateTarget,
    launchConflictWindow,
    launchUpdateWindow,
    scanWorkspaceStatus,
    setWorkspaceChangelist,
  } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import {
    COMMIT_MESSAGE_SELECTED_EVENT,
    consumePendingCommitMessage,
    readCommitMessageSettings,
    setPendingCommitMessage,
    writeCommitMessageSettings,
  } from "../lib/commit-message-history";
  import { LOG_FILE_DIFF_MAX_BYTES } from "../lib/svn-log";
  import { buildPropertyContentDiff } from "../lib/svn-property-diff";
  import type {
    ChangedFile,
    CommandError,
    FileContentDiff,
    FileDiff,
    Task,
    TaskStatus,
    UpdateTargetSummary,
    WorkingCopyStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import OperationMetrics from "./OperationMetrics.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";
  import ImageDiffViewer from "./workbench/ImageDiffViewer.svelte";
  import MonacoDiffViewer from "./workbench/MonacoDiffViewer.svelte";
  import RawDiffViewer from "./workbench/RawDiffViewer.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let diffMode: "side_by_side" | "inline" = "side_by_side";
  export let showWhitespace = false;
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  const COMMIT_AUTO_CLOSE_SETTING_KEY = "novasvn:commit-close-after-completion";
  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  let target: UpdateTargetSummary | null = null;
  let status: WorkingCopyStatus | null = null;
  let commitTask: Task | null = null;
  let addTask: Task | null = null;
  let deleteTask: Task | null = null;
  let revertTask: Task | null = null;
  let addingPath: string | null = null;
  let addAction: "add" | "unadd" | null = null;
  let deletingPath: string | null = null;
  let revertingPaths: string[] = [];
  let deleteNotice: string | null = null;
  let revertNotice: string | null = null;
  let addNotice: string | null = null;
  let deleteCandidate: ChangedFile | null = null;
  let revertCandidatePaths: string[] = [];
  let revertCandidateIsBatch = false;
  let changelistRunning = false;
  let changelistNotice: string | null = null;
  let fileContextMenu: { file: ChangedFile; x: number; y: number } | null = null;
  let fileContextMenuElement: HTMLDivElement | null = null;
  let deleteDialogElement: HTMLDivElement | null = null;
  let revertDialogElement: HTMLDivElement | null = null;
  let selectedPaths = new Set<string>();
  let activeFilePath: string | null = null;
  let selectedFileDiff: FileDiff | null = null;
  let selectedFileContentDiff: FileContentDiff | null = null;
  let selectedPropertyContentDiff: FileContentDiff | null = null;
  let diffLoading = false;
  let diffError: CommandError | null = null;
  let diffGeneration = 0;
  let diffPaneOpen = false;
  let diffPaneHeight = 320;
  let messagePaneWidth = 360;
  let reviewPaneElement: HTMLDivElement | null = null;
  let commitLayoutElement: HTMLDivElement | null = null;
  let diffResizeStart: { y: number; height: number } | null = null;
  let messageResizeStart: { x: number; width: number } | null = null;
  let history: string[] = [];
  let commitTemplate = "";
  let commitMessage = "";
  let selectedHistoryMessage = "";
  let historyPickerOpen = false;
  let initializing = true;
  let scanning = false;
  let error: CommandError | null = null;
  let statusError: CommandError | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let recordedTaskId: string | null = null;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let pendingMessageTimer: number | null = null;
  let outOfDateDialogOpen = false;
  let committedBytes = 0;
  let closeAfterCompletion = readCloseAfterCompletionSetting();
  let closeCurrentCommitAfterCompletion = false;
  let submittedCommitTaskId: string | null = null;
  let autoCloseTriggered = false;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: visibleFiles = (status?.files ?? []).filter(
    (file) => isVisibleFile(file) && isPathInCommitTarget(file.path),
  );
  $: committableFiles = (status?.files ?? []).filter(
    (file) => isCommittable(file) && isPathInCommitTarget(file.path),
  );
  $: unversionedFiles = visibleFiles.filter((file) => file.status === "unversioned");
  $: conflictFiles = visibleFiles.filter(isConflicted);
  $: fileGroups = groupFilesByChangelist(visibleFiles);
  $: selectedPropertyContentDiff = buildPropertyContentDiff(selectedFileDiff);
  $: selectedCount = committableFiles.filter((file) => selectedPaths.has(file.path)).length;
  $: selectedRevertableFiles = committableFiles.filter(
    (file) => selectedPaths.has(file.path) && isRevertableFile(file),
  );
  $: selectedChangelistFiles = committableFiles.filter(
    (file) => selectedPaths.has(file.path) && canUseChangelist(file),
  );
  $: selectedAssignedChangelistFiles = selectedChangelistFiles.filter((file) =>
    Boolean(file.changelist?.trim()),
  );
  $: selectedBytes = committableFiles
    .filter((file) => selectedPaths.has(file.path))
    .reduce((total, file) => total + (file.file_size ?? 0), 0);
  $: displayedCommitBytes = commitTask ? committedBytes : selectedBytes;
  $: commitRunning = isTaskRunning(commitTask);
  $: addRunning = isTaskRunning(addTask);
  $: deleteRunning = isTaskRunning(deleteTask);
  $: revertRunning = isTaskRunning(revertTask);
  $: operationRunning =
    commitRunning ||
    addRunning ||
    addingPath !== null ||
    deleteRunning ||
    deletingPath !== null ||
    revertRunning ||
    revertingPaths.length > 0 ||
    changelistRunning;
  $: taskStatus = commitTask
    ? taskStatusLabel(commitTask, initializing)
    : deleteTask
      ? taskStatusLabel(deleteTask, initializing, "delete")
      : revertTask
        ? taskStatusLabel(revertTask, initializing, "revert")
        : addTask
          ? taskStatusLabel(addTask, initializing, addAction ?? "add")
          : deletingPath
            ? "正在准备 Delete"
            : addingPath
              ? addAction === "unadd" ? "正在准备 Unadd" : "正在准备 Add"
              : revertingPaths.length > 0
                ? "正在准备 Revert"
                : changelistRunning
                  ? "正在更新 Changelist"
                : taskStatusLabel(null, initializing);
  $: allSelected = committableFiles.length > 0 && selectedCount === committableFiles.length;
  $: commitDisabled =
    initializing ||
    scanning ||
    operationRunning ||
    selectedCount === 0 ||
    !target;
  $: statusAuthenticationFailure = detectSvnAuthenticationFailure(
    commandErrorText(statusError),
  );
  $: authenticationFailure =
    statusAuthenticationFailure ??
    detectSvnAuthenticationFailure(commandErrorText(error)) ??
    detectSvnAuthenticationFailure(commandErrorText(diffError)) ??
    detectSvnAuthenticationFailure(commitTask?.error) ??
    detectSvnAuthenticationFailure(addTask?.error) ??
    detectSvnAuthenticationFailure(deleteTask?.error) ??
    detectSvnAuthenticationFailure(revertTask?.error);
  $: authenticationRetry = statusAuthenticationFailure
    ? () => refreshStatus(generation, true)
    : null;
  $: commitOutOfDate = commitTask?.status === "failed" && isOutOfDateError(commitTask.error);
  $: if (commitOutOfDate) {
    outOfDateDialogOpen = true;
  }

  onMount(() => {
    loadCommitSettings();
    applyPendingCommitMessage();
    window.addEventListener(COMMIT_MESSAGE_SELECTED_EVENT, applyPendingCommitMessage);
    pendingMessageTimer = window.setInterval(applyPendingCommitMessage, 500);
    window.addEventListener("click", closeFileContextMenu);
    window.addEventListener("blur", closeFileContextMenu);
    window.addEventListener("resize", closeFileContextMenu);
    window.addEventListener("keydown", handleWindowKeydown);
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
    if (pendingMessageTimer !== null) {
      window.clearInterval(pendingMessageTimer);
      pendingMessageTimer = null;
    }
    window.removeEventListener(COMMIT_MESSAGE_SELECTED_EVENT, applyPendingCommitMessage);
    window.removeEventListener("click", closeFileContextMenu);
    window.removeEventListener("blur", closeFileContextMenu);
    window.removeEventListener("resize", closeFileContextMenu);
    window.removeEventListener("keydown", handleWindowKeydown);
    stopDiffPaneResize();
    stopMessagePaneResize();
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  function loadCommitSettings() {
    const settings = readCommitMessageSettings();
    commitTemplate = settings.template;
    history = settings.history;
    commitMessage = commitTemplate;
  }

  function saveCommitSettings(nextHistory: string[]) {
    writeCommitMessageSettings(
      { template: commitTemplate, history: nextHistory },
      target?.working_copy_root,
    );
  }

  function applyPendingCommitMessage() {
    const pending = consumePendingCommitMessage();
    if (!pending) {
      return;
    }
    commitMessage = pending;
    selectedHistoryMessage = pending;
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
    addTask = null;
    deleteTask = null;
    revertTask = null;
    addingPath = null;
    addAction = null;
    deletingPath = null;
    revertingPaths = [];
    deleteNotice = null;
    revertNotice = null;
    addNotice = null;
    deleteCandidate = null;
    revertCandidatePaths = [];
    revertCandidateIsBatch = false;
    changelistRunning = false;
    changelistNotice = null;
    closeFileContextMenu();
    selectedPaths = new Set();
    clearFilePreview();
    recordedTaskId = null;
    committedBytes = 0;
    closeCurrentCommitAfterCompletion = false;
    submittedCommitTaskId = null;
    autoCloseTriggered = false;

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
      history = readCommitMessageSettings(target.working_copy_root).history;
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
      selectedPaths = preserveSelection
        ? new Set(inScope.filter((path) => selectedPaths.has(path)))
        : new Set(inScope);
      if (activeFilePath) {
        const activeFile = nextStatus.files.find(
          (file) =>
            file.path === activeFilePath && isVisibleFile(file) && isPathInCommitTarget(file.path),
        );
        if (activeFile) {
          void showFilePreview(activeFile, currentGeneration);
        } else {
          clearFilePreview();
        }
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

  function groupFilesByChangelist(files: ChangedFile[]) {
    const grouped = new Map<string, ChangedFile[]>();
    for (const file of files) {
      const name = file.changelist?.trim() || "";
      const group = grouped.get(name);
      if (group) {
        group.push(file);
      } else {
        grouped.set(name, [file]);
      }
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => {
        if (!left) return 1;
        if (!right) return -1;
        return left.localeCompare(right);
      })
      .map(([name, groupFiles]) => ({
        name,
        label: name || "未分组",
        files: groupFiles,
      }));
  }

  function groupCommittableFiles(files: ChangedFile[]) {
    return files.filter(isCommittable);
  }

  function groupSelectedCount(files: ChangedFile[]) {
    return groupCommittableFiles(files).filter((file) => selectedPaths.has(file.path)).length;
  }

  function toggleGroupSelection(files: ChangedFile[]) {
    const candidates = groupCommittableFiles(files);
    if (candidates.length === 0) return;
    const next = new Set(selectedPaths);
    const allGroupSelected = candidates.every((file) => next.has(file.path));
    for (const file of candidates) {
      if (allGroupSelected) {
        next.delete(file.path);
      } else {
        next.add(file.path);
      }
    }
    selectedPaths = next;
  }

  async function applyChangelist(files: ChangedFile[], changelist: string | null) {
    if (!target || changelistRunning || files.length === 0) return;
    changelistRunning = true;
    changelistNotice = null;
    error = null;
    statusError = null;
    try {
      await setWorkspaceChangelist({
        working_copy_root: target.working_copy_root,
        file_paths: files.map((file) => file.path),
        changelist: changelist ?? undefined,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      changelistNotice = changelist
        ? `已将 ${files.length} 个文件加入 Changelist “${changelist}”`
        : `已将 ${files.length} 个文件移出 Changelist`;
      await refreshStatus(generation, true);
    } catch (caught) {
      error = caught as CommandError;
    } finally {
      changelistRunning = false;
    }
  }

  function assignChangelist(files: ChangedFile[]) {
    const eligibleFiles = files.filter(canUseChangelist);
    if (eligibleFiles.length === 0) return;
    const currentNames = new Set(
      eligibleFiles.flatMap((file) => file.changelist?.trim() ? [file.changelist.trim()] : []),
    );
    const defaultName = currentNames.size === 1 ? [...currentNames][0] : "";
    const name = window.prompt("请输入 Changelist 名称", defaultName);
    if (name === null) return;
    if (!name.trim()) {
      error = {
        code: "SVN_CHANGELIST_NAME_EMPTY",
        message: "Changelist 名称不能为空",
        detail: null,
        recoverable: true,
      };
      return;
    }
    void applyChangelist(eligibleFiles, name.trim());
  }

  function removeChangelist(files: ChangedFile[]) {
    const assignedFiles = files.filter(
      (file) => canUseChangelist(file) && Boolean(file.changelist?.trim()),
    );
    void applyChangelist(assignedFiles, null);
  }

  function assignSelectedChangelist() {
    assignChangelist(selectedChangelistFiles);
  }

  function removeSelectedChangelist() {
    removeChangelist(selectedAssignedChangelistFiles);
  }

  function clearFilePreview() {
    diffGeneration += 1;
    activeFilePath = null;
    selectedFileDiff = null;
    selectedFileContentDiff = null;
    diffLoading = false;
    diffError = null;
    diffPaneOpen = false;
  }

  async function showFilePreview(file: ChangedFile, currentGeneration = generation) {
    if (!target) {
      return;
    }
    const requestGeneration = ++diffGeneration;
    const workingCopyRoot = target.working_copy_root;
    activeFilePath = file.path;
    diffPaneHeight = constrainDiffPaneHeight(diffPaneHeight);
    diffPaneOpen = true;
    selectedFileDiff = null;
    selectedFileContentDiff = null;
    diffLoading = true;
    diffError = null;

    const request = {
      working_copy_root: workingCopyRoot,
      file_path: file.path,
      svn_executable: svnExecutable?.trim() || undefined,
    };
    const [diffResult, contentResult] = await Promise.allSettled([
      getFileDiff(request),
      getFileContentDiff({ ...request, max_bytes: LOG_FILE_DIFF_MAX_BYTES }),
    ]);
    if (requestGeneration !== diffGeneration || currentGeneration !== generation) {
      return;
    }

    selectedFileDiff = diffResult.status === "fulfilled" ? diffResult.value : null;
    selectedFileContentDiff =
      contentResult.status === "fulfilled" ? contentResult.value : null;
    if (diffResult.status === "rejected" && contentResult.status === "rejected") {
      diffError = contentResult.reason as CommandError;
    }
    diffLoading = false;
  }

  async function openConflict(file: ChangedFile) {
    if (!target || !isConflicted(file)) {
      return;
    }
    error = null;
    try {
      const root = target.working_copy_root.replace(/[\\/]+$/, "");
      const relativePath = file.path.replaceAll("/", "\\").replace(/^[\\/]+/, "");
      await launchConflictWindow({ target_path: `${root}\\${relativePath}` });
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  function diffPaneMaximumHeight() {
    return Math.max(180, (reviewPaneElement?.clientHeight || window.innerHeight) - 150);
  }

  function constrainDiffPaneHeight(height: number) {
    return Math.min(Math.max(height, 180), diffPaneMaximumHeight());
  }

  function startDiffPaneResize(event: MouseEvent) {
    stopMessagePaneResize();
    diffResizeStart = { y: event.clientY, height: diffPaneHeight };
    window.addEventListener("mousemove", resizeDiffPane);
    window.addEventListener("mouseup", stopDiffPaneResize);
    event.preventDefault();
  }

  function resizeDiffPane(event: MouseEvent) {
    if (!diffResizeStart) return;
    diffPaneHeight = constrainDiffPaneHeight(
      diffResizeStart.height + diffResizeStart.y - event.clientY,
    );
  }

  function stopDiffPaneResize() {
    diffResizeStart = null;
    window.removeEventListener("mousemove", resizeDiffPane);
    window.removeEventListener("mouseup", stopDiffPaneResize);
  }

  function adjustDiffPaneHeight(delta: number) {
    diffPaneHeight = constrainDiffPaneHeight(diffPaneHeight + delta);
  }

  function messagePaneMaximumWidth() {
    return Math.max(280, (commitLayoutElement?.clientWidth || window.innerWidth) - 360);
  }

  function constrainMessagePaneWidth(width: number) {
    return Math.min(Math.max(width, 280), messagePaneMaximumWidth());
  }

  function startMessagePaneResize(event: MouseEvent) {
    stopDiffPaneResize();
    messageResizeStart = { x: event.clientX, width: messagePaneWidth };
    window.addEventListener("mousemove", resizeMessagePane);
    window.addEventListener("mouseup", stopMessagePaneResize);
    event.preventDefault();
  }

  function resizeMessagePane(event: MouseEvent) {
    if (!messageResizeStart) return;
    messagePaneWidth = constrainMessagePaneWidth(
      messageResizeStart.width + messageResizeStart.x - event.clientX,
    );
  }

  function stopMessagePaneResize() {
    messageResizeStart = null;
    window.removeEventListener("mousemove", resizeMessagePane);
    window.removeEventListener("mouseup", stopMessagePaneResize);
  }

  function adjustMessagePaneWidth(delta: number) {
    messagePaneWidth = constrainMessagePaneWidth(messagePaneWidth + delta);
  }

  function openHistoryPicker() {
    history = readCommitMessageSettings(target?.working_copy_root).history;
    selectedHistoryMessage = history[0] ?? "";
    historyPickerOpen = true;
  }

  function closeHistoryPicker() {
    historyPickerOpen = false;
  }

  function useSelectedHistoryMessage() {
    const message = selectedHistoryMessage.trim();
    if (!message) {
      return;
    }
    commitMessage = message;
    historyPickerOpen = false;
  }

  async function openFileContextMenu(event: MouseEvent, file: ChangedFile) {
    event.preventDefault();
    if (operationRunning || scanning || initializing) {
      return;
    }
    revertCandidatePaths = [];
    revertCandidateIsBatch = false;
    fileContextMenu = {
      file,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 198)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)),
    };
    await tick();
    fileContextMenuElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  function closeFileContextMenu() {
    fileContextMenu = null;
  }

  function handleFileContextMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFileContextMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const buttons = Array.from(
      fileContextMenuElement?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (buttons.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    buttons[(currentIndex + offset + buttons.length) % buttons.length].focus();
  }

  async function requestContextFileRevert() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (!file) {
      return;
    }
    revertCandidatePaths = [file.path];
    revertCandidateIsBatch = false;
    await tick();
    revertDialogElement?.focus();
  }

  async function requestSelectedRevert() {
    if (operationRunning || scanning || initializing || selectedRevertableFiles.length === 0) {
      return;
    }
    revertCandidatePaths = selectedRevertableFiles.map((file) => file.path);
    revertCandidateIsBatch = true;
    await tick();
    revertDialogElement?.focus();
  }

  async function requestContextFileAdd() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (file) {
      await addFile(file);
    }
  }

  async function requestContextResolveConflict() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (file) {
      await openConflict(file);
    }
  }

  function requestContextAssignChangelist() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (file) assignChangelist([file]);
  }

  function requestContextRemoveChangelist() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (file) removeChangelist([file]);
  }

  async function requestContextFileDelete() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (!file || file.status === "deleted") {
      return;
    }
    deleteCandidate = file;
    await tick();
    deleteDialogElement?.focus();
  }

  function cancelDelete() {
    if (!deleteRunning) {
      deleteCandidate = null;
    }
  }

  async function confirmDelete() {
    if (!target || !deleteCandidate || operationRunning) {
      return;
    }
    const file = deleteCandidate;
    deleteCandidate = null;
    deletingPath = file.path;
    deleteNotice = null;
    deleteTask = null;
    error = null;
    statusError = null;
    try {
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind: file.status === "unversioned" ? "delete_unversioned_file" : "delete_path",
        file_path: file.path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      deleteTask = task;
      schedulePoll(task.task_id, "delete", generation, 0);
    } catch (caught) {
      deletingPath = null;
      error = caught as CommandError;
    }
  }

  function cancelRevert() {
    if (!revertRunning) {
      revertCandidatePaths = [];
      revertCandidateIsBatch = false;
    }
  }

  async function requestContextFileUnadd() {
    const file = fileContextMenu?.file ?? null;
    closeFileContextMenu();
    if (file) {
      await unaddFile(file);
    }
  }

  async function confirmRevert() {
    if (!target || revertCandidatePaths.length === 0 || operationRunning) {
      return;
    }
    const paths = [...revertCandidatePaths];
    const batch = revertCandidateIsBatch;
    revertCandidatePaths = [];
    revertCandidateIsBatch = false;
    revertingPaths = paths;
    revertNotice = null;
    revertTask = null;
    error = null;
    statusError = null;
    try {
      const task = batch
        ? await createSvnBatchOperationTask({
            working_copy_root: target.working_copy_root,
            kind: "revert_paths",
            file_paths: paths,
            svn_executable: svnExecutable?.trim() || undefined,
          })
        : await createSvnOperationTask({
            working_copy_root: target.working_copy_root,
            kind: "revert_file",
            file_path: paths[0],
            svn_executable: svnExecutable?.trim() || undefined,
          });
      revertTask = task;
      schedulePoll(task.task_id, "revert", generation, 0);
    } catch (caught) {
      revertingPaths = [];
      error = caught as CommandError;
    }
  }

  async function addFile(file: ChangedFile) {
    if (!target || file.status !== "unversioned" || operationRunning || scanning || initializing) {
      return;
    }
    addingPath = file.path;
    addAction = "add";
    addTask = null;
    addNotice = null;
    error = null;
    statusError = null;
    try {
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind: "add_file",
        file_path: file.path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      addTask = task;
      schedulePoll(task.task_id, "add", generation, 0);
    } catch (caught) {
      addingPath = null;
      error = caught as CommandError;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    if (outOfDateDialogOpen) {
      outOfDateDialogOpen = false;
    } else if (deleteCandidate) {
      cancelDelete();
    } else if (revertCandidatePaths.length > 0) {
      cancelRevert();
    } else if (historyPickerOpen) {
      closeHistoryPicker();
    } else if (fileContextMenu) {
      closeFileContextMenu();
    } else if (diffPaneOpen) {
      clearFilePreview();
    } else if (!operationRunning) {
      void getCurrentWindow().close();
    } else {
      return;
    }
    event.preventDefault();
  }

  async function submitCommit() {
    if (commitDisabled || !target) {
      return;
    }
    error = null;
    statusError = null;
    const nextCommittedBytes = selectedBytes;
    closeCurrentCommitAfterCompletion = closeAfterCompletion;
    submittedCommitTaskId = null;
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
      submittedCommitTaskId = task.task_id;
      committedBytes = nextCommittedBytes;
      recordedTaskId = null;
      autoCloseTriggered = false;
      schedulePoll(task.task_id, "commit", generation, 0);
    } catch (caught) {
      closeCurrentCommitAfterCompletion = false;
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
        schedulePoll(commitTask.task_id, "commit", generation, 200);
      } else {
        clearPollTimer();
      }
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  async function switchToUpdate() {
    if (!target || typeof launchUpdateWindow !== "function") {
      error = {
        code: "UPDATE_WINDOW_UNAVAILABLE",
        message: "无法启动 Update 窗口",
        detail: "请重新打开 NovaSVN 后重试。",
        recoverable: true,
      };
      return;
    }
    try {
      await launchUpdateWindow({
        target_path: target.target_path,
        return_action: "commit",
      });
      setPendingCommitMessage(commitMessage, false);
      outOfDateDialogOpen = false;
      await getCurrentWindow().close();
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  async function unaddFile(file: ChangedFile) {
    if (!target || file.status !== "added" || operationRunning || scanning || initializing) {
      return;
    }
    addingPath = file.path;
    addAction = "unadd";
    addTask = null;
    addNotice = null;
    error = null;
    statusError = null;
    try {
      const task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind: "unadd_file",
        file_path: file.path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      addTask = task;
      schedulePoll(task.task_id, "add", generation, 0);
    } catch (caught) {
      addingPath = null;
      error = caught as CommandError;
    }
  }

  async function stopAdd() {
    if (!addTask || !addRunning) {
      return;
    }
    try {
      addTask = await cancelTask(addTask.task_id);
      if (isTaskRunning(addTask)) {
        schedulePoll(addTask.task_id, "add", generation, 200);
      } else {
        clearPollTimer();
        addingPath = null;
      }
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  async function stopDelete() {
    if (!deleteTask || !deleteRunning) {
      return;
    }
    try {
      deleteTask = await cancelTask(deleteTask.task_id);
      if (isTaskRunning(deleteTask)) {
        schedulePoll(deleteTask.task_id, "delete", generation, 200);
      } else {
        clearPollTimer();
        const deletedPath = deletingPath;
        deletingPath = null;
        if (deleteTask.status === "success") {
          deleteNotice = deletedPath ? `已 Delete ${deletedPath}` : "Delete 完成";
          await refreshStatus(generation, true);
        }
      }
    } catch (caught) {
      error = caught as CommandError;
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
        const reverted = [...revertingPaths];
        revertingPaths = [];
        if (revertTask.status === "success") {
          revertNotice = revertCompletionNotice(reverted);
          await refreshStatus(generation, true);
        }
      }
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  function schedulePoll(
    taskId: string,
    role: "commit" | "revert" | "add" | "delete",
    currentGeneration: number,
    delay: number,
  ) {
    clearPollTimer();
    pollTimer = window.setTimeout(() => void pollTask(taskId, role, currentGeneration), delay);
  }

  async function pollTask(
    taskId: string,
    role: "commit" | "revert" | "add" | "delete",
    currentGeneration: number,
  ) {
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      if (role === "commit") {
        commitTask = task;
      } else if (role === "revert") {
        revertTask = task;
      } else if (role === "delete") {
        deleteTask = task;
      } else {
        addTask = task;
      }
      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, role, currentGeneration, 350);
        return;
      }
      clearPollTimer();
      if (role === "revert") {
        const reverted = [...revertingPaths];
        revertingPaths = [];
        if (task.status === "success") {
          revertNotice = revertCompletionNotice(reverted);
          await refreshStatus(currentGeneration, true);
        }
        return;
      }
      if (role === "delete") {
        const deletedPath = deletingPath;
        deletingPath = null;
        if (task.status === "success") {
          deleteNotice = deletedPath ? `已 Delete ${deletedPath}` : "Delete 完成";
          await refreshStatus(currentGeneration, true);
        }
        return;
      }
      if (role === "add") {
        const addedPath = addingPath;
        addingPath = null;
        if (task.status === "success") {
          const actionLabel = addAction === "unadd" ? "Unadd" : "Add";
          addNotice = addedPath ? `已 ${actionLabel} ${addedPath}` : `${actionLabel} 完成`;
          await refreshStatus(currentGeneration);
        }
        return;
      }
      if (task.status === "success" && recordedTaskId !== task.task_id) {
        recordedTaskId = task.task_id;
        recordCommitHistory(commitMessage);
        await refreshStatus(currentGeneration);
        await maybeCloseCompletedCommit();
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

  async function maybeCloseCompletedCommit() {
    if (
      !closeCurrentCommitAfterCompletion ||
      autoCloseTriggered ||
      commitTask?.status !== "success" ||
      submittedCommitTaskId !== commitTask.task_id ||
      recordedTaskId !== commitTask.task_id ||
      scanning
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
    if (commitTask?.status !== "success") {
      closeCurrentCommitAfterCompletion = closeAfterCompletion;
    }
  }

  function readCloseAfterCompletionSetting() {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(COMMIT_AUTO_CLOSE_SETTING_KEY) === "true";
    } catch {
      return false;
    }
  }

  function writeCloseAfterCompletionSetting(value: boolean) {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(COMMIT_AUTO_CLOSE_SETTING_KEY, String(value));
    } catch {
      // Preference persistence must not interfere with Commit.
    }
  }

  function taskStatusLabel(task: Task | null, isInitializing: boolean, role: "commit" | "revert" | "add" | "unadd" | "delete" = "commit") {
    switch (task?.status) {
      case "pending":
        return "等待执行";
      case "running":
        return role === "add" ? "正在 Add" : role === "unadd" ? "正在 Unadd" : role === "delete" ? "正在 Delete" : role === "revert" ? "正在 Revert" : "正在提交";
      case "success":
        return role === "add" ? "Add 完成" : role === "unadd" ? "Unadd 完成" : role === "delete" ? "Delete 完成" : role === "revert" ? "Revert 完成" : "提交完成";
      case "failed":
        return role === "add" ? "Add 失败" : role === "unadd" ? "Unadd 失败" : role === "delete" ? "Delete 失败" : role === "revert" ? "Revert 失败" : "提交失败";
      case "cancelled":
        return "已取消";
      case "interrupted":
        return "已中断";
      default:
        return isInitializing ? "准备中" : "未提交";
    }
  }

  function isCommittable(file: ChangedFile) {
    if (isConflicted(file) || ["missing", "obstructed", "unversioned", "external"].includes(file.status)) {
      return false;
    }
    return file.property_changed || !["normal", "none"].includes(file.status);
  }

  function isVisibleFile(file: ChangedFile) {
    return isCommittable(file) || file.status === "unversioned" || isConflicted(file);
  }

  function isConflicted(file: ChangedFile) {
    return file.status === "conflicted" || Boolean(file.conflict_kind);
  }

  function isRevertableFile(file: ChangedFile) {
    return isCommittable(file);
  }

  function canUseChangelist(file: ChangedFile) {
    return !["unversioned", "external"].includes(file.status);
  }

  function revertCompletionNotice(paths: string[]) {
    if (paths.length === 1) {
      return `已 Revert ${paths[0]}`;
    }
    return paths.length > 1 ? `已 Revert ${paths.length} 个项目` : "Revert 完成";
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

  /** 与 Log 窗口一致的单字母变更标记（A/M/D 等）。 */
  function statusMark(file: ChangedFile): string {
    if (isConflicted(file)) {
      return "C";
    }
    const marks: Record<string, string> = {
      modified: "M",
      added: "A",
      deleted: "D",
      replaced: "R",
      property_modified: "M",
      unversioned: "?",
      missing: "!",
      obstructed: "~",
      conflicted: "C",
      ignored: "I",
      external: "X",
      normal: " ",
      none: " ",
    };
    if (["normal", "none", "property_modified"].includes(file.status) && file.property_changed) {
      return "M";
    }
    if (file.property_changed && !marks[file.status]) {
      return "M";
    }
    return marks[file.status] ?? (file.status.slice(0, 1).toUpperCase() || "?");
  }

  function statusMarkTitle(file: ChangedFile): string {
    if (isConflicted(file)) {
      return file.conflict_kind === "property" ? "属性冲突" : "冲突";
    }
    const titles: Record<string, string> = {
      modified: "修改",
      added: "新增",
      deleted: "删除",
      replaced: "替换",
      property_modified: "属性修改",
      unversioned: "未版本控制",
      missing: "丢失",
      obstructed: "受阻",
      conflicted: "冲突",
      ignored: "已忽略",
      external: "外部",
    };
    if (["normal", "none", "property_modified"].includes(file.status) && file.property_changed) {
      return "属性修改";
    }
    if (file.property_changed && titles[file.status]) {
      return `${titles[file.status]} + 属性`;
    }
    return titles[file.status] ?? file.status;
  }

  function logKind(message: string) {
    return /^\s*([ACDMRUG!~])\s+/.exec(message)?.[1] ?? "info";
  }

  function commandErrorText(value: CommandError | null) {
    return value
      ? [value.code, value.message, value.detail].filter(Boolean).join("\n")
      : null;
  }

  function isOutOfDateError(value: string | null) {
    if (!value) {
      return false;
    }
    const normalized = value.toLowerCase();
    return [
      "out of date",
      "out-of-date",
      "outdated",
      "e155011",
      "e170004",
      "e160028",
      "过时",
    ].some((marker) => normalized.includes(marker));
  }
</script>

<main class="standalone-commit" data-theme={resolvedTheme} aria-label="NovaSVN Commit">
  <header class="commit-titlebar">
    <div>
      <h1>NovaSVN Commit</h1>
      <p title={targetPath}>{target?.target_path ?? targetPath}</p>
    </div>
    <div class="commit-actions">
      <span class:running={operationRunning}>{taskStatus}</span>
      {#if commitRunning}
        <button type="button" on:click={stopCommit}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else if addRunning}
        <button type="button" on:click={stopAdd}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else if deleteRunning}
        <button type="button" on:click={stopDelete}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else if revertRunning}
        <button type="button" on:click={stopRevert}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else}
        <button type="button" disabled={initializing || scanning || operationRunning} on:click={startCommit}>
          <RefreshCw size={15} aria-hidden="true" /> 刷新
        </button>
      {/if}
    </div>
  </header>

  <section class="commit-summary" aria-label="提交摘要">
    <span>目标 <strong>{target?.relative_path ?? "工作副本根目录"}</strong></span>
    <span>Revision <strong>{status?.revision_range ?? target?.revision ?? "-"}</strong></span>
    <span>已选择 <strong>{selectedCount} / {committableFiles.length}</strong></span>
    <OperationMetrics
      task={commitTask}
      totalBytes={displayedCommitBytes}
      label="总提交量"
      active={commitRunning}
    />
  </section>

  <section
    class="commit-notices"
    class:has-notices={Boolean(error || statusError || commitTask?.error || addTask?.error || deleteTask?.error || revertTask?.error || addNotice || deleteNotice || revertNotice || changelistNotice)}
    aria-label="Commit 错误"
  >
    <ErrorNotice {error} />
    <ErrorNotice error={statusError} />
    {#if commitTask?.error}
      <div class="inline-error" role="alert">{commitTask.error}</div>
    {/if}
    {#if addTask?.error}
      <div class="inline-error" role="alert">{addTask.error}</div>
    {/if}
    {#if deleteTask?.error}
      <div class="inline-error" role="alert">{deleteTask.error}</div>
    {/if}
    {#if revertTask?.error}
      <div class="inline-error" role="alert">{revertTask.error}</div>
    {/if}
    {#if revertNotice}
      <div class="revert-notice" role="status">{revertNotice}</div>
    {/if}
    {#if addNotice}
      <div class="revert-notice" role="status">{addNotice}</div>
    {/if}
    {#if deleteNotice}
      <div class="revert-notice" role="status">{deleteNotice}</div>
    {/if}
    {#if changelistNotice}
      <div class="revert-notice" role="status">{changelistNotice}</div>
    {/if}
  </section>

  <div
    bind:this={commitLayoutElement}
    class="commit-layout"
    style={`--message-pane-width: ${messagePaneWidth}px`}
  >
    <div
      bind:this={reviewPaneElement}
      class="review-pane"
      class:diff-open={diffPaneOpen}
      style={`--diff-pane-height: ${diffPaneHeight}px`}
    >
      <section class="file-pane" aria-label="选择提交文件">
        <header>
          <div>
            <h2>提交文件</h2>
            <p>
              {committableFiles.length} 个可提交文件{conflictFiles.length > 0
                ? ` · ${conflictFiles.length} 个冲突待处理`
                : ""}{unversionedFiles.length > 0 ? ` · ${unversionedFiles.length} 个未版本控制` : ""}
            </p>
          </div>
          <div class="selection-actions">
            <button
              type="button"
              on:click={assignSelectedChangelist}
              disabled={operationRunning || scanning || initializing || selectedChangelistFiles.length === 0}
            >
              <Plus size={15} aria-hidden="true" /> 加入 Changelist...
            </button>
            <button
              type="button"
              on:click={removeSelectedChangelist}
              disabled={operationRunning || scanning || initializing || selectedAssignedChangelistFiles.length === 0}
            >
              <Minus size={15} aria-hidden="true" /> 移出 Changelist
            </button>
            <button
              type="button"
              class="selection-revert-action"
              on:click={requestSelectedRevert}
              disabled={operationRunning || scanning || initializing || selectedRevertableFiles.length === 0}
            >
              <RotateCcw size={15} aria-hidden="true" /> Revert 已选
            </button>
            <button type="button" on:click={selectAll} disabled={operationRunning || committableFiles.length === 0 || allSelected}>
              <CheckSquare size={15} aria-hidden="true" /> 全选
            </button>
            <button type="button" on:click={clearSelection} disabled={operationRunning || selectedCount === 0}>
              清除
            </button>
          </div>
        </header>
        <div class="file-list">
          {#each fileGroups as group (group.name)}
            {@const selectableFiles = groupCommittableFiles(group.files)}
            {@const groupSelectionCount = groupSelectedCount(group.files)}
            <section class="file-group" aria-label={`Changelist ${group.label}`}>
              <header class="file-group-header">
                <input
                  type="checkbox"
                  aria-label={`选择 Changelist ${group.label}`}
                  checked={selectableFiles.length > 0 && groupSelectionCount === selectableFiles.length}
                  indeterminate={groupSelectionCount > 0 && groupSelectionCount < selectableFiles.length}
                  disabled={operationRunning || scanning || initializing || selectableFiles.length === 0}
                  on:change={() => toggleGroupSelection(group.files)}
                />
                <strong title={group.name || undefined}>{group.label}</strong>
                <span>{groupSelectionCount} / {selectableFiles.length} 个可提交</span>
              </header>
              {#each group.files as file (file.path)}
                <div
                  class="file-item"
                  class:active={activeFilePath === file.path}
                  class:unversioned={file.status === "unversioned"}
                  class:conflicted={isConflicted(file)}
                  class:reverting={revertingPaths.includes(file.path)}
                  class:adding={addingPath === file.path}
                  class:deleting={deletingPath === file.path}
                  role="group"
                  aria-label={`提交文件 ${file.path}`}
                  on:contextmenu={(event) => openFileContextMenu(event, file)}
                >
                  {#if isCommittable(file)}
                    <input
                      type="checkbox"
                      aria-label={file.path}
                      checked={selectedPaths.has(file.path)}
                      on:change={() => toggleFile(file.path)}
                      disabled={operationRunning || scanning || initializing}
                    />
                  {:else}
                    <span class="file-selection-placeholder" aria-hidden="true"></span>
                  {/if}
                  <button
                    type="button"
                    class="file-preview-trigger"
                    class:active={activeFilePath === file.path}
                    aria-label={`查看修改 ${file.path}`}
                    aria-pressed={activeFilePath === file.path}
                    on:click={() => showFilePreview(file)}
                  >
                    <span
                      class="file-status"
                      data-action={statusMark(file)}
                      title={statusMarkTitle(file)}
                    >{statusMark(file)}</span>
                    <span class="file-path" title={file.path}>{file.path}</span>
                  </button>
                  {#if isConflicted(file)}
                    <button
                      type="button"
                      class="file-conflict-action"
                      aria-label={`处理冲突 ${file.path}`}
                      disabled={operationRunning || scanning || initializing}
                      on:click={() => openConflict(file)}
                    >
                      <GitMergeConflict size={14} aria-hidden="true" /> 处理冲突
                    </button>
                  {:else if file.status === "unversioned"}
                    <button
                      type="button"
                      class="file-add-action"
                      aria-label={`Add ${file.path}`}
                      disabled={operationRunning || scanning || initializing}
                      on:click={() => addFile(file)}
                    >
                      <Plus size={14} aria-hidden="true" /> Add
                    </button>
                  {:else if file.status === "added"}
                    <button
                      type="button"
                      class="file-add-action"
                      aria-label={`Unadd ${file.path}`}
                      disabled={operationRunning || scanning || initializing}
                      on:click={() => unaddFile(file)}
                    >
                      <Minus size={14} aria-hidden="true" /> Unadd
                    </button>
                  {/if}
                </div>
              {/each}
            </section>
          {:else}
            {#if scanning || initializing}
              <div class="empty-files" role="status">正在扫描工作副本...</div>
            {:else}
              <div class="empty-files">目标范围内没有可提交或待 Add 的文件</div>
            {/if}
          {/each}
        </div>
      </section>

      {#if diffPaneOpen}
        <div
          role="slider"
          tabindex="0"
          class="diff-pane-resizer"
          aria-label="调整 Diff 区域高度"
          aria-orientation="vertical"
          aria-valuemin="180"
          aria-valuemax={diffPaneMaximumHeight()}
          aria-valuenow={diffPaneHeight}
          on:mousedown={startDiffPaneResize}
          on:keydown={(event) => {
            if (event.key === "ArrowUp") {
              adjustDiffPaneHeight(16);
              event.preventDefault();
            } else if (event.key === "ArrowDown") {
              adjustDiffPaneHeight(-16);
              event.preventDefault();
            } else if (event.key === "Home") {
              diffPaneHeight = 180;
              event.preventDefault();
            } else if (event.key === "End") {
              diffPaneHeight = diffPaneMaximumHeight();
              event.preventDefault();
            }
          }}
        ></div>
        <section class="diff-pane" aria-label="修改内容">
          <header>
            <div>
              <h2>修改内容</h2>
              <p title={activeFilePath ?? undefined}>{activeFilePath}</p>
            </div>
            <button
              type="button"
              class="icon-button diff-close"
              aria-label="关闭 Diff"
              title="关闭 Diff"
              on:click={clearFilePreview}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div class="diff-content">
            {#if diffLoading}
              <div class="empty-diff" role="status">正在读取修改内容...</div>
            {:else if diffError}
              <ErrorNotice error={diffError} />
            {:else if selectedFileContentDiff?.is_image}
              <ImageDiffViewer contentDiff={selectedFileContentDiff} />
            {:else if selectedFileContentDiff?.too_large}
              <div class="empty-diff">
                文件内容超过 {Math.round(selectedFileContentDiff.max_bytes / 1024 / 1024)} MB，无法在窗口中预览
              </div>
            {:else if selectedFileContentDiff?.binary || selectedFileDiff?.binary}
              <div class="empty-diff">二进制文件无法预览文本修改</div>
            {:else if selectedFileContentDiff && selectedFileContentDiff.original_text !== selectedFileContentDiff.modified_text}
              <MonacoDiffViewer
                contentDiff={selectedFileContentDiff}
                inlineMode={diffMode === "inline"}
                {showWhitespace}
                theme={resolvedTheme}
              />
            {:else if selectedPropertyContentDiff}
              <MonacoDiffViewer
                contentDiff={selectedPropertyContentDiff}
                inlineMode={diffMode === "inline"}
                {showWhitespace}
                theme={resolvedTheme}
              />
            {:else if selectedFileDiff?.text}
              <RawDiffViewer text={selectedFileDiff.text} theme={resolvedTheme} />
            {:else}
              <div class="empty-diff">没有可显示的文本修改</div>
            {/if}
          </div>
        </section>
      {/if}
    </div>

    <div
      role="slider"
      tabindex="0"
      class="message-pane-resizer"
      aria-label="调整提交信息侧栏宽度"
      aria-orientation="horizontal"
      aria-valuemin="280"
      aria-valuemax={messagePaneMaximumWidth()}
      aria-valuenow={messagePaneWidth}
      on:mousedown={startMessagePaneResize}
      on:keydown={(event) => {
        if (event.key === "ArrowLeft") {
          adjustMessagePaneWidth(16);
          event.preventDefault();
        } else if (event.key === "ArrowRight") {
          adjustMessagePaneWidth(-16);
          event.preventDefault();
        } else if (event.key === "Home") {
          messagePaneWidth = 280;
          event.preventDefault();
        } else if (event.key === "End") {
          messagePaneWidth = messagePaneMaximumWidth();
          event.preventDefault();
        }
      }}
    ></div>
    <aside class="message-pane" aria-label="提交信息">
      <header>
        <div>
          <h2>提交信息</h2>
          <p>提交前请确认文件选择和日志内容</p>
        </div>
        <button type="button" on:click={openHistoryPicker}>
          <History size={15} aria-hidden="true" /> 获取历史日志
        </button>
      </header>
      <textarea
        bind:value={commitMessage}
        rows="8"
        placeholder="请输入提交日志"
        aria-label="提交日志"
        disabled={operationRunning}
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

  <footer class="commit-footer">
    <label>
      <input
        type="checkbox"
        checked={closeAfterCompletion}
        disabled={autoCloseTriggered}
        on:change={handleCloseAfterCompletionChange}
      />
      <span>提交完成后自动关闭</span>
    </label>
  </footer>

{#if fileContextMenu}
  <div
    bind:this={fileContextMenuElement}
    class="file-context-menu"
    role="menu"
    tabindex="-1"
    aria-label={`文件菜单 ${fileContextMenu.file.path}`}
    style={`left: ${fileContextMenu.x}px; top: ${fileContextMenu.y}px`}
    on:click|stopPropagation
    on:keydown={handleFileContextMenuKeydown}
  >
    {#if isConflicted(fileContextMenu.file)}
      <button type="button" role="menuitem" on:click={requestContextResolveConflict}>
        <GitMergeConflict size={15} aria-hidden="true" /> 处理冲突
      </button>
    {/if}
    {#if fileContextMenu.file.status === "added"}
      <button type="button" role="menuitem" on:click={requestContextFileUnadd}>
        <Minus size={15} aria-hidden="true" /> Unadd
      </button>
    {:else if fileContextMenu.file.status === "unversioned"}
      <button type="button" role="menuitem" on:click={requestContextFileAdd}>
        <Plus size={15} aria-hidden="true" /> Add
      </button>
    {:else if isRevertableFile(fileContextMenu.file)}
      <button type="button" role="menuitem" class="danger-action" on:click={requestContextFileRevert}>
        <RotateCcw size={15} aria-hidden="true" /> Revert
      </button>
    {/if}
    {#if canUseChangelist(fileContextMenu.file)}
      <button type="button" role="menuitem" on:click={requestContextAssignChangelist}>
        <Plus size={15} aria-hidden="true" /> 加入 Changelist...
      </button>
      {#if fileContextMenu.file.changelist?.trim()}
        <button type="button" role="menuitem" on:click={requestContextRemoveChangelist}>
          <Minus size={15} aria-hidden="true" /> 移出 Changelist
        </button>
      {/if}
    {/if}
    <div role="separator"></div>
    <button
      type="button"
      role="menuitem"
      class="danger-action"
      disabled={fileContextMenu.file.status === "deleted"}
      title={fileContextMenu.file.status === "deleted" ? "文件已经处于删除状态" : undefined}
      on:click={requestContextFileDelete}
    >
      <Trash2 size={15} aria-hidden="true" /> Delete
    </button>
  </div>
{/if}

{#if historyPickerOpen}
  <div class="history-backdrop" role="presentation" on:click|self={closeHistoryPicker}>
    <div
      class="history-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="选择历史提交日志"
    >
      <header>
        <div>
          <h2>选择历史提交日志</h2>
          <p>历史日志来自本地缓存</p>
        </div>
        <button type="button" class="dialog-close" aria-label="关闭历史日志" title="关闭" on:click={closeHistoryPicker}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {#if history.length > 0}
        <select
          class="history-select"
          size="8"
          aria-label="历史提交日志"
          bind:value={selectedHistoryMessage}
          on:dblclick={useSelectedHistoryMessage}
        >
          {#each history as message}
            <option value={message}>{message}</option>
          {/each}
        </select>
      {:else}
        <div class="history-empty">本地暂无缓存的提交日志</div>
      {/if}
      <footer>
        <button type="button" on:click={closeHistoryPicker}>取消</button>
        <button
          type="button"
          class="primary"
          disabled={!selectedHistoryMessage.trim()}
          on:click={useSelectedHistoryMessage}
        >
          填充提交日志
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if deleteCandidate}
  <div class="revert-backdrop" role="presentation" on:click|self={cancelDelete}>
    <div
      bind:this={deleteDialogElement}
      class="revert-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      tabindex="-1"
    >
      <header>
        <div>
          <h2 id="delete-dialog-title">确认 Delete</h2>
          <p>
            {deleteCandidate.status === "unversioned"
              ? "未版本控制文件将从磁盘永久删除，NovaSVN 无法撤销此操作。"
              : "文件将被标记为 SVN 删除，并保留为待提交变更。"}
          </p>
        </div>
        <button type="button" class="dialog-close" aria-label="关闭 Delete 确认" title="关闭" on:click={cancelDelete}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <code title={deleteCandidate.path}>{deleteCandidate.path}</code>
      <footer>
        <button type="button" on:click={cancelDelete}>取消</button>
        <button type="button" class="danger-primary" on:click={confirmDelete}>
          <Trash2 size={15} aria-hidden="true" /> 确认 Delete
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if revertCandidatePaths.length > 0}
  <div class="revert-backdrop" role="presentation" on:click|self={cancelRevert}>
    <div
      bind:this={revertDialogElement}
      class="revert-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revert-dialog-title"
      tabindex="-1"
    >
      <header>
        <div>
          <h2 id="revert-dialog-title">确认 Revert</h2>
          <p>
            {revertCandidatePaths.length === 1
              ? "该项目的本地修改将被丢弃，NovaSVN 无法撤销此操作。"
              : `选中的 ${revertCandidatePaths.length} 个项目的本地修改将被丢弃，NovaSVN 无法撤销此操作。`}
          </p>
        </div>
        <button type="button" class="dialog-close" aria-label="关闭 Revert 确认" title="关闭" on:click={cancelRevert}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div class="revert-path-list" aria-label="将 Revert 的项目">
        {#each revertCandidatePaths as path (path)}
          <code title={path}>{path}</code>
        {/each}
      </div>
      <footer>
        <button type="button" on:click={cancelRevert}>取消</button>
        <button type="button" class="danger-primary" on:click={confirmRevert}>
          <RotateCcw size={15} aria-hidden="true" /> 确认 Revert
        </button>
      </footer>
    </div>
  </div>
{/if}
{#if outOfDateDialogOpen}
  <div class="revert-backdrop" role="presentation" on:click|self={() => (outOfDateDialogOpen = false)}>
    <div
      class="revert-dialog out-of-date-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="out-of-date-dialog-title"
    >
      <header>
        <div>
          <h2 id="out-of-date-dialog-title">提交失败：工作副本已过期</h2>
          <p>服务器上的版本更新了，需要先 Update 工作副本，然后再重新提交。</p>
        </div>
        <button
          type="button"
          class="dialog-close"
          aria-label="关闭过期提示"
          title="关闭"
          on:click={() => (outOfDateDialogOpen = false)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <pre class="out-of-date-detail">{commitTask?.error}</pre>
      <footer>
        <button type="button" on:click={() => (outOfDateDialogOpen = false)}>稍后处理</button>
        <button type="button" class="primary" on:click={switchToUpdate}>
          更新后返回提交
        </button>
      </footer>
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
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
    -webkit-user-select: none;
    isolation: isolate;
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
  .selection-actions { flex-wrap: wrap; justify-content: flex-end; }
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
  .revert-notice { border: 1px solid #91bf9a; background: #eff9f1; color: #276b35; padding: 8px 10px; font-size: 12px; }
  [data-theme="dark"] .inline-error { background: #3b2424; color: #ffb0b0; }
  [data-theme="dark"] .revert-notice { background: #213629; color: #9de3aa; }
  .commit-layout { display: grid; grid-template-columns: minmax(320px, 1fr) 8px minmax(280px, var(--message-pane-width)); min-height: 0; padding: 14px 22px 20px; }
  .commit-footer { display: flex; align-items: center; min-width: 0; border-top: 1px solid var(--border); background: var(--panel); padding: 8px 22px; }
  .commit-footer label { display: inline-flex; align-items: center; gap: 7px; color: var(--secondary); font-size: 12px; cursor: pointer; }
  .commit-footer input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
  .review-pane { display: grid; grid-template-rows: minmax(0, 1fr); min-width: 0; min-height: 0; }
  .review-pane.diff-open { grid-template-rows: minmax(140px, 1fr) 8px minmax(180px, var(--diff-pane-height)); }
  .file-pane, .diff-pane, .message-pane { min-width: 0; min-height: 0; border: 1px solid var(--border); background: var(--panel); }
  .file-pane { display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .diff-pane { display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .message-pane { display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow: auto; }
  .file-pane > header, .diff-pane > header, .message-pane > header, .task-output > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 13px 14px; border-bottom: 1px solid var(--border); }
  .message-pane > header { padding: 0 0 12px; }
  .file-pane header p, .diff-pane header p, .message-pane header p { margin-top: 4px; color: var(--secondary); font-size: 12px; }
  .diff-pane header p { overflow: hidden; max-width: 52vw; text-overflow: ellipsis; white-space: nowrap; }
  .diff-pane-resizer, .message-pane-resizer { position: relative; z-index: 2; outline: 0; }
  .diff-pane-resizer { cursor: row-resize; }
  .message-pane-resizer { cursor: col-resize; }
  .diff-pane-resizer::after, .message-pane-resizer::after { content: ""; position: absolute; background: var(--border); transition: background .12s ease; }
  .diff-pane-resizer::after { inset: 3px 0; }
  .message-pane-resizer::after { inset: 0 3px; }
  .diff-pane-resizer:hover::after, .diff-pane-resizer:focus-visible::after, .message-pane-resizer:hover::after, .message-pane-resizer:focus-visible::after { background: var(--accent); }
  button.icon-button { width: 30px; min-width: 30px; min-height: 30px; padding: 0; }
  .file-list { overflow: auto; padding: 6px; }
  .file-group { margin-bottom: 7px; border: 1px solid color-mix(in srgb, var(--border) 75%, transparent); }
  .file-group:last-child { margin-bottom: 0; }
  .file-group-header { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 34px; padding: 0 8px; border-bottom: 1px solid var(--border); background: var(--panel-subtle); font-size: 12px; }
  .file-group-header input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); }
  .file-group-header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-group-header span { color: var(--secondary); font-size: 11px; }
  .file-item { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 36px; padding: 0 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); font-size: 12px; }
  .file-item:last-child { border-bottom: 0; }
  .file-item:hover { background: var(--panel-subtle); }
  .file-item.active { background: color-mix(in srgb, var(--accent) 10%, var(--panel)); }
  .file-item.reverting { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
  .file-item.adding { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
  .file-item.deleting { background: color-mix(in srgb, #b93d3d 12%, var(--panel)); }
  .file-item.conflicted { background: color-mix(in srgb, #c64040 8%, var(--panel)); }
  .file-item input { width: 15px; height: 15px; accent-color: var(--accent); }
  .file-selection-placeholder { width: 15px; height: 15px; }
  button.file-preview-trigger { display: grid; grid-template-columns: 22px minmax(0, 1fr); justify-content: stretch; gap: 8px; width: 100%; min-height: 35px; border: 0; border-radius: 0; padding: 5px 0; background: transparent; color: var(--text); text-align: left; }
  button.file-preview-trigger:hover:not(:disabled) { border-color: transparent; color: var(--text); }
  button.file-preview-trigger:focus-visible { outline-offset: 0; }
  .file-status {
    display: inline-grid;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    font-family: Consolas, "Courier New", monospace;
    line-height: 1;
    background: color-mix(in srgb, var(--accent) 12%, var(--panel-subtle));
    color: var(--accent);
  }
  .file-status[data-action="A"] { background: #dff2e4; color: #24733a; }
  .file-status[data-action="M"] { background: #fff0c7; color: #805900; }
  .file-status[data-action="D"] { background: #fbe0df; color: #a12f2b; }
  .file-status[data-action="R"] { background: #e4e9ff; color: #3b4db8; }
  .file-status[data-action="C"] { background: #fbe0df; color: #a12f2b; }
  .file-status[data-action="?"] { background: color-mix(in srgb, var(--secondary) 16%, var(--panel-subtle)); color: var(--secondary); }
  .file-status[data-action="!"],
  .file-status[data-action="~"] { background: #fff0c7; color: #805900; }
  .standalone-commit[data-theme="dark"] .file-status[data-action="A"] { background: #1f4b2d; color: #8fdaa2; }
  .standalone-commit[data-theme="dark"] .file-status[data-action="M"] { background: #4b3b16; color: #f6cf73; }
  .standalone-commit[data-theme="dark"] .file-status[data-action="D"],
  .standalone-commit[data-theme="dark"] .file-status[data-action="C"] { background: #522725; color: #ffaaa7; }
  .standalone-commit[data-theme="dark"] .file-status[data-action="R"] { background: #2a3358; color: #a8b5ff; }
  .standalone-commit[data-theme="dark"] .file-status[data-action="!"],
  .standalone-commit[data-theme="dark"] .file-status[data-action="~"] { background: #4b3b16; color: #f6cf73; }
  .file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-add-action { min-height: 27px; padding: 3px 8px; }
  .file-conflict-action { min-height: 27px; border-color: color-mix(in srgb, #c64040 55%, var(--border)); color: #a12a2a; padding: 3px 8px; }
  .diff-content { min-width: 0; min-height: 0; overflow: hidden; }
  .diff-content :global(.monaco-diff-viewer), .diff-content :global(.raw-diff-viewer) { width: 100%; height: 100%; border: 0; border-radius: 0; }
  .empty-files, .empty-diff, .empty-output { padding: 28px 16px; color: var(--secondary); text-align: center; font-size: 12px; }
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

  .file-context-menu {
    position: fixed;
    z-index: 3000;
    display: grid;
    width: 190px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel);
    padding: 4px;
  }

  .file-context-menu button {
    justify-content: flex-start;
    width: 100%;
    border-color: transparent;
    background: transparent;
  }

  .file-context-menu button:hover,
  .file-context-menu button:focus-visible {
    border-color: transparent;
    background: var(--panel-subtle);
  }

  .file-context-menu [role="separator"] {
    height: 1px;
    margin: 3px 5px;
    background: var(--border);
  }

  .danger-action,
  .danger-primary {
    color: #a12a2a;
  }

  .selection-revert-action {
    border-color: color-mix(in srgb, #b93d3d 45%, var(--border));
    color: #a12a2a;
  }

  .history-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3100;
    display: grid;
    background: rgb(10 18 26 / 35%);
    padding: 24px;
    place-items: center;
  }

  .history-dialog {
    display: grid;
    grid-template-rows: auto minmax(180px, 1fr) auto;
    width: min(560px, 100%);
    max-height: min(560px, 100%);
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    padding: 16px;
  }

  .history-dialog > header,
  .history-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .history-dialog > header {
    align-items: flex-start;
    padding-bottom: 12px;
  }

  .history-dialog > header p {
    margin-top: 5px;
    color: var(--secondary);
    font-size: 12px;
  }

  .history-dialog > footer {
    justify-content: flex-end;
    padding-top: 12px;
  }

  .history-select {
    min-height: 220px;
    padding: 4px;
    font-size: 12px;
  }

  .history-select option {
    padding: 7px 8px;
    white-space: pre-wrap;
  }

  .history-empty {
    display: grid;
    min-height: 220px;
    border: 1px solid var(--border);
    background: var(--panel-subtle);
    color: var(--secondary);
    font-size: 12px;
    place-items: center;
  }

  .revert-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3100;
    display: grid;
    background: rgb(10 18 26 / 35%);
    padding: 24px;
    place-items: center;
  }

  .revert-dialog {
    display: grid;
    gap: 18px;
    width: min(520px, 100%);
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    padding: 16px;
  }

  .revert-dialog > header,
  .revert-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .revert-dialog > header {
    align-items: flex-start;
  }

  .revert-dialog > header p {
    margin-top: 5px;
    color: var(--secondary);
    font-size: 12px;
  }

  .revert-dialog > code,
  .revert-path-list code {
    overflow-wrap: anywhere;
    border: 1px solid var(--border);
    background: var(--panel-subtle);
    padding: 10px;
    font-size: 12px;
  }

  .revert-path-list {
    display: grid;
    gap: 6px;
    max-height: min(280px, 42vh);
    overflow: auto;
  }

  .out-of-date-dialog {
    max-height: min(620px, 100%);
  }

  .out-of-date-detail {
    max-height: 180px;
    overflow: auto;
    margin: 0;
    border: 1px solid var(--border);
    background: var(--panel-subtle);
    color: var(--secondary);
    padding: 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  .revert-dialog > footer {
    justify-content: flex-end;
  }

  .dialog-close {
    display: grid;
    width: 30px;
    flex: 0 0 30px;
    padding: 0;
    place-items: center;
  }

  button.danger-primary {
    border-color: #b93d3d;
    background: #b93d3d;
    color: #ffffff;
  }

  button.danger-primary:hover:not(:disabled) {
    border-color: #9f2f2f;
    background: #9f2f2f;
    color: #ffffff;
  }

  @media (max-width: 800px) {
    .commit-titlebar { padding: 14px; }
    .commit-summary, .commit-notices { padding-left: 14px; padding-right: 14px; }
    .commit-layout { display: block; padding: 10px 14px 14px; overflow: auto; }
    .review-pane { min-height: 240px; }
    .review-pane.diff-open { grid-template-rows: minmax(240px, 1fr) 8px minmax(260px, var(--diff-pane-height)); min-height: 508px; }
    .message-pane-resizer { display: none; }
    .message-pane { margin-top: 12px; }
  }
</style>
