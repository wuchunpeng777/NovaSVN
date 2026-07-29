<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { CircleCheck, FolderOpen, GitMergeConflict, LoaderCircle, RefreshCw, Square, X } from "@lucide/svelte";
  import {
    cancelTask,
    chooseWorkspaceDirectory,
    createMergeTask,
    createSvnOperationTask,
    getFileContentDiff,
    getFileDiff,
    getTask,
    inspectUpdateTarget,
    launchConflictWindow,
    launchMergePreviewWindow,
    scanWorkspaceStatus,
  } from "../lib/api";
  import { shouldShowTextDiffViewer } from "../lib/file-content-diff";
  import { LOG_FILE_DIFF_MAX_BYTES } from "../lib/svn-log";
  import { buildPropertyContentDiff } from "../lib/svn-property-diff";
  import type {
    ChangedFile,
    CommandError,
    FileContentDiff,
    FileDiff,
    MergeResult,
    SvnOperationKind,
    Task,
    TaskStatus,
    UpdateTargetSummary,
    WorkingCopyStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import ImageDiffViewer from "./workbench/ImageDiffViewer.svelte";
  import MonacoDiffViewer from "./workbench/MonacoDiffViewer.svelte";
  import RawDiffViewer from "./workbench/RawDiffViewer.svelte";

  export let sourceUrl: string;
  export let sourceRepositoryRoot: string;
  export let sourceWorkingCopyRoot: string | null = null;
  export let revisions: string[];
  export let svnExecutable: string | undefined = undefined;
  export let theme: "light" | "dark" = "light";
  export let onClose: () => void = () => {};
  export let onMerged: (workingCopyRoot: string) => void = () => {};

  let dialogElement: HTMLDivElement | null = null;
  let targetPath = "";
  let target: UpdateTargetSummary | null = null;
  let targetStatus: WorkingCopyStatus | null = null;
  let checkingTarget = false;
  let task: Task | null = null;
  let operation: "preview" | "apply" | null = null;
  let previewComplete = false;
  let error: CommandError | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let cancelling = false;
  let closing = false;
  let cancellationRequestedTaskId: string | null = null;
  let postMergeStatus: WorkingCopyStatus | null = null;
  let reviewLoading = false;
  let reviewError: CommandError | null = null;
  let selectedReviewPath: string | null = null;
  let selectedReviewDiff: FileDiff | null = null;
  let selectedReviewContentDiff: FileContentDiff | null = null;
  let selectedPropertyContentDiff: FileContentDiff | null = null;
  let reviewDiffLoading = false;
  let reviewGeneration = 0;
  let reviewFilter: "all" | "conflicts" = "all";
  let resolutionTask: Task | null = null;
  let resolutionPath: string | null = null;
  let resolutionPollTimer: number | null = null;

  const terminalStatuses: TaskStatus[] = [
    "success",
    "failed",
    "cancelled",
    "interrupted",
  ];

  $: taskRunning = task !== null && !terminalStatuses.includes(task.status);
  $: mergeResult = task?.result?.merge_result ?? null;
  $: directMergeFinished =
    operation === "apply" && task !== null && terminalStatuses.includes(task.status);
  $: directMergeSucceeded = operation === "apply" && task?.status === "success";
  $: targetDirty = (targetStatus?.total ?? 0) > 0;
  $: reviewConflictCount = (postMergeStatus?.files ?? []).filter(isReviewConflicted).length;
  $: reviewFiles = (postMergeStatus?.files ?? []).filter(
    (file) => reviewFilter === "all" || isReviewConflicted(file),
  );
  $: selectedReviewFile =
    postMergeStatus?.files.find((file) => file.path === selectedReviewPath) ?? null;
  $: selectedPropertyContentDiff = buildPropertyContentDiff(selectedReviewDiff);
  $: resolutionRunning = resolutionTask !== null && !terminalStatuses.includes(resolutionTask.status);
  $: revisionSummary = revisions.length <= 20
    ? revisions.map((revision) => `r${revision}`).join("、")
    : `${revisions.slice(0, 20).map((revision) => `r${revision}`).join("、")} 等 ${revisions.length} 个`;

  onMount(async () => {
    await tick();
    dialogElement?.focus();
    window.addEventListener("keydown", handleWindowKeydown);
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    clearResolutionPollTimer();
    window.removeEventListener("keydown", handleWindowKeydown);
    const runningTaskId = taskRunning ? task?.task_id : null;
    if (runningTaskId && cancellationRequestedTaskId !== runningTaskId) {
      cancellationRequestedTaskId = runningTaskId;
      void cancelTask(runningTaskId).catch(() => undefined);
    }
    if (resolutionRunning && resolutionTask) {
      void cancelTask(resolutionTask.task_id).catch(() => undefined);
    }
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      requestClose();
    }
  }

  function requestClose() {
    if (closing) {
      return;
    }
    closing = true;
    generation += 1;
    clearPollTimer();
    clearResolutionPollTimer();
    const runningTaskId = taskRunning ? task?.task_id : null;
    if (runningTaskId && cancellationRequestedTaskId !== runningTaskId) {
      cancellationRequestedTaskId = runningTaskId;
      void cancelTask(runningTaskId).catch(() => undefined);
    }
    if (resolutionRunning && resolutionTask) {
      void cancelTask(resolutionTask.task_id).catch(() => undefined);
    }
    if (directMergeSucceeded && target) {
      onMerged(target.target_path);
    }
    onClose();
  }

  function commandError(
    code: string,
    message: string,
    detail?: string,
  ): CommandError {
    return { code, message, detail: detail ?? null, recoverable: true };
  }

  function normalizeCaughtError(caught: unknown, message: string): CommandError {
    if (typeof caught === "object" && caught !== null && "code" in caught && "message" in caught) {
      return caught as CommandError;
    }
    return commandError(
      "LOG_MERGE_FAILED",
      message,
      caught instanceof Error ? caught.message : String(caught || message),
    );
  }

  function normalizeRepositoryUrl(url: string) {
    return url.trim().replace(/\/+$/, "");
  }

  function normalizeLocalPath(path: string) {
    return path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  }

  function resetPreview() {
    clearPollTimer();
    reviewGeneration += 1;
    task = null;
    operation = null;
    previewComplete = false;
    postMergeStatus = null;
    reviewLoading = false;
    reviewError = null;
    selectedReviewPath = null;
    selectedReviewDiff = null;
    selectedReviewContentDiff = null;
    reviewDiffLoading = false;
    reviewFilter = "all";
    resolutionTask = null;
    resolutionPath = null;
  }

  function updateTargetPath(value: string) {
    generation += 1;
    targetPath = value;
    target = null;
    targetStatus = null;
    error = null;
    resetPreview();
  }

  async function chooseTarget() {
    try {
      const selected = await chooseWorkspaceDirectory();
      if (!selected) {
        return;
      }
      updateTargetPath(selected);
      await inspectTarget();
    } catch (caught) {
      error = normalizeCaughtError(caught, "无法选择目标工作副本");
    }
  }

  async function inspectTarget() {
    const path = targetPath.trim();
    if (!path) {
      error = commandError("LOG_MERGE_TARGET_MISSING", "请选择目标工作副本");
      return;
    }

    const currentGeneration = ++generation;
    checkingTarget = true;
    target = null;
    targetStatus = null;
    error = null;
    resetPreview();
    try {
      const nextTarget = await inspectUpdateTarget({
        path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      if (nextTarget.kind !== "dir") {
        throw commandError(
          "LOG_MERGE_TARGET_NOT_DIRECTORY",
          "Merge 目标必须是目录",
          nextTarget.target_path,
        );
      }
      if (
        sourceWorkingCopyRoot &&
        normalizeLocalPath(nextTarget.target_path) === normalizeLocalPath(sourceWorkingCopyRoot)
      ) {
        throw commandError(
          "LOG_MERGE_TARGET_SAME_AS_SOURCE",
          "请选择另一个本地工作副本",
          nextTarget.working_copy_root,
        );
      }
      if (
        normalizeRepositoryUrl(nextTarget.repository_root) !==
        normalizeRepositoryUrl(sourceRepositoryRoot)
      ) {
        throw commandError(
          "LOG_MERGE_REPOSITORY_MISMATCH",
          "目标工作副本不属于当前 SVN 仓库",
          `来源：${sourceRepositoryRoot}\n目标：${nextTarget.repository_root}`,
        );
      }

      const nextStatus = await scanWorkspaceStatus({
        working_copy_root: nextTarget.working_copy_root,
        scope_path: nextTarget.relative_path ?? undefined,
        svn_executable: svnExecutable?.trim() || undefined,
        offset: 0,
        limit: 1,
        check_remote_updates: false,
      });
      if (currentGeneration !== generation) {
        return;
      }
      target = nextTarget;
      targetStatus = nextStatus;
      targetPath = nextTarget.target_path;
    } catch (caught) {
      if (currentGeneration === generation) {
        error = normalizeCaughtError(caught, "无法检查目标工作副本");
      }
    } finally {
      if (currentGeneration === generation) {
        checkingTarget = false;
      }
    }
  }

  async function startMerge(dryRun: boolean) {
    if (!target || revisions.length === 0) {
      return;
    }
    if (!dryRun && !confirmDirectMerge()) {
      return;
    }

    const currentGeneration = ++generation;
    clearPollTimer();
    task = null;
    operation = dryRun ? "preview" : "apply";
    error = null;
    postMergeStatus = null;
    reviewError = null;
    selectedReviewPath = null;
    selectedReviewDiff = null;
    selectedReviewContentDiff = null;
    if (dryRun) {
      previewComplete = false;
    }
    try {
      const created = await createMergeTask({
        working_copy_root: target.target_path,
        source_url: sourceUrl,
        revisions,
        dry_run: dryRun,
        allow_local_changes: !dryRun,
        record_only: false,
        ignore_ancestry: false,
        force: false,
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
        error = normalizeCaughtError(caught, dryRun ? "无法创建 Merge 预览" : "无法执行 Merge");
      }
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
        return;
      }
      clearPollTimer();
      cancelling = false;
      if (nextTask.status === "cancelled") {
        if (operation === "apply") {
          await refreshPostMergeReview(currentGeneration);
        }
        return;
      }
      if (nextTask.status !== "success") {
        error = commandError(
          "LOG_MERGE_TASK_FAILED",
          operation === "preview" ? "Merge 预览失败" : "Merge 执行失败",
          nextTask.error ?? undefined,
        );
        if (operation === "apply") {
          await refreshPostMergeReview(currentGeneration);
        }
        return;
      }
      if (operation === "preview") {
        previewComplete = true;
        const previewId = nextTask.result?.merge_result?.preview_id;
        if (!previewId) {
          error = commandError(
            "LOG_MERGE_PREVIEW_ID_MISSING",
            "Merge 预览没有返回会话标识",
          );
          return;
        }
        await launchMergePreviewWindow({ preview_id: previewId });
        if (currentGeneration === generation) {
          onClose();
        }
      } else {
        await refreshPostMergeReview(currentGeneration);
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        error = normalizeCaughtError(caught, "无法读取 Merge 任务状态");
      }
    }
  }

  function confirmDirectMerge() {
    const localChanges = targetDirty
      ? `\n\n目标当前已有 ${targetStatus?.total ?? 0} 项本地改动。Merge 后状态和 Diff 会同时包含这些原有改动。`
      : "";
    return window.confirm(
      `确定直接应用 ${revisions.length} 个 Revision 吗？\n\nMerge 只修改本地工作副本，不会自动提交。${localChanges}`,
    );
  }

  async function refreshPostMergeReview(currentGeneration = generation) {
    if (!target) {
      return;
    }
    reviewGeneration += 1;
    reviewLoading = true;
    reviewError = null;
    const previousReviewPath = selectedReviewPath;
    postMergeStatus = null;
    selectedReviewDiff = null;
    selectedReviewContentDiff = null;
    try {
      const status = await scanWorkspaceStatus({
        working_copy_root: target.working_copy_root,
        scope_path: target.relative_path ?? undefined,
        svn_executable: svnExecutable?.trim() || undefined,
        offset: 0,
        limit: 500,
        check_remote_updates: false,
      });
      if (currentGeneration !== generation) {
        return;
      }
      postMergeStatus = status;
      const firstFile = status.files.find(
        (file) =>
          file.path === previousReviewPath &&
          (reviewFilter === "all" || isReviewConflicted(file)),
      )
        ?? status.files.find((file) => reviewFilter === "all" || isReviewConflicted(file));
      if (firstFile) {
        await loadReviewDiff(firstFile);
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        reviewError = normalizeCaughtError(caught, "无法读取 Merge 后工作副本状态");
      }
    } finally {
      if (currentGeneration === generation) {
        reviewLoading = false;
      }
    }
  }

  async function loadReviewDiff(file: ChangedFile) {
    if (!target) {
      return;
    }
    const currentReviewGeneration = ++reviewGeneration;
    selectedReviewPath = file.path;
    selectedReviewDiff = null;
    selectedReviewContentDiff = null;
    reviewDiffLoading = true;
    reviewError = null;
    try {
      const request = {
        working_copy_root: target.working_copy_root,
        file_path: file.path,
        svn_executable: svnExecutable?.trim() || undefined,
      };
      const [diffResult, contentResult] = await Promise.allSettled([
        getFileDiff(request),
        getFileContentDiff({ ...request, max_bytes: LOG_FILE_DIFF_MAX_BYTES }),
      ]);
      if (currentReviewGeneration === reviewGeneration) {
        selectedReviewDiff = diffResult.status === "fulfilled" ? diffResult.value : null;
        selectedReviewContentDiff =
          contentResult.status === "fulfilled" ? contentResult.value : null;
        if (diffResult.status === "rejected" && contentResult.status === "rejected") {
          reviewError = normalizeCaughtError(contentResult.reason, "无法读取文件 Diff");
        }
      }
    } catch (caught) {
      if (currentReviewGeneration === reviewGeneration) {
        reviewError = normalizeCaughtError(caught, "无法读取文件 Diff");
      }
    } finally {
      if (currentReviewGeneration === reviewGeneration) {
        reviewDiffLoading = false;
      }
    }
  }

  function applyReviewFilter(filter: "all" | "conflicts") {
    reviewFilter = filter;
    const files = (postMergeStatus?.files ?? []).filter(
      (file) => filter === "all" || isReviewConflicted(file),
    );
    const selectedStillVisible = files.find((file) => file.path === selectedReviewPath);
    if (selectedStillVisible) {
      return;
    }
    const firstFile = files[0];
    if (firstFile) {
      void loadReviewDiff(firstFile);
    } else {
      selectedReviewPath = null;
      selectedReviewDiff = null;
      selectedReviewContentDiff = null;
    }
  }

  function isReviewConflicted(file: ChangedFile) {
    return file.status === "conflicted" || Boolean(file.conflict_kind);
  }

  async function openSelectedConflict() {
    if (!target || !selectedReviewFile || !isReviewConflicted(selectedReviewFile)) {
      return;
    }
    reviewError = null;
    try {
      const root = target.working_copy_root.replace(/[\\/]+$/, "");
      const relativePath = selectedReviewFile.path.replaceAll("/", "\\").replace(/^[\\/]+/, "");
      await launchConflictWindow({ target_path: `${root}\\${relativePath}` });
    } catch (caught) {
      reviewError = normalizeCaughtError(caught, "无法打开冲突编辑器");
    }
  }

  async function resolveSelectedConflict(kind: SvnOperationKind) {
    if (!target || !selectedReviewFile || !isReviewConflicted(selectedReviewFile) || resolutionRunning) {
      return;
    }
    if (
      kind !== "resolve_working" &&
      !window.confirm(
        `${kind === "resolve_mine_full" ? "采用我的完整版本" : "采用仓库完整版本"}处理冲突吗？\n${selectedReviewFile.path}`,
      )
    ) {
      return;
    }
    reviewError = null;
    resolutionPath = selectedReviewFile.path;
    try {
      resolutionTask = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind,
        file_path: selectedReviewFile.path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      scheduleResolutionPoll(resolutionTask.task_id, generation, 0);
    } catch (caught) {
      resolutionTask = null;
      resolutionPath = null;
      reviewError = normalizeCaughtError(caught, "冲突处理失败");
    }
  }

  function scheduleResolutionPoll(taskId: string, currentGeneration: number, delay: number) {
    clearResolutionPollTimer();
    resolutionPollTimer = window.setTimeout(
      () => void pollResolutionTask(taskId, currentGeneration),
      delay,
    );
  }

  async function pollResolutionTask(taskId: string, currentGeneration: number) {
    try {
      const nextTask = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      resolutionTask = nextTask;
      if (!terminalStatuses.includes(nextTask.status)) {
        scheduleResolutionPoll(taskId, currentGeneration, 350);
        return;
      }
      clearResolutionPollTimer();
      if (nextTask.status === "success") {
        await refreshPostMergeReview(currentGeneration);
      } else {
        reviewError = commandError(
          "LOG_MERGE_RESOLVE_FAILED",
          "冲突处理失败",
          nextTask.error ?? undefined,
        );
      }
      resolutionPath = null;
    } catch (caught) {
      if (currentGeneration === generation) {
        reviewError = normalizeCaughtError(caught, "无法读取冲突处理任务状态");
      }
    }
  }

  function clearResolutionPollTimer() {
    if (resolutionPollTimer !== null) {
      window.clearTimeout(resolutionPollTimer);
      resolutionPollTimer = null;
    }
  }

  function statusLabel(status: string) {
    const labels: Record<string, string> = {
      modified: "修改",
      added: "新增",
      deleted: "删除",
      missing: "缺失",
      unversioned: "未版本控制",
      conflicted: "冲突",
      obstructed: "阻挡",
      replaced: "替换",
    };
    return labels[status] ?? status;
  }

  async function stopMerge() {
    if (!task || terminalStatuses.includes(task.status) || cancelling) {
      return;
    }
    const taskId = task.task_id;
    const currentGeneration = ++generation;
    cancelling = true;
    cancellationRequestedTaskId = taskId;
    clearPollTimer();
    try {
      const cancelledTask = await cancelTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      task = cancelledTask;
      if (terminalStatuses.includes(cancelledTask.status)) {
        cancelling = false;
        if (operation === "apply") {
          await refreshPostMergeReview(currentGeneration);
        }
      } else {
        schedulePoll(taskId, currentGeneration, 0);
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        cancellationRequestedTaskId = null;
        cancelling = false;
        error = normalizeCaughtError(caught, "无法取消 Merge 任务");
        schedulePoll(taskId, currentGeneration, 350);
      }
    }
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function resultTitle(result: MergeResult) {
    if (operation === "preview") {
      return result.conflicted > 0 ? "预览发现冲突" : "Dry-run 完成";
    }
    return result.conflicted > 0 ? "Merge 完成，存在冲突" : "Merge 完成";
  }
</script>

<div
  class="merge-dialog-backdrop"
  role="presentation"
  tabindex="-1"
  on:click|self={requestClose}
>
  <div
    bind:this={dialogElement}
    class="merge-dialog"
    class:reviewing={directMergeFinished}
    data-theme={theme}
    role="dialog"
    aria-modal="true"
    aria-label="Merge 选中 Revision"
    tabindex="-1"
  >
    <header>
      <div>
        <h2>{directMergeFinished ? "Merge 结果" : "Merge 选中 Revision"}</h2>
        <p title={sourceUrl}>{sourceUrl}</p>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="关闭 Merge 窗口"
        title="关闭"
        on:click={requestClose}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </header>

    <section class="merge-dialog-body">
      <div class="revision-selection" aria-label="选中的 Revision">
        <strong>{revisions.length} 个 Revision</strong>
        <span>{revisionSummary}</span>
      </div>

      <label class="target-label" for="merge-target-path">目标工作副本</label>
      <div class="target-input-row">
        <input
          id="merge-target-path"
          type="text"
          value={targetPath}
          placeholder="本地 SVN 工作副本根目录"
          disabled={taskRunning || checkingTarget}
          on:input={(event) => updateTargetPath((event.currentTarget as HTMLInputElement).value)}
          on:keydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void inspectTarget();
            }
          }}
        />
        <button
          type="button"
          class="icon-button"
          aria-label="选择目标工作副本"
          title="选择目标工作副本"
          disabled={taskRunning || checkingTarget}
          on:click={chooseTarget}
        >
          <FolderOpen size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={taskRunning || checkingTarget || !targetPath.trim()}
          on:click={inspectTarget}
        >
          {checkingTarget ? "检查中" : "检查"}
        </button>
      </div>

      {#if target && targetStatus}
        <div class="target-summary" class:dirty={targetDirty}>
          <div>
            <strong>{target.repository_url}</strong>
            <span>{target.target_path}</span>
          </div>
          <div class="target-status">
            <span>r{target.revision}</span>
            <span>{targetDirty ? `${targetStatus.total} 项本地改动` : "工作副本干净"}</span>
            {#if targetStatus.conflicted > 0}<span>{targetStatus.conflicted} 个冲突</span>{/if}
          </div>
        </div>
      {/if}

      <ErrorNotice {error} />

      {#if task}
        <div class="task-status" aria-live="polite">
          {#if taskRunning}
            <LoaderCircle class="spinning" size={18} aria-hidden="true" />
          {:else if task.status === "success"}
            <CircleCheck size={18} aria-hidden="true" />
          {/if}
          <strong>{task.title}</strong>
          <span>{task.status}</span>
        </div>
      {/if}

      {#if mergeResult}
        <section class="merge-result" aria-label="Merge 结果">
          <header>
            <strong>{resultTitle(mergeResult)}</strong>
            <span>{mergeResult.dry_run ? "未修改目标目录" : target?.target_path}</span>
          </header>
          <div class="result-counts">
            <span><strong>{mergeResult.file_count}</strong> 文件</span>
            <span><strong>{mergeResult.updated}</strong> 更新</span>
            <span><strong>{mergeResult.added}</strong> 新增</span>
            <span><strong>{mergeResult.deleted}</strong> 删除</span>
            <span class:conflicted={mergeResult.conflicted > 0}><strong>{mergeResult.conflicted}</strong> 冲突</span>
          </div>
          <details class="merge-output">
            <summary>SVN 输出</summary>
            <pre>{mergeResult.output_text || "svn merge 没有输出。"}</pre>
          </details>
        </section>
      {/if}

      {#if directMergeFinished}
        <section class="post-merge-review" aria-label="Merge 后检查">
          <header>
            <div>
              <strong>改动审查</strong>
              <span>
                {targetDirty
                  ? "包含 Merge 前已有的本地改动"
                  : "Merge 结果尚未提交"}
              </span>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="刷新 Merge 后状态"
              title="刷新"
              disabled={reviewLoading}
              on:click={() => refreshPostMergeReview()}
            >
              <RefreshCw class={reviewLoading ? "spinning" : ""} size={16} aria-hidden="true" />
            </button>
          </header>

          <ErrorNotice error={reviewError} />
          {#if reviewLoading && !postMergeStatus}
            <div class="review-empty" role="status">
              <LoaderCircle class="spinning" size={18} aria-hidden="true" /> 正在读取状态...
            </div>
          {:else if postMergeStatus}
            <div class="review-summary">
              <span><strong>{postMergeStatus.local_changes}</strong> 本地改动</span>
              <span><strong>{postMergeStatus.modified}</strong> 修改</span>
              <span><strong>{postMergeStatus.added}</strong> 新增</span>
              <span><strong>{postMergeStatus.deleted}</strong> 删除</span>
              <span class:conflicted={reviewConflictCount > 0}>
                <strong>{reviewConflictCount}</strong> 冲突
              </span>
            </div>
            {#if postMergeStatus.files.length > 0}
              <div class="review-layout">
                <aside class="review-file-pane">
                  <div class="review-filters" role="tablist" aria-label="改动文件筛选">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={reviewFilter === "all"}
                      class:active={reviewFilter === "all"}
                      on:click={() => applyReviewFilter("all")}
                    >
                      全部 {postMergeStatus.files.length}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={reviewFilter === "conflicts"}
                      class:active={reviewFilter === "conflicts"}
                      class:has-conflicts={reviewConflictCount > 0}
                      on:click={() => applyReviewFilter("conflicts")}
                    >
                      冲突 {reviewConflictCount}
                    </button>
                  </div>
                  <nav class="review-files" aria-label="Merge 后本地改动">
                    {#each reviewFiles as file (file.path)}
                      <button
                        type="button"
                        class:selected={selectedReviewPath === file.path}
                        class:conflicted={isReviewConflicted(file)}
                        aria-pressed={selectedReviewPath === file.path}
                        aria-label={`${statusLabel(file.status)} ${file.path}`}
                        title={file.path}
                        on:click={() => loadReviewDiff(file)}
                      >
                        <span class="file-status">{isReviewConflicted(file) ? "冲突" : statusLabel(file.status)}</span>
                        <span>{file.path}</span>
                      </button>
                    {:else}
                      <div class="review-empty compact">当前没有冲突文件</div>
                    {/each}
                    {#if postMergeStatus.returned < postMergeStatus.total}
                      <p>仅显示前 {postMergeStatus.returned} 项，共 {postMergeStatus.total} 项。</p>
                    {/if}
                  </nav>
                </aside>
                <section class="review-diff" aria-label="Merge 后文件 Diff">
                  <header class="review-diff-header">
                    <div>
                      <strong>{selectedReviewFile ? statusLabel(selectedReviewFile.status) : "Diff"}</strong>
                      <span title={selectedReviewPath ?? undefined}>{selectedReviewPath ?? "请选择左侧文件"}</span>
                    </div>
                    {#if selectedReviewFile && isReviewConflicted(selectedReviewFile)}
                      <div class="conflict-actions" aria-label="冲突处理操作">
                        <button type="button" disabled={resolutionRunning} on:click={openSelectedConflict}>
                          <GitMergeConflict size={15} aria-hidden="true" /> 编辑冲突
                        </button>
                        <button type="button" disabled={resolutionRunning} on:click={() => resolveSelectedConflict("resolve_working")}>
                          标记已解决
                        </button>
                        <button type="button" disabled={resolutionRunning} on:click={() => resolveSelectedConflict("resolve_mine_full")}>
                          采用我的
                        </button>
                        <button type="button" disabled={resolutionRunning} on:click={() => resolveSelectedConflict("resolve_theirs_full")}>
                          采用仓库
                        </button>
                      </div>
                    {/if}
                  </header>
                  <div class="review-diff-content">
                    {#if resolutionRunning && resolutionPath === selectedReviewPath}
                      <div class="review-action-progress" role="status">
                        <LoaderCircle class="spinning" size={16} aria-hidden="true" />
                        正在处理冲突...
                      </div>
                    {/if}
                    {#if reviewDiffLoading}
                      <div class="review-empty" role="status">
                        <LoaderCircle class="spinning" size={18} aria-hidden="true" /> 正在读取 Diff...
                      </div>
                    {:else if selectedReviewContentDiff?.is_image}
                      <ImageDiffViewer contentDiff={selectedReviewContentDiff} />
                    {:else if selectedReviewContentDiff?.too_large}
                      <div class="review-empty">文件内容过大，无法在窗口中预览</div>
                    {:else if selectedReviewContentDiff?.binary || selectedReviewDiff?.binary}
                      <div class="review-empty">二进制文件无法显示文本 Diff</div>
                    {:else if shouldShowTextDiffViewer(selectedReviewContentDiff)}
                      <MonacoDiffViewer contentDiff={selectedReviewContentDiff} theme={theme} />
                    {:else if selectedPropertyContentDiff}
                      <MonacoDiffViewer contentDiff={selectedPropertyContentDiff} theme={theme} />
                    {:else if selectedReviewDiff?.text}
                      <RawDiffViewer text={selectedReviewDiff.text} theme={theme} />
                    {:else}
                      <div class="review-empty">没有可显示的文本 Diff</div>
                    {/if}
                  </div>
                </section>
              </div>
            {:else}
              <div class="review-empty">工作副本当前没有本地改动</div>
            {/if}
          {/if}
        </section>
      {/if}
    </section>

    <footer>
      {#if taskRunning}
        <button type="button" class="danger" disabled={cancelling} on:click={stopMerge}>
          <Square size={14} aria-hidden="true" /> {cancelling ? "正在取消" : "取消任务"}
        </button>
      {:else}
        <button type="button" on:click={requestClose}>关闭</button>
        {#if !directMergeFinished}
          <div>
            <button
              type="button"
              disabled={!target || checkingTarget}
              on:click={() => startMerge(true)}
            >
              {previewComplete ? "重新预览" : "预览 Merge"}
            </button>
            <button
              type="button"
              class="primary"
              disabled={!target || checkingTarget}
              on:click={() => startMerge(false)}
            >
              直接应用
            </button>
          </div>
        {/if}
      {/if}
    </footer>
  </div>
</div>

<style>
  .merge-dialog-backdrop {
    position: fixed;
    z-index: 70;
    display: grid;
    inset: 0;
    background: rgb(0 0 0 / 36%);
    padding: 24px;
    place-items: center;
  }

  .merge-dialog {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(720px, calc(100vw - 32px));
    max-height: min(760px, calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 18px 52px rgb(0 0 0 / 28%);
  }

  .merge-dialog.reviewing {
    width: min(1080px, calc(100vw - 32px));
    height: min(820px, calc(100vh - 32px));
    max-height: calc(100vh - 32px);
  }

  .merge-dialog > header,
  .merge-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
  }

  .merge-dialog > header {
    border-bottom: 1px solid var(--border);
  }

  .merge-dialog > header > div {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 16px;
  }

  .merge-dialog > header p {
    overflow: hidden;
    margin-top: 3px;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .merge-dialog-body {
    display: grid;
    align-content: start;
    gap: 12px;
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }

  .merge-dialog.reviewing .merge-dialog-body {
    grid-template-rows: auto minmax(0, 1fr);
    align-content: stretch;
    overflow: hidden;
  }

  .merge-dialog.reviewing :is(.revision-selection, .target-label, .target-input-row, .target-summary, .task-status) {
    display: none;
  }

  .revision-selection,
  .target-summary,
  .task-status,
  .merge-result {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-subtle);
  }

  .revision-selection {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 9px 10px;
  }

  .revision-selection span {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--secondary);
    font-size: 12px;
  }

  .target-label {
    margin-bottom: -7px;
    color: var(--secondary);
    font-size: 12px;
    font-weight: 700;
  }

  .target-input-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 32px auto;
    gap: 6px;
  }

  .target-input-row input {
    width: 100%;
  }

  .target-summary {
    display: grid;
    gap: 8px;
    padding: 10px;
  }

  .target-summary.dirty {
    border-color: #b87816;
  }

  .target-summary > div:first-child {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .target-summary strong,
  .target-summary span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-summary > div:first-child span {
    color: var(--secondary);
    font-size: 11px;
  }

  .target-status,
  .result-counts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .target-status span,
  .result-counts span {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel);
    padding: 3px 6px;
    font-size: 11px;
  }

  .task-status {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
  }

  .task-status span {
    color: var(--secondary);
    font-size: 11px;
  }

  .merge-result {
    overflow: hidden;
  }

  .merge-result > header {
    display: grid;
    gap: 3px;
    border-bottom: 1px solid var(--border);
    padding: 9px 10px;
  }

  .merge-result > header span {
    overflow: hidden;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-counts {
    padding: 9px 10px 0;
  }

  .result-counts .conflicted {
    border-color: #bd514b;
    color: #a12f2b;
  }

  .merge-output {
    margin: 8px 10px 10px;
    color: var(--secondary);
    font-size: 11px;
  }

  .merge-output summary {
    width: max-content;
    cursor: pointer;
  }

  .merge-output pre {
    max-height: 210px;
    overflow: auto;
    margin: 7px 0 0;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel);
    padding: 9px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .post-merge-review {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-subtle);
  }

  .post-merge-review > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid var(--border);
    padding: 9px 10px;
  }

  .post-merge-review > header > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .post-merge-review > header span {
    overflow: hidden;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .review-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }

  .review-summary span {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel);
    padding: 3px 6px;
    font-size: 11px;
  }

  .review-summary .conflicted {
    border-color: #bd514b;
    color: #a12f2b;
  }

  .review-layout {
    display: grid;
    grid-template-columns: minmax(240px, 30%) minmax(0, 1fr);
    flex: 1 1 auto;
    min-height: 0;
  }

  .review-file-pane {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--panel);
  }

  .review-filters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    padding: 6px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-subtle);
  }

  .review-filters button {
    min-width: 0;
    min-height: 29px;
    border-color: transparent;
    background: transparent;
    padding: 4px 8px;
    color: var(--secondary);
    font-size: 11px;
  }

  .review-filters button.active {
    border-color: var(--border);
    background: var(--panel);
    color: var(--text);
  }

  .review-filters button.has-conflicts {
    color: #a12f2b;
  }

  .review-files {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--panel);
  }

  .review-files > button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    justify-content: stretch;
    width: 100%;
    min-height: 34px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    padding: 6px 8px;
    text-align: left;
  }

  .review-files > button:hover,
  .review-files > button.selected {
    background: var(--panel-subtle);
  }

  .review-files > button.conflicted .file-status {
    border-color: #bd514b;
    color: #a12f2b;
  }

  .review-files > button > span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .review-files > p {
    padding: 8px;
    color: var(--secondary);
    font-size: 11px;
  }

  .file-status {
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 4px;
    color: var(--secondary);
    font-size: 10px;
    white-space: nowrap;
  }

  .review-diff {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--panel);
  }

  .review-diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
    padding: 6px 9px;
  }

  .review-diff-header > div:first-child {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .review-diff-header span {
    min-width: 0;
    overflow: hidden;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 5px;
  }

  .conflict-actions button {
    min-height: 28px;
    padding: 4px 7px;
    font-size: 11px;
  }

  .conflict-actions button:first-child {
    border-color: #bd514b;
    color: #a12f2b;
  }

  .review-diff-content {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .review-diff-content :global(.monaco-diff-viewer),
  .review-diff-content :global(.raw-diff-viewer) {
    width: 100%;
    height: 100%;
  }

  .review-action-progress {
    position: absolute;
    z-index: 2;
    top: 7px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--panel);
    padding: 5px 8px;
    color: var(--secondary);
    font-size: 11px;
  }

  .review-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 110px;
    padding: 16px;
    color: var(--secondary);
    font-size: 12px;
    text-align: center;
  }

  .review-empty.compact {
    min-height: 90px;
    padding: 12px;
  }

  .merge-dialog > footer {
    border-top: 1px solid var(--border);
    background: var(--panel-subtle);
  }

  .merge-dialog > footer > div {
    display: flex;
    gap: 7px;
  }

  .merge-dialog button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }

  .merge-dialog button.danger {
    border-color: #bd514b;
    color: #a12f2b;
  }

  .merge-dialog button.primary {
    border-color: #2f6fab;
    background: #2f7dca;
    color: #fff;
  }

  :global(.spinning) {
    animation: merge-spin 900ms linear infinite;
  }

  @keyframes merge-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 640px) {
    .merge-dialog-backdrop {
      padding: 8px;
    }

    .merge-dialog {
      width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
    }

    .merge-dialog.reviewing {
      width: calc(100vw - 16px);
      height: calc(100vh - 16px);
      max-height: calc(100vh - 16px);
    }

    .target-input-row {
      grid-template-columns: minmax(0, 1fr) 32px;
    }

    .target-input-row > button:last-child {
      grid-column: 1 / -1;
    }

    .review-layout {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(140px, 40%) minmax(180px, 1fr);
    }

    .review-file-pane {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .review-diff-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .conflict-actions {
      justify-content: flex-start;
    }
  }
</style>
