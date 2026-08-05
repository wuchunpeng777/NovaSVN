<script lang="ts">
  import { X } from "@lucide/svelte";
  import type { DetectedSvnAuthenticationFailure } from "../lib/svn-authentication";
  import type { CommandError } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";

  export let failure: DetectedSvnAuthenticationFailure | null = null;
  /** 工作副本本地路径，打开主界面时帮助用户确认是哪个库 */
  export let localPath = "";
  /** 已知仓库 URL（工作副本或目标），优先于 failure 中提取的 URL */
  export let repositoryUrl = "";
  export let savedUsername = "";
  export let rememberPassword = true;
  export let loading = false;
  export let error: CommandError | null = null;
  export let retry: (() => void) | null = null;
  export let onSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  $: displayRepositoryUrl = (repositoryUrl || failure?.repositoryUrl || "").trim();
  $: displayLocalPath = localPath.trim();
  $: displayHostname = failure?.hostname?.trim() || "";

  let preparedSignature: string | null = null;
  let dismissedSignature: string | null = null;
  let username = "";
  let password = "";
  let shouldRememberPassword = true;

  $: open = failure !== null && failure.signature !== dismissedSignature;
  $: if (open && failure && failure.signature !== preparedSignature) {
    preparedSignature = failure.signature;
    username = failure.username ?? savedUsername.trim();
    password = "";
    shouldRememberPassword = rememberPassword;
  }
  $: if (!failure) {
    preparedSignature = null;
    dismissedSignature = null;
  }

  function dismiss() {
    if (loading || !failure) {
      return;
    }
    dismissedSignature = failure.signature;
    password = "";
  }

  async function submit() {
    if (!failure || !username.trim() || !password || loading) {
      return;
    }
    const nextRetry = retry;
    const applied = await onSubmit(username.trim(), password, shouldRememberPassword);
    if (applied) {
      dismissedSignature = failure.signature;
      password = "";
      queueMicrotask(() => nextRetry?.());
    }
  }

  function focusDialog(node: HTMLElement) {
    queueMicrotask(() => {
      const selector = username ? 'input[type="password"]' : 'input[type="text"]';
      node.querySelector<HTMLInputElement>(selector)?.focus();
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      event.target.type !== "checkbox"
    ) {
      event.preventDefault();
      void submit();
    }
  }

  function hostFromUrl(value: string) {
    try {
      return new URL(value).hostname || null;
    } catch {
      return null;
    }
  }
</script>

{#if open && failure}
  <div class="svn-auth-backdrop">
    <div
      class="svn-auth-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="svn-auth-dialog-title"
      tabindex="-1"
      use:focusDialog
      on:keydown={handleKeydown}
    >
      <header>
        <div>
          <h2 id="svn-auth-dialog-title">登录 SVN</h2>
          <p>
            {displayHostname ||
              (displayRepositoryUrl ? hostFromUrl(displayRepositoryUrl) : null) ||
              "SVN 仓库"}
          </p>
        </div>
        <button
          type="button"
          class="dialog-close"
          aria-label="关闭 SVN 登录对话框"
          title="关闭"
          disabled={loading}
          on:click={dismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {#if displayRepositoryUrl || displayLocalPath}
        <div class="svn-auth-target" aria-label="认证目标仓库">
          {#if displayRepositoryUrl}
            <div>
              <span>仓库 URL</span>
              <code title={displayRepositoryUrl}>{displayRepositoryUrl}</code>
            </div>
          {/if}
          {#if displayLocalPath}
            <div>
              <span>本地路径</span>
              <code title={displayLocalPath}>{displayLocalPath}</code>
            </div>
          {/if}
        </div>
      {/if}

      <div class="svn-auth-fields">
        <label>
          <span>用户名</span>
          <input type="text" autocomplete="username" bind:value={username} disabled={loading} />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            autocomplete="current-password"
            bind:value={password}
            disabled={loading}
          />
        </label>
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={shouldRememberPassword} disabled={loading} />
          <span>保存到系统凭据存储</span>
        </label>
      </div>

      <ErrorNotice {error} />
      <footer>
        <button type="button" on:click={dismiss} disabled={loading}>取消</button>
        <button
          type="button"
          class="primary"
          on:click={submit}
          disabled={loading || !username.trim() || !password}
        >
          {loading ? "正在登录" : retry ? "登录并重试" : "应用认证"}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .svn-auth-backdrop {
    position: fixed;
    z-index: 100;
    inset: 0;
    display: grid;
    place-items: center;
    background: #626a73;
    padding: 24px;
  }

  .svn-auth-dialog {
    display: grid;
    gap: 14px;
    width: min(480px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    border: 1px solid #aeb8c2;
    border-radius: 8px;
    background: #ffffff;
    color: #17202a;
    padding: 16px;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  header h2,
  header p {
    margin: 0;
  }

  header h2 {
    font-size: 16px;
  }

  header p,
  .svn-auth-fields > label:not(.checkbox-row) > span,
  .svn-auth-target span {
    color: #687482;
    font-size: 12px;
  }

  .svn-auth-target {
    display: grid;
    gap: 8px;
    border: 1px solid #d7dde4;
    border-radius: 6px;
    background: #f5f7f9;
    padding: 10px 12px;
  }

  .svn-auth-target > div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .svn-auth-target code {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: #17202a;
    font-family: Consolas, "Courier New", monospace;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }

  .svn-auth-fields {
    display: grid;
    gap: 12px;
  }

  .svn-auth-fields > label:not(.checkbox-row) {
    display: grid;
    gap: 5px;
  }

  input[type="text"],
  input[type="password"] {
    width: 100%;
    min-height: 30px;
    border: 1px solid #b8c2cc;
    border-radius: 6px;
    background: #ffffff;
    color: #17202a;
    padding: 5px 8px;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  button {
    min-height: 30px;
    border: 1px solid #b8c2cc;
    border-radius: 6px;
    background: #ffffff;
    color: #17202a;
    padding: 4px 12px;
    cursor: pointer;
  }

  button.primary {
    border-color: #2f6fab;
    background: #2f7dca;
    color: #ffffff;
  }

  button:disabled {
    border-color: #d7dde4;
    background: #eef1f4;
    color: #8b96a2;
    cursor: default;
  }

  .dialog-close {
    display: grid;
    width: 30px;
    height: 30px;
    min-height: 30px;
    flex: 0 0 30px;
    place-items: center;
    padding: 0;
  }

  footer {
    justify-content: flex-end;
  }

  :global([data-theme="dark"]) .svn-auth-backdrop {
    background: #111418;
  }

  :global([data-theme="dark"]) .svn-auth-dialog {
    border-color: #505054;
    background: #29292b;
    color: #f2f2f4;
  }

  :global([data-theme="dark"]) header p,
  :global([data-theme="dark"]) .svn-auth-fields > label:not(.checkbox-row) > span,
  :global([data-theme="dark"]) .svn-auth-target span {
    color: #a9a9ae;
  }

  :global([data-theme="dark"]) .svn-auth-target {
    border-color: #505054;
    background: #222225;
  }

  :global([data-theme="dark"]) .svn-auth-target code {
    color: #f2f2f4;
  }

  :global([data-theme="dark"]) input[type="text"],
  :global([data-theme="dark"]) input[type="password"],
  :global([data-theme="dark"]) button {
    border-color: #505054;
    background: #353538;
    color: #f2f2f4;
  }

  :global([data-theme="dark"]) button.primary {
    border-color: #0a84ff;
    background: #0a84ff;
    color: #ffffff;
  }
</style>
