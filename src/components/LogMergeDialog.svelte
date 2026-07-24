<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { CircleCheck, FolderOpen, LoaderCircle, Square, X } from "@lucide/svelte";
  import {
    cancelTask,
    chooseWorkspaceDirectory,
    createMergeTask,
    getTask,
    inspectUpdateTarget,
    launchMergePreviewWindow,
    scanWorkspaceStatus,
  } from "../lib/api";
  import type {
    CommandError,
    MergeResult,
    Task,
    TaskStatus,
    UpdateTargetSummary,
    WorkingCopyStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";

  export let sourceUrl: string;
  export let sourceRepositoryRoot: string;
  export let sourceWorkingCopyRoot: string | null = null;
  export let revisions: string[];
  export let svnExecutable: string | undefined = undefined;
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

  const terminalStatuses: TaskStatus[] = [
    "success",
    "failed",
    "cancelled",
    "interrupted",
  ];

  $: taskRunning = task !== null && !terminalStatuses.includes(task.status);
  $: mergeResult = task?.result?.merge_result ?? null;
  $: mergeApplied = operation === "apply" && task?.status === "success";
  $: targetDirty = (targetStatus?.total ?? 0) > 0;
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
    window.removeEventListener("keydown", handleWindowKeydown);
    const runningTaskId = taskRunning ? task?.task_id : null;
    if (runningTaskId && cancellationRequestedTaskId !== runningTaskId) {
      cancellationRequestedTaskId = runningTaskId;
      void cancelTask(runningTaskId).catch(() => undefined);
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
    const runningTaskId = taskRunning ? task?.task_id : null;
    if (runningTaskId && cancellationRequestedTaskId !== runningTaskId) {
      cancellationRequestedTaskId = runningTaskId;
      void cancelTask(runningTaskId).catch(() => undefined);
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
    task = null;
    operation = null;
    previewComplete = false;
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
    if (!dryRun && targetDirty) {
      error = commandError(
        "LOG_MERGE_TARGET_DIRTY",
        "目标工作副本存在本地改动",
        "请先提交或清理目标工作副本，再执行真实 Merge。",
      );
      return;
    }

    const currentGeneration = ++generation;
    clearPollTimer();
    task = null;
    operation = dryRun ? "preview" : "apply";
    error = null;
    if (dryRun) {
      previewComplete = false;
    }
    try {
      const created = await createMergeTask({
        working_copy_root: target.target_path,
        source_url: sourceUrl,
        revisions,
        dry_run: dryRun,
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
        return;
      }
      if (nextTask.status !== "success") {
        error = commandError(
          "LOG_MERGE_TASK_FAILED",
          operation === "preview" ? "Merge 预览失败" : "Merge 执行失败",
          nextTask.error ?? undefined,
        );
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
      } else if (target) {
        onMerged(target.target_path);
      }
    } catch (caught) {
      if (currentGeneration === generation) {
        error = normalizeCaughtError(caught, "无法读取 Merge 任务状态");
      }
    }
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
    role="dialog"
    aria-modal="true"
    aria-label="Merge 选中 Revision"
    tabindex="-1"
  >
    <header>
      <div>
        <h2>Merge 选中 Revision</h2>
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
          <pre>{mergeResult.output_text || "svn merge 没有输出。"}</pre>
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
        {#if !mergeApplied}
          <div>
            <button
              type="button"
              disabled={!target || checkingTarget}
              on:click={() => startMerge(true)}
            >
              {previewComplete ? "重新预览" : "预览 Merge"}
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

  pre {
    max-height: 210px;
    overflow: auto;
    margin: 9px 10px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel);
    padding: 9px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
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

    .target-input-row {
      grid-template-columns: minmax(0, 1fr) 32px;
    }

    .target-input-row > button:last-child {
      grid-column: 1 / -1;
    }
  }
</style>
