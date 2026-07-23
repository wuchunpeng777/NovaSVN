<script lang="ts">
  import { tick } from "svelte";
  import { ChevronDown, ChevronUp, CircleCheck, CircleX, Download, Square } from "@lucide/svelte";
  import { getWorkspacePathSizes } from "../lib/api";
  import { extractSvnFileChanges } from "../lib/svn-operation-output";
  import type { CommandError, Task, TaskStatus } from "../types/api";
  import OperationMetrics from "./OperationMetrics.svelte";

  export let workingCopyRoot: string;
  export let task: Task | null = null;
  export let minimized = false;
  export let theme: "light" | "dark" = "light";
  export let onToggleMinimized: () => void = () => {};
  export let onStop: () => void = () => {};

  let fileSizes = new Map<string, number>();
  let sizeSignature = "";
  let sizeRequestGeneration = 0;
  let outputElement: HTMLDivElement | null = null;
  let outputSignature = "";

  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  $: files = extractSvnFileChanges(task?.logs ?? [], workingCopyRoot);
  $: running = task === null || task.status === "pending" || task.status === "running";
  $: totalBytes = files.reduce((total, file) => total + (fileSizes.get(file.path) ?? 0), 0);
  $: statusLabel = taskStatusLabel(task);
  $: lastFile = files.length > 0 ? files[files.length - 1].path : null;
  $: fileSignature = `${task?.task_id ?? ""}:${files.map((file) => `${file.path}:${file.action}`).join("|")}`;
  $: if (fileSignature !== sizeSignature) {
    sizeSignature = fileSignature;
    void refreshFileSizes(files.map((file) => file.path));
  }
  $: nextOutputSignature = `${task?.status ?? "pending"}:${task?.logs.length ?? 0}:${minimized}`;
  $: if (!minimized && nextOutputSignature !== outputSignature) {
    outputSignature = nextOutputSignature;
    void scrollOutputToBottom(nextOutputSignature);
  }

  async function refreshFileSizes(paths: string[]) {
    const generation = ++sizeRequestGeneration;
    if (paths.length === 0) {
      fileSizes = new Map();
      return;
    }
    try {
      const sizes = await getWorkspacePathSizes({
        working_copy_root: workingCopyRoot,
        paths,
      });
      if (generation !== sizeRequestGeneration) {
        return;
      }
      fileSizes = new Map(sizes.map((size) => [size.path, size.bytes]));
    } catch {
      if (generation === sizeRequestGeneration) {
        fileSizes = new Map();
      }
    }
  }

  async function scrollOutputToBottom(signature: string) {
    await tick();
    if (signature === outputSignature && outputElement) {
      outputElement.scrollTop = outputElement.scrollHeight;
    }
  }

  function taskStatusLabel(value: Task | null) {
    switch (value?.status) {
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
        return "准备更新";
    }
  }

  function taskError(value: Task | null): CommandError | null {
    if (!value?.error) {
      return null;
    }
    return {
      code: "UPDATE_FAILED",
      message: "Update 失败",
      detail: value.error,
      recoverable: true,
    };
  }
</script>

<section
  class="inline-update-panel"
  class:minimized
  aria-label="主界面 Update"
  data-status={task?.status ?? "pending"}
  data-theme={theme}
