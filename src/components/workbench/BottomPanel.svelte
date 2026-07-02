<script lang="ts">
  import type { CommandError, Task, TaskStatus, TaskSummary } from "../../types/api";

  export let tasks: TaskSummary[] = [];
  export let selectedTask: Task | null = null;
  export let runningTaskId: string | null = null;
  export let loading = false;
  export let error: CommandError | null = null;
  export let onCreateTask: (outcome: "success" | "failed") => void;
  export let onSelectTask: (taskId: string) => void;
  export let onCancelTask: (taskId: string) => void;

  const statusLabels: Record<TaskStatus, string> = {
    pending: "排队",
    running: "运行中",
    success: "成功",
    failed: "失败",
    cancelled: "已取消",
  };

  function formatTime(value: number) {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
</script>

<footer class="bottom-panel">
  <section class="commit-placeholder">
    <strong>提交信息</strong>
    <span>等待阶段 1.7 接入编辑器</span>
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
