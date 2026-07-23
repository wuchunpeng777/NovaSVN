<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { CircleCheck, Download, FolderOpen, RotateCw, Square } from "@lucide/svelte";
  import {
    cancelTask,
    chooseCheckoutTargetDirectory,
    createRepositoryCheckoutTask,
    getTask,
    openLocalPathLocation,
  } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import { extractSvnFileChanges } from "../lib/svn-operation-output";
  import type { CommandError, Task, TaskStatus } from "../types/api";
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

  let repositoryUrl = "";
  let localPath = targetPath.trim();
  let revision = "";
  let checkoutTask: Task | null = null;
  let commandError: CommandError | null = null;
  let locationError: CommandError | null = null;
  let outputElement: HTMLDivElement | null = null;
  let repositoryUrlElement: HTMLInputElement | null = null;
  let pollTimer: number | null = null;
  let generation = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let autoFollowOutput = true;
  let expectedAutoScrollTop: number | null = null;

  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: checkoutRunning = isTaskRunning(checkoutTask);
  $: checkoutComplete = checkoutTask?.status === "success";
  $: checkedOutFiles = extractSvnFileChanges(checkoutTask?.logs ?? [], localPath.trim());
  $: authenticationFailure =
    detectSvnAuthenticationFailure(commandErrorText(commandError)) ??
    detectSvnAuthenticationFailure(checkoutTask?.error ?? null) ??
    detectSvnAuthenticationFailure(commandErrorText(locationError));

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    repositoryUrlElement?.focus();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
  });

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  async function startCheckout() {
    if (checkoutRunning) {
      return;
    }

    const url = repositoryUrl.trim();
    const destination = localPath.trim();
    const requestedRevision = revision.trim();
    if (!url) {
      commandError = formError(
        "CHECKOUT_URL_MISSING",
        "请输入仓库 URL",
        "Checkout 需要一个 SVN 仓库 URL。",
      );
      repositoryUrlElement?.focus();
      return;
    }
    if (!destination) {
      commandError = formError(
        "CHECKOUT_PATH_MISSING",
        "请输入本地目录",
        "请选择一个空目录作为 Checkout 目标。",
      );
      return;
    }
    if (requestedRevision && !/^\d+$/.test(requestedRevision)) {
      commandError = formError(
        "CHECKOUT_REVISION_INVALID",
        "Revision 无效",
        "Revision 必须是数字，留空则使用 HEAD。",
      );
      return;
    }

    const currentGeneration = ++generation;
    clearPollTimer();
    commandError = null;
    locationError = null;
    checkoutTask = null;
    autoFollowOutput = true;
    expectedAutoScrollTop = null;
    try {
      const task = await createRepositoryCheckoutTask({
        url,
        local_path: destination,
        revision: requestedRevision || undefined,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      checkoutTask = task;
      await followOutput();
      schedulePoll(task.task_id, currentGeneration, 0);
    } catch (caught) {
      if (currentGeneration === generation) {
        commandError = normalizeCommandError(caught);
      }
    }
  }

  function schedulePoll(taskId: string, currentGeneration: number, delay: number) {
    clearPollTimer();
    pollTimer = window.setTimeout(
      () => void pollTask(taskId, currentGeneration),
      delay,
    );
  }

  async function pollTask(taskId: string, currentGeneration: number) {
    try {
      const task = await getTask(taskId);
      if (currentGeneration !== generation) {
        return;
      }
      checkoutTask = task;
      await followOutput();
      if (terminalStatuses.includes(task.status)) {
        clearPollTimer();
        await followOutput(true);
        return;
      }
      schedulePoll(taskId, currentGeneration, 350);
    } catch (caught) {
      if (currentGeneration === generation) {
        commandError = normalizeCommandError(caught);
      }
    }
  }

  async function stopCheckout() {
    if (!checkoutTask || !checkoutRunning) {
      return;
    }
    try {
      checkoutTask = await cancelTask(checkoutTask.task_id);
      if (isTaskRunning(checkoutTask)) {
        schedulePoll(checkoutTask.task_id, generation, 200);
      } else {
        clearPollTimer();
        await followOutput();
      }
    } catch (caught) {
      commandError = normalizeCommandError(caught);
    }
  }

  async function chooseTargetDirectory() {
    if (checkoutRunning) {
      return;
    }
    try {
      const selected = await chooseCheckoutTargetDirectory();
      if (selected) {
        localPath = selected;
        commandError = null;
      }
    } catch (caught) {
      commandError = normalizeCommandError(caught);
    }
  }

  async function showCheckoutLocation() {
    if (!checkoutComplete) {
      return;
    }
    locationError = null;
    try {
      await openLocalPathLocation({ path: localPath.trim() });
    } catch (caught) {
      locationError = normalizeCommandError(caught);
    }
  }

  async function followOutput(force = false) {
    await tick();
    if ((!autoFollowOutput && !force) || !outputElement) {
      return;
    }
    const targetScrollTop = Math.max(
      0,
      outputElement.scrollHeight - outputElement.clientHeight,
    );
    expectedAutoScrollTop = targetScrollTop;
    outputElement.scrollTop = targetScrollTop;
  }

  function handleOutputScroll() {
    if (!outputElement) {
      return;
    }
    if (
      expectedAutoScrollTop !== null &&
      Math.abs(outputElement.scrollTop - expectedAutoScrollTop) <= 1
    ) {
      expectedAutoScrollTop = null;
      return;
    }
    expectedAutoScrollTop = null;
    autoFollowOutput = false;
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function clearFormError() {
    commandError = null;
    locationError = null;
  }

  function isTaskRunning(task: Task | null) {
    return task?.status === "pending" || task?.status === "running";
  }

  function taskStatusLabel(task: Task | null) {
    switch (task?.status) {
      case "pending":
        return "等待执行";
      case "running":
        return "正在 Checkout";
      case "success":
        return "Checkout 完成";
      case "failed":
        return "Checkout 失败";
      case "cancelled":
        return "已取消";
      case "interrupted":
        return "已中断";
      default:
        return "等待开始";
    }
  }

  function formError(code: string, message: string, detail: string): CommandError {
    return { code, message, detail, recoverable: true };
  }

  function normalizeCommandError(value: unknown): CommandError {
    if (typeof value === "object" && value !== null) {
      const candidate = value as Partial<CommandError>;
      return {
        code: candidate.code ?? "CHECKOUT_FAILED",
        message: candidate.message ?? "Checkout 失败",
        detail: candidate.detail ?? null,
        recoverable: candidate.recoverable ?? true,
      };
    }
    return {
      code: "CHECKOUT_FAILED",
      message: "Checkout 失败",
      detail: String(value || "未知错误"),
      recoverable: true,
    };
  }

  function commandErrorText(value: CommandError | null) {
    return value ? [value.code, value.message, value.detail].filter(Boolean).join("\n") : null;
  }
</script>

<main class="standalone-checkout" data-theme={resolvedTheme} aria-label="NovaSVN Checkout">
  <header class="checkout-titlebar">
    <div class="checkout-heading">
      <span class="checkout-mark" aria-hidden="true">
        <Download size={18} strokeWidth={2} />
      </span>
      <div>
        <h1>NovaSVN Checkout</h1>
        <p title={localPath}>{localPath || "未选择本地目录"}</p>
      </div>
    </div>
    <div class="checkout-actions">
      <span data-status={checkoutTask?.status ?? "idle"}>{taskStatusLabel(checkoutTask)}</span>
      {#if checkoutRunning}
        <button type="button" on:click={stopCheckout}>
          <Square size={14} fill="currentColor" aria-hidden="true" /> 停止
        </button>
      {:else if checkoutTask}
        <button type="button" on:click={startCheckout}>
          <RotateCw size={15} aria-hidden="true" /> 再次 Checkout
        </button>
      {/if}
    </div>
  </header>

  <section class="checkout-notices" class:has-notices={Boolean(commandError || locationError || checkoutTask?.error)}>
    <ErrorNotice error={commandError} />
    <ErrorNotice error={locationError} />
    {#if checkoutTask?.error}
      <div class="inline-error" role="alert">{checkoutTask.error}</div>
    {/if}
  </section>

  <div class="checkout-layout">
    <section class="checkout-form-pane" aria-label="Checkout 设置">
      <header>
        <h2>Checkout 设置</h2>
        <span>{revision.trim() ? `r${revision.trim()}` : "HEAD"}</span>
      </header>
      <form on:submit|preventDefault={startCheckout}>
        <label>
          <span>仓库 URL</span>
          <input
            bind:this={repositoryUrlElement}
            type="url"
            value={repositoryUrl}
            placeholder="https://example.com/svn/project/trunk"
            autocomplete="url"
            disabled={checkoutRunning}
            on:input={(event) => {
              repositoryUrl = (event.currentTarget as HTMLInputElement).value;
              clearFormError();
            }}
          />
        </label>

        <label>
          <span>本地目录</span>
          <div class="path-control">
            <input
              type="text"
              value={localPath}
              placeholder="本地 Checkout 目录"
              disabled={checkoutRunning}
              on:input={(event) => {
                localPath = (event.currentTarget as HTMLInputElement).value;
                clearFormError();
              }}
            />
            <button
              type="button"
              class="icon-button"
              aria-label="选择 Checkout 目录"
              title="选择 Checkout 目录"
              disabled={checkoutRunning}
              on:click={chooseTargetDirectory}
            >
              <FolderOpen size={17} aria-hidden="true" />
            </button>
          </div>
        </label>

        <label>
          <span>Revision</span>
          <input
            type="text"
            inputmode="numeric"
            value={revision}
            placeholder="HEAD"
            disabled={checkoutRunning}
            on:input={(event) => {
              revision = (event.currentTarget as HTMLInputElement).value;
              clearFormError();
            }}
          />
        </label>

        <button type="submit" class="primary" disabled={checkoutRunning}>
          <Download size={16} aria-hidden="true" />
          {checkoutRunning ? "Checkout 中" : "Checkout"}
        </button>
      </form>
    </section>

    <section class="checkout-output" aria-label="Checkout 输出" aria-busy={checkoutRunning}>
      <header>
        <h2>Checkout 内容</h2>
        <span>{checkedOutFiles.length} 个文件</span>
      </header>
      <div
        bind:this={outputElement}
        class="output-lines"
        role="log"
        aria-live="polite"
        on:scroll={handleOutputScroll}
      >
        {#if checkedOutFiles.length > 0}
          {#each checkedOutFiles as file (file.path)}
            <div
              class="output-line"
              data-kind={file.action}
              role="listitem"
              aria-label={`Checkout 文件 ${file.path}`}
            >
              <span>{file.action}</span>
              <code title={file.path}>{file.path}</code>
            </div>
          {/each}
        {:else if checkoutRunning}
          <div class="empty-output" role="status">正在等待 Checkout 文件...</div>
        {:else if checkoutTask}
          <div class="empty-output">没有 Checkout 文件</div>
        {:else}
          <div class="empty-output" role="status">等待 Checkout</div>
        {/if}

        {#if checkoutComplete}
          <div class="checkout-complete" role="status" aria-label="Checkout 完成">
            <CircleCheck size={19} strokeWidth={2.2} aria-hidden="true" />
            <div>
              <strong>Checkout 完成</strong>
              <code title={localPath}>{localPath}</code>
            </div>
            <button type="button" on:click={showCheckoutLocation}>
              <FolderOpen size={15} aria-hidden="true" /> 在资源管理器中显示
            </button>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={null}
    onSubmit={onSvnAuthenticationSubmit}
  />
</main>

<style>
  .standalone-checkout {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f0f2f4;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --control: #ffffff;
    --accent: #2674b9;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
  }

  .standalone-checkout[data-theme="dark"] {
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

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 18px;
  }

  h2 {
    font-size: 13px;
  }

  .checkout-titlebar,
  .checkout-heading,
  .checkout-actions,
  .checkout-actions button,
  .checkout-output > header,
  .checkout-complete,
  .checkout-complete button,
  .primary {
    display: flex;
    align-items: center;
  }

  .checkout-titlebar {
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    padding: 10px 14px;
  }

  .checkout-heading {
    gap: 9px;
    min-width: 0;
  }

  .checkout-heading > div {
    min-width: 0;
  }

  .checkout-mark {
    display: grid;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-subtle);
    color: var(--accent);
    place-items: center;
  }

  .checkout-heading p {
    overflow: hidden;
    margin-top: 2px;
    color: var(--secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .checkout-actions {
    gap: 8px;
    flex: 0 0 auto;
  }

  .checkout-actions > span {
    color: var(--secondary);
    font-size: 12px;
  }

  .checkout-actions > span[data-status="pending"],
  .checkout-actions > span[data-status="running"] {
    color: var(--accent);
  }

  .checkout-actions > span[data-status="success"] {
    color: #24783d;
  }

  button {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--control);
    color: var(--text);
    padding: 4px 10px;
    cursor: pointer;
  }

  button:disabled {
    border-color: var(--border);
    background: var(--panel-subtle);
    color: var(--secondary);
    cursor: default;
  }

  .checkout-actions button,
  .checkout-complete button,
  .primary {
    gap: 5px;
  }

  .checkout-notices {
    min-height: 0;
  }

  .checkout-notices.has-notices {
    display: grid;
    gap: 6px;
    padding: 8px 14px;
  }

  .inline-error {
    border: 1px solid #d9a19d;
    border-radius: 6px;
    background: #fff1f0;
    color: #9d312c;
    padding: 8px 10px;
    font-size: 12px;
  }

  .standalone-checkout[data-theme="dark"] .inline-error {
    border-color: #7e4744;
    background: #3b2525;
    color: #f0a6a1;
  }

  .checkout-layout {
    display: grid;
    grid-template-columns: minmax(320px, 390px) minmax(0, 1fr);
    min-height: 0;
  }

  .checkout-form-pane,
  .checkout-output {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--panel);
  }

  .checkout-form-pane {
    border-right: 1px solid var(--border);
  }

  .checkout-form-pane > header,
  .checkout-output > header {
    min-height: 42px;
    border-bottom: 1px solid var(--border);
    padding: 8px 12px;
  }

  .checkout-form-pane > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .checkout-form-pane > header span,
  .checkout-output > header span {
    color: var(--secondary);
    font-size: 11px;
  }

  .checkout-output > header {
    justify-content: space-between;
  }

  form {
    display: grid;
    align-content: start;
    gap: 16px;
    overflow: auto;
    padding: 18px 16px;
  }

  label {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  label > span {
    color: var(--secondary);
    font-size: 12px;
    font-weight: 600;
  }

  input {
    width: 100%;
    min-width: 0;
    height: 34px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 6px;
    outline: none;
    background: var(--control);
    color: var(--text);
    padding: 6px 9px;
    font: inherit;
    font-size: 13px;
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, var(--panel));
  }

  input:disabled {
    background: var(--panel-subtle);
    color: var(--secondary);
  }

  .path-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px;
    gap: 6px;
  }

  .icon-button {
    display: grid;
    width: 34px;
    height: 34px;
    padding: 0;
    place-items: center;
  }

  .primary {
    justify-content: center;
    width: 100%;
    min-height: 34px;
    margin-top: 2px;
    border-color: #1f639f;
    background: var(--accent);
    color: #ffffff;
    font-weight: 700;
  }

  .primary:hover:not(:disabled) {
    border-color: #18578e;
    background: #1f639f;
    color: #ffffff;
  }

  .output-lines {
    min-height: 0;
    overflow: auto;
    background: var(--panel-subtle);
    padding: 8px 0 16px;
  }

  .output-line {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    min-height: 28px;
    padding: 5px 12px;
    line-height: 1.45;
  }

  .output-line:hover {
    background: var(--panel);
  }

  .output-line > span {
    font-weight: 700;
    text-align: center;
  }

  .output-line[data-kind="A"] > span,
  .output-line[data-kind="U"] > span,
  .output-line[data-kind="G"] > span {
    color: #24783d;
  }

  .output-line[data-kind="D"] > span,
  .output-line[data-kind="C"] > span {
    color: #bc3f39;
  }

  .output-line code {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: Consolas, "SFMono-Regular", monospace;
    font-size: 12px;
    white-space: pre-wrap;
  }

  .empty-output {
    display: grid;
    min-height: 220px;
    color: var(--secondary);
    font-size: 12px;
    place-items: center;
  }

  .checkout-complete {
    gap: 9px;
    min-height: 52px;
    margin-top: 8px;
    border-top: 1px solid color-mix(in srgb, #24783d 35%, var(--border));
    border-bottom: 1px solid color-mix(in srgb, #24783d 35%, var(--border));
    background: color-mix(in srgb, #24783d 10%, var(--panel));
    color: #24783d;
    padding: 8px 12px;
  }

  .checkout-complete > div {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .checkout-complete strong {
    font-size: 13px;
  }

  .checkout-complete code {
    overflow: hidden;
    color: var(--secondary);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .checkout-complete button {
    flex: 0 0 auto;
  }

  .standalone-checkout[data-theme="dark"] .checkout-complete {
    border-color: #376d47;
    background: #203729;
    color: #8fdaa2;
  }

  @media (max-width: 720px) {
    .checkout-titlebar {
      align-items: flex-start;
    }

    .checkout-actions {
      align-items: flex-end;
      flex-direction: column;
    }

    .checkout-layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(240px, 1fr);
      overflow: auto;
    }

    .checkout-form-pane {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    form {
      overflow: visible;
    }
  }
</style>
