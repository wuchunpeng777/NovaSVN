<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    createSvnOperationTask,
    getFileContentDiff,
    getTask,
    inspectUpdateTarget,
    launchExternalTool,
    resolveTextConflict,
  } from "../lib/api";
  import ConflictResolver from "./workbench/ConflictResolver.svelte";
  import ErrorNotice from "./ErrorNotice.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import type { CommandError, FileContentDiff, SvnOperationKind, Task, TaskStatus, UpdateTargetSummary } from "../types/api";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let externalMergeTool = "";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  let target: UpdateTargetSummary | null = null;
  let contentDiff: FileContentDiff | null = null;
  let loading = true;
  let saving = false;
  let error: CommandError | null = null;
  let task: Task | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  $: taskRunning = !!task && !terminalStatuses.includes(task.status);
  $: authenticationFailure = detectSvnAuthenticationFailure(
    [
      error ? [error.code, error.message, error.detail].filter(Boolean).join("\n") : null,
      task?.error,
    ]
      .filter(Boolean)
      .join("\n") || null,
  );

  onMount(() => {
    void loadConflict();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
  });

  async function loadConflict() {
    const currentGeneration = ++generation;
    loading = true;
    error = null;
    try {
      target = await inspectUpdateTarget({
        path: targetPath.trim(),
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation || !target.relative_path) return;
      contentDiff = await getFileContentDiff({
        working_copy_root: target.working_copy_root,
        file_path: target.relative_path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
    } catch (caught) {
      if (currentGeneration === generation) error = caught as CommandError;
    } finally {
      if (currentGeneration === generation) loading = false;
    }
  }

  async function save(filePath: string, resolvedText: string) {
    if (!target) return false;
    saving = true;
    error = null;
    try {
      await resolveTextConflict({
        working_copy_root: target.working_copy_root,
        file_path: filePath,
        resolved_text: resolvedText,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      return true;
    } catch (caught) {
      error = caught as CommandError;
      return false;
    } finally {
      saving = false;
    }
  }

  async function runFullFileAction(filePath: string, kind: SvnOperationKind) {
    if (!target || taskRunning) return;
    error = null;
    try {
      task = await createSvnOperationTask({
        working_copy_root: target.working_copy_root,
        kind,
        file_path: filePath,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      schedulePoll(task.task_id);
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  function schedulePoll(taskId: string) {
    clearPollTimer();
    pollTimer = window.setTimeout(() => void pollTask(taskId), 250);
  }

  async function pollTask(taskId: string) {
    try {
      task = await getTask(taskId);
      if (task.status === "success") {
        await loadConflict();
        return;
      }
      if (!terminalStatuses.includes(task.status)) schedulePoll(taskId);
      else if (task.status !== "success") error = { code: "CONFLICT_RESOLUTION_FAILED", message: task.error ?? "冲突处理失败", detail: null, recoverable: true };
    } catch (caught) {
      error = caught as CommandError;
    }
  }

  async function openExternalMerge(filePath: string) {
    if (!target || !externalMergeTool.trim()) return;
    try {
      await launchExternalTool({
        kind: "merge",
        tool_path: externalMergeTool.trim(),
        working_copy_root: target.working_copy_root,
        file_path: filePath,
      });
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

  function closeWindow() {
    void getCurrentWindow().close();
  }
</script>

<main class="standalone-conflict" aria-label="NovaSVN Conflict Resolver">
  {#if error}
    <ErrorNotice {error} />
  {/if}
  <ConflictResolver
    open={true}
    filePath={target?.relative_path ?? targetPath}
    {contentDiff}
    {loading}
    saving={saving || taskRunning}
    error={error}
    onClose={closeWindow}
    onSave={save}
    onUseWorking={(path) => void runFullFileAction(path, "resolve_working")}
    onUseMineFull={(path) => void runFullFileAction(path, "resolve_mine_full")}
    onUseTheirsFull={(path) => void runFullFileAction(path, "resolve_theirs_full")}
    onOpenExternalMerge={openExternalMerge}
  />
  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={loadConflict}
    onSubmit={onSvnAuthenticationSubmit}
  />
</main>

<style>
  .standalone-conflict { min-height: 100vh; background: #252a2f; }
  .standalone-conflict > :global(.error-notice) { position: fixed; z-index: 140; top: 8px; left: 8px; right: 8px; }
</style>
