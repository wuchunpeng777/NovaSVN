<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { Clipboard, Info, RefreshCw, Check } from "@lucide/svelte";
  import { getSvnInfo } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import type { CommandError, SvnInfo } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";

  export let targetPath: string;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  let info: SvnInfo | null = null;
  let loading = false;
  let error: CommandError | null = null;
  let requestGeneration = 0;
  let copiedField: string | null = null;
  let copiedTimer: number | null = null;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: authenticationFailure = detectSvnAuthenticationFailure(commandErrorText(error));
  $: authenticationRetry = authenticationFailure ? loadInfo : null;

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("keydown", handleWindowKeydown);
    void loadInfo();
  });

  onDestroy(() => {
    requestGeneration += 1;
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
    window.removeEventListener("keydown", handleWindowKeydown);
    if (copiedTimer !== null) {
      window.clearTimeout(copiedTimer);
    }
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    void getCurrentWindow().close();
  }

  async function loadInfo() {
    const path = targetPath.trim();
    if (!path) {
      error = {
        code: "SVN_INFO_TARGET_MISSING",
        message: "没有可读取的 SVN 路径",
        detail: "请从 Windows 资源管理器中的文件或目录右键打开 NovaSVN Info。",
        recoverable: false,
      };
      info = null;
      return;
    }

    const generation = ++requestGeneration;
    loading = true;
    error = null;
    try {
      const result = await getSvnInfo({
        path,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (generation !== requestGeneration) {
        return;
      }
      info = result;
    } catch (caught) {
      if (generation === requestGeneration) {
        info = null;
        error = normalizeCommandError(caught);
      }
    } finally {
      if (generation === requestGeneration) {
        loading = false;
      }
    }
  }

  async function copyValue(field: string, value: string | null | undefined) {
    if (!value || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      copiedField = field;
      if (copiedTimer !== null) {
        window.clearTimeout(copiedTimer);
      }
      copiedTimer = window.setTimeout(() => {
        copiedField = null;
        copiedTimer = null;
      }, 1600);
    } catch {
      copiedField = null;
    }
  }

  function display(value: string | null | undefined) {
    return value?.trim() || "-";
  }

  function formatDate(value: string | null | undefined) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
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
    if (typeof value === "object" && value !== null) {
      const candidate = value as Partial<CommandError>;
      return {
        code: candidate.code ?? "SVN_INFO_FAILED",
        message: candidate.message ?? "读取 SVN 信息失败",
        detail: candidate.detail ?? null,
        recoverable: candidate.recoverable ?? true,
      };
    }
    return {
      code: "SVN_INFO_FAILED",
      message: "读取 SVN 信息失败",
      detail: String(value || "未知错误"),
      recoverable: true,
    };
  }

  function commandErrorText(value: CommandError | null) {
    return value ? [value.code, value.message, value.detail].filter(Boolean).join("\n") : null;
  }
</script>

<main class="standalone-info" data-theme={resolvedTheme} aria-label="NovaSVN Info">
  <header class="info-titlebar">
    <div class="info-heading">
      <span class="info-mark" aria-hidden="true"><Info size={18} /></span>
      <div>
        <h1>SVN Info</h1>
        <p title={targetPath}>{(info?.target_path ?? targetPath) || "未选择路径"}</p>
      </div>
    </div>
    <div class="info-actions">
      {#if loading}<span class="info-status">正在读取</span>{:else if info}<span class="info-status">已加载</span>{/if}
      <button
        type="button"
        class="icon-button"
        aria-label="刷新 SVN Info"
        title="刷新 SVN Info"
        disabled={loading}
        on:click={loadInfo}
      >
        <RefreshCw size={17} class={loading ? "info-spinning" : undefined} aria-hidden="true" />
      </button>
    </div>
  </header>

  <div class="info-notice"><ErrorNotice {error} /></div>

  <section class="info-content" aria-busy={loading}>
    {#if loading && !info}
      <div class="info-empty" role="status">正在读取 SVN 信息...</div>
    {:else if info}
      <dl class="info-grid">
        <div><dt>本地路径</dt><dd title={info.target_path}>{info.target_path}</dd></div>
        <div><dt>节点类型</dt><dd>{info.kind === "dir" ? "目录" : info.kind === "file" ? "文件" : display(info.kind)}</dd></div>
        <div><dt>工作副本根</dt><dd class="copyable"><span title={info.working_copy_root}>{info.working_copy_root}</span><button type="button" class="copy-button" aria-label="复制工作副本根" title="复制工作副本根" on:click={() => copyValue("working_copy_root", info.working_copy_root)}>{#if copiedField === "working_copy_root"}<Check size={14} />{:else}<Clipboard size={14} />{/if}</button></dd></div>
        <div><dt>相对路径</dt><dd title={info.relative_path ?? undefined}>{display(info.relative_path)}</dd></div>
        <div><dt>仓库 URL</dt><dd class="copyable"><span title={info.repository_url}>{info.repository_url}</span><button type="button" class="copy-button" aria-label="复制仓库 URL" title="复制仓库 URL" on:click={() => copyValue("repository_url", info.repository_url)}>{#if copiedField === "repository_url"}<Check size={14} />{:else}<Clipboard size={14} />{/if}</button></dd></div>
        <div><dt>仓库根 URL</dt><dd class="copyable"><span title={info.repository_root}>{info.repository_root}</span><button type="button" class="copy-button" aria-label="复制仓库根 URL" title="复制仓库根 URL" on:click={() => copyValue("repository_root", info.repository_root)}>{#if copiedField === "repository_root"}<Check size={14} />{:else}<Clipboard size={14} />{/if}</button></dd></div>
        <div><dt>仓库 UUID</dt><dd>{display(info.repository_uuid)}</dd></div>
        <div><dt>Revision</dt><dd>{info.revision ? `r${info.revision}` : "-"}</dd></div>
        <div><dt>最后变更 Revision</dt><dd>{info.last_changed_revision ? `r${info.last_changed_revision}` : "-"}</dd></div>
        <div><dt>最后变更作者</dt><dd>{display(info.last_changed_author)}</dd></div>
        <div><dt>最后变更时间</dt><dd title={info.last_changed_date ?? undefined}>{formatDate(info.last_changed_date)}</dd></div>
      </dl>
    {:else if !error}
      <div class="info-empty">没有可显示的 SVN 信息</div>
    {/if}
  </section>

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
  .standalone-info {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f1f3f5;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    font-family: "Segoe UI", sans-serif;
    color-scheme: light;
  }

  .standalone-info[data-theme="dark"] {
    --background: #1f1f21;
    --panel: #29292b;
    --panel-subtle: #242426;
    --text: #f2f2f4;
    --secondary: #aaaab0;
    --border: #505054;
    --accent: #55a7ef;
    color-scheme: dark;
  }

  .info-titlebar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; border-bottom: 1px solid var(--border); background: var(--panel); padding: 11px 15px; }
  .info-heading, .info-actions { display: flex; align-items: center; min-width: 0; }
  .info-heading { gap: 10px; }
  .info-mark { display: grid; width: 30px; height: 30px; border-radius: 6px; background: var(--accent); color: #fff; place-items: center; }
  h1, p { margin: 0; }
  h1 { font-size: 18px; line-height: 1.2; }
  .info-heading p { max-width: min(70vw, 900px); overflow: hidden; margin-top: 3px; color: var(--secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .info-actions { gap: 10px; color: var(--secondary); }
  .info-status { font-size: 12px; }
  .icon-button, .copy-button { display: grid; border: 0; border-radius: 5px; background: transparent; color: var(--secondary); cursor: pointer; place-items: center; }
  .icon-button { width: 30px; height: 30px; }
  .copy-button { width: 24px; height: 24px; flex: 0 0 24px; }
  .icon-button:hover:not(:disabled), .copy-button:hover { background: var(--panel-subtle); color: var(--accent); }
  button:disabled { cursor: default; opacity: .55; }
  .info-notice { min-height: 0; }
  .info-content { min-height: 0; overflow: auto; padding: 12px; }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(280px, 1fr));
    gap: 1px;
    width: 100%;
    min-width: 100%;
    min-height: 100%;
    border: 1px solid var(--border);
    background: var(--border);
    resize: both;
    overflow: auto;
  }
  .info-grid > div { display: grid; grid-template-columns: minmax(150px, .35fr) minmax(0, 1fr); gap: 16px; min-width: 0; background: var(--panel); padding: 12px 14px; }
  dt { color: var(--secondary); font-size: 12px; }
  dd { min-width: 0; overflow: hidden; margin: 0; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .copyable { display: flex; align-items: center; gap: 5px; }
  .copyable > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .info-empty { display: grid; min-height: 240px; color: var(--secondary); place-items: center; }
  :global(.info-spinning) { animation: info-spin 1s linear infinite; }
  @keyframes info-spin { to { transform: rotate(360deg); } }
  @media (max-width: 720px) {
    .info-grid { grid-template-columns: 1fr; }
    .info-content { padding: 12px; }
  }
</style>
