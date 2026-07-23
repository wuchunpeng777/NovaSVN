<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { File, Folder, RefreshCw, X } from "@lucide/svelte";
  import { getPathSvnLog, getRepositoryFileLog, getSvnLog } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import type { CommandError, SvnLog, SvnLogEntry } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";

  export let revision: string;
  export let targetPath = "";
  export let workingCopyRoot = "";
  export let filePath = "";
  export let repositoryUrl = "";
  export let repositoryRevision = "";
  export let svnExecutable: string | undefined = undefined;
  export let theme: "light" | "dark" = "light";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;
  export let onClose: () => void = () => {};

  let dialogElement: HTMLDivElement | null = null;
  let entry: SvnLogEntry | null = null;
  let loading = false;
  let error: CommandError | null = null;
  let requestGeneration = 0;

  $: authenticationFailure = detectSvnAuthenticationFailure(commandErrorText(error));

  onMount(() => {
    queueMicrotask(() => dialogElement?.focus());
    void loadRevisionLog();
  });

  onDestroy(() => {
    requestGeneration += 1;
  });

  async function loadRevisionLog() {
    const selectedRevision = revision.trim();
    if (!selectedRevision) {
      error = commandError(
        "SVN_REVISION_LOG_MISSING",
        "没有可读取的 Revision",
        "请重新选择 Blame 中的 Revision。",
      );
      return;
    }

    const generation = ++requestGeneration;
    loading = true;
    error = null;
    entry = null;
    try {
      const log = await requestRevisionLog(selectedRevision);
      if (generation !== requestGeneration) {
        return;
      }
      entry = log.entries.find((candidate) => candidate.revision === selectedRevision) ?? null;
      if (!entry) {
        throw commandError(
          "SVN_REVISION_LOG_NOT_FOUND",
          `未找到 r${selectedRevision} 的 Log 信息`,
          "该路径在所选 Revision 中可能不可见或已被移动。",
        );
      }
    } catch (caught) {
      if (generation === requestGeneration) {
        error = normalizeCommandError(caught);
      }
    } finally {
      if (generation === requestGeneration) {
        loading = false;
      }
    }
  }

  function requestRevisionLog(selectedRevision: string): Promise<SvnLog> {
    const executable = svnExecutable?.trim() || undefined;
    if (repositoryUrl.trim()) {
      return getRepositoryFileLog({
        url: repositoryUrl.trim(),
        revision: repositoryRevision.trim() || selectedRevision,
        svn_executable: executable,
        limit: 1,
        start_revision: selectedRevision,
      });
    }
    if (workingCopyRoot.trim()) {
      return getSvnLog({
        working_copy_root: workingCopyRoot.trim(),
        file_path: filePath.trim() || undefined,
        svn_executable: executable,
        limit: 1,
        start_revision: selectedRevision,
      });
    }
    return getPathSvnLog({
      path: targetPath.trim(),
      svn_executable: executable,
      limit: 1,
      start_revision: selectedRevision,
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function formatDate(value: string) {
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
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function normalizeCommandError(value: unknown): CommandError {
    if (value && typeof value === "object" && "message" in value) {
      const candidate = value as Partial<CommandError>;
      return {
        code: candidate.code || "SVN_REVISION_LOG_FAILED",
        message: String(candidate.message || "无法读取 Revision Log"),
        detail: candidate.detail ?? null,
        recoverable: candidate.recoverable ?? true,
      };
    }
    return commandError("SVN_REVISION_LOG_FAILED", "无法读取 Revision Log", String(value));
  }

  function commandError(code: string, message: string, detail: string): CommandError {
    return { code, message, detail, recoverable: true };
  }

  function commandErrorText(value: CommandError | null) {
    return value
      ? [value.code, value.message, value.detail].filter(Boolean).join("\n")
      : null;
  }
</script>

<div
  class="revision-log-backdrop"
  data-theme={theme}
  role="presentation"
  tabindex="-1"
  on:click|self={onClose}
>
  <div
    bind:this={dialogElement}
    class="revision-log-dialog"
    role="dialog"
    aria-modal="true"
    aria-label={`r${revision} Log 信息`}
    tabindex="-1"
    on:keydown={handleKeydown}
  >
    <header>
      <div>
        <h2>Revision r{revision}</h2>
        <p>提交信息</p>
      </div>
      <button type="button" class="icon-button" aria-label="关闭 Revision Log" title="关闭" on:click={onClose}>
        <X size={17} aria-hidden="true" />
      </button>
    </header>

    <div class="revision-log-body" aria-busy={loading}>
      {#if loading}
        <div class="dialog-status" role="status">正在读取 r{revision} 的 Log...</div>
      {:else if error}
        <ErrorNotice {error} />
        <button type="button" class="retry-button" on:click={loadRevisionLog}>
          <RefreshCw size={15} aria-hidden="true" /> 重试
        </button>
      {:else if entry}
        <dl class="revision-metadata">
          <div><dt>Revision</dt><dd>r{entry.revision}</dd></div>
          <div><dt>作者</dt><dd>{entry.author || "-"}</dd></div>
          <div><dt>时间</dt><dd><time datetime={entry.date}>{formatDate(entry.date)}</time></dd></div>
        </dl>

        <section class="message-section" aria-label="提交日志">
          <h3>提交日志</h3>
          <p>{entry.message || "无提交信息"}</p>
        </section>

        <section class="changed-paths-section" aria-label="涉及路径">
          <h3>涉及路径 <span>{entry.changed_paths.length}</span></h3>
          {#if entry.changed_paths.length > 0}
            <div class="changed-path-list">
              {#each entry.changed_paths as path (`${path.action}:${path.path}`)}
                <div class="changed-path-row">
                  <span class="change-action" data-action={path.action}>{path.action || "-"}</span>
                  <span class="path-icon" aria-hidden="true">
                    {#if path.kind === "dir"}<Folder size={15} />{:else}<File size={15} />{/if}
                  </span>
                  <code title={path.path}>{path.path}</code>
                  <small>{path.kind === "dir" ? "目录" : "文件"}</small>
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty-paths">该提交没有返回路径变化</p>
          {/if}
        </section>
      {/if}
    </div>

    <footer>
      <button type="button" on:click={onClose}>关闭</button>
    </footer>
  </div>

  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={loadRevisionLog}
    onSubmit={onSvnAuthenticationSubmit}
  />
</div>

<style>
  .revision-log-backdrop {
    --dialog-panel: #ffffff;
    --dialog-subtle: #f3f5f7;
    --dialog-border: #cfd6dd;
    --dialog-text: #17202a;
    --dialog-secondary: #687482;
    --dialog-accent: #2674b9;
    position: fixed;
    z-index: 80;
    display: grid;
    inset: 0;
    background: rgb(0 0 0 / 38%);
    padding: 24px;
    color: var(--dialog-text);
    place-items: center;
  }

  .revision-log-backdrop[data-theme="dark"] {
    --dialog-panel: #29292b;
    --dialog-subtle: #242426;
    --dialog-border: #505054;
    --dialog-text: #f2f2f4;
    --dialog-secondary: #aaaab0;
    --dialog-accent: #55a7ef;
    color-scheme: dark;
  }

  .revision-log-dialog {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: min(720px, calc(100vw - 32px));
    max-height: min(760px, calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid var(--dialog-border);
    border-radius: 8px;
    background: var(--dialog-panel);
    box-shadow: 0 18px 52px rgb(0 0 0 / 28%);
  }

  .revision-log-dialog > header,
  .revision-log-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
  }

  .revision-log-dialog > header {
    border-bottom: 1px solid var(--dialog-border);
  }

  .revision-log-dialog > footer {
    justify-content: flex-end;
    border-top: 1px solid var(--dialog-border);
  }

  h2,
  h3,
  p,
  dl,
  dt,
  dd {
    margin: 0;
  }

  h2 {
    font-size: 16px;
  }

  header p {
    margin-top: 2px;
    color: var(--dialog-secondary);
    font-size: 11px;
  }

  button {
    min-height: 30px;
    border: 1px solid var(--dialog-border);
    border-radius: 5px;
    background: var(--dialog-panel);
    padding: 4px 12px;
    color: var(--dialog-text);
    font: inherit;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    border-color: var(--dialog-accent);
    color: var(--dialog-accent);
  }

  .icon-button {
    display: grid;
    width: 30px;
    padding: 0;
    place-items: center;
  }

  .revision-log-body {
    display: grid;
    align-content: start;
    gap: 16px;
    min-height: 220px;
    overflow: auto;
    padding: 14px;
  }

  .dialog-status {
    display: grid;
    min-height: 180px;
    color: var(--dialog-secondary);
    font-size: 12px;
    place-items: center;
  }

  .retry-button {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 6px;
  }

  .revision-metadata {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--dialog-border);
    border-radius: 6px;
    background: var(--dialog-subtle);
  }

  .revision-metadata > div {
    min-width: 0;
    padding: 9px 11px;
  }

  .revision-metadata > div + div {
    border-left: 1px solid var(--dialog-border);
  }

  dt {
    color: var(--dialog-secondary);
    font-size: 10px;
  }

  dd {
    overflow: hidden;
    margin-top: 3px;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3 {
    margin-bottom: 7px;
    font-size: 12px;
  }

  h3 span {
    margin-left: 4px;
    color: var(--dialog-secondary);
    font-weight: 400;
  }

  .message-section > p,
  .empty-paths {
    border: 1px solid var(--dialog-border);
    border-radius: 6px;
    background: var(--dialog-subtle);
    padding: 10px 11px;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .changed-path-list {
    display: grid;
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--dialog-border);
    border-radius: 6px;
    background: var(--dialog-border);
  }

  .changed-path-row {
    display: grid;
    grid-template-columns: 24px 16px minmax(0, 1fr) 32px;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    background: var(--dialog-panel);
    padding: 4px 7px;
  }

  .change-action {
    display: grid;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: #dfe6ed;
    color: #536070;
    font-size: 10px;
    font-weight: 700;
    place-items: center;
  }

  .change-action[data-action="A"] { background: #dff2e4; color: #24733a; }
  .change-action[data-action="M"] { background: #fff0c7; color: #805900; }
  .change-action[data-action="D"] { background: #fbe0df; color: #a12f2b; }

  [data-theme="dark"] .change-action[data-action="A"] { background: #1f4b2d; color: #8fdaa2; }
  [data-theme="dark"] .change-action[data-action="M"] { background: #4b3b16; color: #f6cf73; }
  [data-theme="dark"] .change-action[data-action="D"] { background: #522725; color: #ffaaa7; }

  .path-icon {
    display: grid;
    color: var(--dialog-secondary);
    place-items: center;
  }

  .changed-path-row code {
    min-width: 0;
    overflow: hidden;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .changed-path-row small {
    color: var(--dialog-secondary);
    font-size: 10px;
    text-align: right;
  }

  .empty-paths {
    color: var(--dialog-secondary);
    text-align: center;
  }

  @media (max-width: 620px) {
    .revision-log-backdrop { padding: 8px; }
    .revision-metadata { grid-template-columns: 1fr; }
    .revision-metadata > div + div {
      border-top: 1px solid var(--dialog-border);
      border-left: 0;
    }
  }
</style>