>
  <header class="inline-update-header">
    <div class="inline-update-heading">
      <span class="inline-update-icon" aria-hidden="true"><Download size={16} /></span>
      <div>
        <strong>Update</strong>
        <span title={workingCopyRoot}>{workingCopyRoot}</span>
      </div>
    </div>
    <div class="inline-update-actions">
      <span class="inline-update-status" data-status={task?.status ?? "pending"}>{statusLabel}</span>
      {#if running}
        <button type="button" class="inline-update-stop" aria-label="停止 Update" title="停止 Update" on:click={onStop}>
          <Square size={13} fill="currentColor" aria-hidden="true" />
        </button>
      {/if}
      <button
        type="button"
        class="inline-update-toggle"
        aria-label={minimized ? "展开 Update 详情" : "最小化 Update"}
        title={minimized ? "展开 Update 详情" : "最小化 Update"}
        on:click={onToggleMinimized}
      >
        {#if minimized}<ChevronDown size={16} aria-hidden="true" />{:else}<ChevronUp size={16} aria-hidden="true" />{/if}
      </button>
    </div>
  </header>

  <div class="inline-update-summary" aria-label="Update 简要信息">
    <span>文件 <strong>{files.length}</strong></span>
    <OperationMetrics task={task} totalBytes={totalBytes} label="总更新量" {running} active={running} />
    {#if lastFile}<span class="inline-update-last-file" title={lastFile}>最近 <code>{lastFile}</code></span>{/if}
  </div>

  {#if !minimized}
    <div class="inline-update-details">
      {#if taskError(task)}
        <div class="inline-update-error" role="alert"><CircleX size={15} aria-hidden="true" /> {taskError(task)?.detail}</div>
      {/if}
      <div bind:this={outputElement} class="inline-update-output" role="log" aria-live="polite" aria-busy={running}>
        {#if files.length > 0}
          {#each files as file (file.path)}
            <div class="inline-update-file" data-kind={file.action} role="listitem" aria-label={`更新文件 ${file.path}`}>
              <span>{file.action}</span><code title={file.path}>{file.path}</code>
            </div>
          {/each}
        {:else if running}
          <div class="inline-update-empty" role="status">正在等待更新文件...</div>
        {:else if task && terminalStatuses.includes(task.status)}
          <div class="inline-update-empty">没有更新文件</div>
        {/if}
        {#if task?.status === "success"}
          <div class="inline-update-complete" role="status"><CircleCheck size={15} aria-hidden="true" /> 更新完成</div>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .inline-update-panel {
    --panel: #ffffff;
    --subtle: #f4f6f8;
    --border: #cfd6dd;
    --text: #17202a;
    --secondary: #687482;
    --accent: #2674b9;
    display: grid;
    gap: 0;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
  }

  .inline-update-panel[data-status="failed"] { border-bottom-color: #d86b73; }
  .inline-update-panel[data-status="success"] { border-bottom-color: #70aa82; }
  .inline-update-header, .inline-update-summary { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 9px 16px; }
  .inline-update-header { justify-content: space-between; }
  .inline-update-heading, .inline-update-actions { display: flex; align-items: center; min-width: 0; gap: 9px; }
  .inline-update-heading > div { display: grid; min-width: 0; gap: 2px; }
  .inline-update-heading > div > span { overflow: hidden; max-width: min(50vw, 720px); color: var(--secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .inline-update-icon { display: grid; width: 26px; height: 26px; border-radius: 5px; background: var(--accent); color: #fff; place-items: center; }
  .inline-update-status { color: var(--secondary); font-size: 12px; }
  .inline-update-status[data-status="success"] { color: #307a45; }
  .inline-update-status[data-status="failed"] { color: #b3424d; }
  .inline-update-toggle, .inline-update-stop { display: grid; width: 26px; height: 26px; border: 0; border-radius: 5px; background: transparent; color: var(--secondary); cursor: pointer; place-items: center; }
  .inline-update-toggle:hover, .inline-update-stop:hover { background: var(--subtle); color: var(--accent); }
  .inline-update-stop:hover { color: #b3424d; }
  .inline-update-summary { flex-wrap: wrap; border-top: 1px solid var(--border); color: var(--secondary); font-size: 11px; }
  .inline-update-summary > span { white-space: nowrap; }
  .inline-update-summary strong { color: var(--text); font-variant-numeric: tabular-nums; }
  .inline-update-summary :global(.operation-metrics) { gap: 14px; font-size: 11px; }
  .inline-update-last-file { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .inline-update-last-file code { color: var(--text); }
  .inline-update-details { border-top: 1px solid var(--border); padding: 0 16px 10px; }
  .inline-update-output { max-height: 210px; overflow: auto; padding-top: 5px; }
  .inline-update-file { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; align-items: center; min-height: 25px; font-size: 12px; }
  .inline-update-file > span { color: var(--accent); font-weight: 700; }
  .inline-update-file[data-kind*="C"] > span { color: #b3424d; }
  .inline-update-file code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inline-update-empty { color: var(--secondary); padding: 12px 0 3px; font-size: 12px; }
  .inline-update-error, .inline-update-complete { display: flex; align-items: center; gap: 7px; padding-top: 9px; font-size: 12px; }
  .inline-update-error { color: #b3424d; }
  .inline-update-complete { color: #307a45; }
  .inline-update-panel[data-theme="dark"] { --panel: #29292b; --subtle: #353538; --border: #505054; --text: #f2f2f4; --secondary: #aaaab0; --accent: #55a7ef; color-scheme: dark; }
</style>
