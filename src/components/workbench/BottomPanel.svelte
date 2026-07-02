<script lang="ts">
  import type { CommandError, Task, TaskStatus, TaskSummary } from "../../types/api";
  import type { SafetyCheckSummary } from "../../types/app";

  export let tasks: TaskSummary[] = [];
  export let selectedTask: Task | null = null;
  export let runningTaskId: string | null = null;
  export let stagedFiles: Array<{ path: string; status: string }> = [];
  export let safetyCheck: SafetyCheckSummary = {
    blockers: [],
    warnings: [],
    infos: [],
    confirmedWarningIds: [],
  };
  export let commitMessage = "";
  export let commitError: string | null = null;
  export let commitDisabled = false;
  export let loading = false;
  export let error: CommandError | null = null;
  export let onCreateTask: (outcome: "success" | "failed") => void;
  export let onCommitMessageInput: (value: string) => void;
  export let onConfirmSafetyWarnings: () => void;
  export let onCommit: () => void;
  export let onSelectTask: (taskId: string) => void;
  export let onCancelTask: (taskId: string) => void;

  const statusLabels: Record<TaskStatus, string> = {
    pending: "排队",
    running: "运行中",
    success: "成功",
    failed: "失败",
    cancelled: "已取消",
  };

  const fileStatusLabels: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    unversioned: "未版本控制",
  };

  function labelFileStatus(status: string) {
    return fileStatusLabels[status] ?? status;
  }

  function formatTime(value: number) {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  $: unconfirmedWarningCount = safetyCheck.warnings.filter(
    (item) => !safetyCheck.confirmedWarningIds.includes(item.id),
  ).length;
</script>

<footer class="bottom-panel">
  <section class="commit-placeholder">
    <div class="bottom-section-heading">
      <strong>提交区</strong>
      <span>{stagedFiles.length} 个已暂存</span>
    </div>

    <div class="staged-summary" aria-label="已暂存摘要">
      {#if stagedFiles.length === 0}
        <span>暂存文件后可进入提交准备</span>
      {:else}
        {#each stagedFiles.slice(0, 3) as file}
          <p>
            <small>{labelFileStatus(file.status)}</small>
            <span>{file.path}</span>
          </p>
        {/each}
        {#if stagedFiles.length > 3}
          <span>另有 {stagedFiles.length - 3} 个文件</span>
        {/if}
      {/if}
    </div>

    <textarea
      value={commitMessage}
      placeholder="输入提交信息"
      rows="3"
      on:input={(event) =>
        onCommitMessageInput((event.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>

    {#if commitError}
      <p class="commit-error">{commitError}</p>
    {/if}

    {#if safetyCheck.blockers.length > 0 || safetyCheck.warnings.length > 0 || safetyCheck.infos.length > 0}
      <div class="safety-summary" aria-label="安全检查结果">
        {#if safetyCheck.blockers.length > 0}
          <p class="safety-blocker">阻塞 {safetyCheck.blockers.length}</p>
        {/if}
        {#if safetyCheck.warnings.length > 0}
          <p class="safety-warning">警告 {safetyCheck.warnings.length}</p>
        {/if}
        {#if safetyCheck.infos.length > 0}
          <p class="safety-info">提示 {safetyCheck.infos.length}</p>
        {/if}
        {#if unconfirmedWarningCount > 0 && safetyCheck.blockers.length === 0}
          <button type="button" on:click={onConfirmSafetyWarnings}>
            确认警告
          </button>
        {/if}
      </div>
    {/if}

    <button
      class="commit-action"
      type="button"
      disabled={commitDisabled}
      on:click={onCommit}
    >
      提交
    </button>
  </section>

  <section class="task-log-panel">
    <div class="bottom-section-heading">
      <strong>命令输出</strong>
      {#if selectedTask}
        <span>{selectedTask.title}</span>
      {:else}
        <span>暂无任务日志</span>
      {/if}
    </div>

    {#if selectedTask}
      <div class="task-log-list" aria-label="任务日志">
        {#each selectedTask.logs as log}
          <p><time>{formatTime(log.created_at)}</time>{log.message}</p>
        {/each}
        {#if selectedTask.error}
          <p class="task-log-error">{selectedTask.error}</p>
        {/if}
      </div>
    {:else}
      <span>创建模拟任务后显示输出</span>
    {/if}
  </section>

  <section class="task-queue-panel">
    <div class="bottom-section-heading">
      <strong>任务队列</strong>
      <span>{tasks.length} 个任务</span>
    </div>

    <div class="task-actions">
      <button type="button" on:click={() => onCreateTask("success")} disabled={loading}>
        模拟成功
      </button>
      <button type="button" on:click={() => onCreateTask("failed")} disabled={loading}>
        模拟失败
      </button>
    </div>

    {#if error}
      <p class="task-error">{error.message}</p>
    {/if}

    <div class="task-list" aria-label="任务队列列表">
      {#if tasks.length === 0}
        <span>暂无后台任务</span>
      {:else}
        {#each tasks as task}
          <button
            type="button"
            class:active={selectedTask?.task_id === task.task_id}
            on:click={() => onSelectTask(task.task_id)}
          >
            <span class:running={runningTaskId === task.task_id}>{task.title}</span>
            <small class={`task-status status-${task.status}`}>
              {statusLabels[task.status]}
            </small>
          </button>
        {/each}
      {/if}
    </div>

    {#if selectedTask?.status === "pending"}
      <button
        class="cancel-task"
        type="button"
        on:click={() => onCancelTask(selectedTask.task_id)}
        disabled={loading}
      >
        取消选中任务
      </button>
    {/if}
  </section>
</footer>
