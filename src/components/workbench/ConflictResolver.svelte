<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    Check,
    Columns2,
    Combine,
    GitMergeConflict,
    Save,
    X,
  } from "@lucide/svelte";
  import ErrorNotice from "../ErrorNotice.svelte";
  import {
    buildResolvedConflictText,
    parseConflictText,
    type ConflictResolutionChoice,
    type ParsedConflictText,
  } from "../../lib/conflict-resolution";
  import type { CommandError, FileContentDiff } from "../../types/api";

  export let open = false;
  export let theme: "light" | "dark" = "light";
  export let filePath = "";
  export let contentDiff: FileContentDiff | null = null;
  export let loading = false;
  export let saving = false;
  export let error: CommandError | null = null;
  export let onClose: () => void = () => {};
  export let onSave: (filePath: string, resolvedText: string) => Promise<boolean> = async () =>
    false;
  export let onUseWorking: (filePath: string) => void = () => {};
  export let onUseMineFull: (filePath: string) => void = () => {};
  export let onUseTheirsFull: (filePath: string) => void = () => {};
  export let onOpenExternalMerge: (filePath: string) => void = () => {};

  let parsed: ParsedConflictText = { segments: [], conflicts: [] };
  let choices: Record<string, ConflictResolutionChoice | undefined> = {};
  let activeConflictIndex = 0;
  let resolvedText = "";
  let sourceSignature = "";

  $: if (open) {
    const signature = `${filePath}:${contentDiff?.modified_text ?? ""}:${contentDiff?.binary ?? false}:${contentDiff?.too_large ?? false}`;
    if (signature !== sourceSignature) {
      sourceSignature = signature;
      parsed = parseConflictText(contentDiff?.modified_text ?? "");
      choices = {};
      activeConflictIndex = 0;
      resolvedText = contentDiff?.modified_text ?? "";
    }
  }
  $: activeConflict = parsed.conflicts[activeConflictIndex] ?? null;
  $: resolvedCount = parsed.conflicts.filter((conflict) => choices[conflict.id]).length;
  $: unresolvedCount = parsed.conflicts.length - resolvedCount;

  function chooseResolution(choice: ConflictResolutionChoice) {
    if (!activeConflict || saving) {
      return;
    }
    choices = { ...choices, [activeConflict.id]: choice };
    resolvedText = buildResolvedConflictText(parsed, choices);
  }

  function goToConflict(offset: -1 | 1) {
    if (parsed.conflicts.length === 0) {
      return;
    }
    activeConflictIndex =
      (activeConflictIndex + offset + parsed.conflicts.length) % parsed.conflicts.length;
  }

  function closeResolver() {
    if (!saving) {
      onClose();
    }
  }

  function runFullFileAction(action: (path: string) => void) {
    if (saving) {
      return;
    }
    onClose();
    action(filePath);
  }

  async function saveResolution() {
    if (saving || unresolvedCount > 0 || parsed.conflicts.length === 0) {
      return;
    }
    if (await onSave(filePath, resolvedText)) {
      onClose();
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open || event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape") {
      closeResolver();
      event.preventDefault();
    }
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
  <div
    class="conflict-resolver-backdrop"
    data-theme={theme}
    role="presentation"
    on:click={(event) => event.target === event.currentTarget && closeResolver()}
  >
    <div
      class="conflict-resolver"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-resolver-title"
    >
      <header class="conflict-resolver-header">
        <span class="conflict-resolver-heading-icon" aria-hidden="true">
          <GitMergeConflict size={22} strokeWidth={1.8} />
        </span>
        <div>
          <h2 id="conflict-resolver-title">解决文本冲突</h2>
          <p title={filePath}>{filePath}</p>
        </div>
        <div class="conflict-resolver-header-actions">
          <div class="conflict-difference-navigation" role="toolbar" aria-label="冲突差异导航">
            <span>{parsed.conflicts.length > 0 ? `${activeConflictIndex + 1} / ${parsed.conflicts.length} 处差异` : "0 / 0 处差异"}</span>
            <button
              type="button"
              class="icon-button"
              aria-label="上一处差异"
              title="上一处差异"
              disabled={saving || parsed.conflicts.length === 0}
              on:click={() => goToConflict(-1)}
            >
              <ArrowUp size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label="下一处差异"
              title="下一处差异"
              disabled={saving || parsed.conflicts.length === 0}
              on:click={() => goToConflict(1)}
            >
              <ArrowDown size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="在外部 Merge 工具中打开"
            title="在外部 Merge 工具中打开"
            disabled={saving}
            on:click={() => onOpenExternalMerge(filePath)}
          >
            <Columns2 size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭冲突解决器"
            title="关闭"
            disabled={saving}
            on:click={closeResolver}
          >
            <X size={18} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </header>

      {#if loading}
        <div class="conflict-resolver-state" role="status">正在读取冲突内容...</div>
      {:else if contentDiff?.binary || contentDiff?.too_large}
        <div class="conflict-resolver-state conflict-resolver-fallback">
          <strong>{contentDiff.binary ? "二进制冲突" : "文件超过内置解决器大小限制"}</strong>
          <div class="conflict-full-actions">
            <button type="button" on:click={() => runFullFileAction(onUseMineFull)}>使用我的版本</button>
            <button type="button" on:click={() => runFullFileAction(onUseTheirsFull)}>使用对方版本</button>
            <button type="button" on:click={() => runFullFileAction(onUseWorking)}>标记当前内容已解决</button>
          </div>
        </div>
      {:else if parsed.conflicts.length === 0}
        <div class="conflict-resolver-state conflict-resolver-fallback">
          <strong>未检测到可分块处理的文本冲突</strong>
          <div class="conflict-full-actions">
            <button type="button" on:click={() => runFullFileAction(onUseMineFull)}>使用我的版本</button>
            <button type="button" on:click={() => runFullFileAction(onUseTheirsFull)}>使用对方版本</button>
            <button type="button" class="primary" on:click={() => runFullFileAction(onUseWorking)}>
              标记当前内容已解决
            </button>
          </div>
        </div>
      {:else}
        <div class="conflict-resolver-body">
          <nav class="conflict-block-nav" aria-label="冲突块">
            <div class="conflict-block-nav-summary">
              <strong>{resolvedCount}/{parsed.conflicts.length}</strong>
              <span>已处理</span>
            </div>
            <div class="conflict-block-list">
              {#each parsed.conflicts as conflict, index (conflict.id)}
                <button
                  type="button"
                  class:active={index === activeConflictIndex}
                  class:resolved={Boolean(choices[conflict.id])}
                  aria-current={index === activeConflictIndex ? "true" : undefined}
                  on:click={() => (activeConflictIndex = index)}
                >
                  <span>{index + 1}</span>
                  <strong>冲突块 {index + 1}</strong>
                  {#if choices[conflict.id]}
                    <Check size={15} strokeWidth={2} aria-label="已处理" />
                  {/if}
                </button>
              {/each}
            </div>
            <div class="conflict-full-actions vertical">
              <button type="button" on:click={() => runFullFileAction(onUseMineFull)}>整文件用我的</button>
              <button type="button" on:click={() => runFullFileAction(onUseTheirsFull)}>整文件用对方</button>
            </div>
          </nav>

          {#if activeConflict}
            <div class="conflict-block-workspace">
              <div class="conflict-choice-grid">
                <section class="conflict-version mine" aria-label="我的版本">
                  <header>
                    <div>
                      <strong>我的版本</strong>
                      <span>{activeConflict.mineLabel}</span>
                    </div>
                    <button
                      type="button"
                      class:active={choices[activeConflict.id] === "mine"}
                      on:click={() => chooseResolution("mine")}
                    >
                      采用
                    </button>
                  </header>
                  <pre>{activeConflict.mine || "(空内容)"}</pre>
                </section>

                <section class="conflict-version theirs" aria-label="对方版本">
                  <header>
                    <div>
                      <strong>对方版本</strong>
                      <span>{activeConflict.theirsLabel}</span>
                    </div>
                    <button
                      type="button"
                      class:active={choices[activeConflict.id] === "theirs"}
                      on:click={() => chooseResolution("theirs")}
                    >
                      采用
                    </button>
                  </header>
                  <pre>{activeConflict.theirs || "(空内容)"}</pre>
                </section>
              </div>

              <div class="conflict-combine-action">
                <button
                  type="button"
                  class:active={choices[activeConflict.id] === "both"}
                  on:click={() => chooseResolution("both")}
                >
                  <Combine size={16} strokeWidth={1.9} aria-hidden="true" />
                  保留双方
                </button>
              </div>

              {#if activeConflict.base !== null}
                <details class="conflict-base-version">
                  <summary>合并前基线 <span>{activeConflict.baseLabel}</span></summary>
                  <pre>{activeConflict.base || "(空内容)"}</pre>
                </details>
              {/if}

              <section class="conflict-result" aria-label="合并结果">
                <header>
                  <strong>合并结果</strong>
                  <span>{unresolvedCount === 0 ? "全部冲突块已处理" : `${unresolvedCount} 个冲突块待处理`}</span>
                </header>
                <textarea
                  aria-label="可编辑的合并结果"
                  bind:value={resolvedText}
                  spellcheck="false"
                  disabled={saving}
                ></textarea>
              </section>
            </div>
          {/if}
        </div>

        <footer class="conflict-resolver-footer">
          <ErrorNotice {error} />
          <div class="conflict-resolver-footer-actions">
            <button type="button" disabled={saving} on:click={closeResolver}>取消</button>
            <button
              type="button"
              class="primary"
              disabled={saving || unresolvedCount > 0}
              aria-busy={saving}
              on:click={saveResolution}
            >
              <Save size={16} strokeWidth={1.9} aria-hidden="true" />
              {saving ? "正在保存" : "保存并标记已解决"}
            </button>
          </div>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .conflict-resolver-backdrop {
    position: fixed;
    z-index: 120;
    inset: 0;
    display: grid;
    background: #252a2f;
    place-items: center;
  }

  .conflict-resolver {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: #f4f6f8;
    color: #24313c;
  }

  .conflict-resolver-header {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 62px;
    border-bottom: 1px solid #c9d0d6;
    background: #ffffff;
    padding: 9px 12px;
  }

  .conflict-resolver-heading-icon {
    display: grid;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: #fff0df;
    color: #a14e09;
    place-items: center;
  }

  .conflict-resolver-header h2,
  .conflict-resolver-header p {
    margin: 0;
  }

  .conflict-resolver-header h2 {
    font-size: 15px;
  }

  .conflict-resolver-header p {
    overflow: hidden;
    margin-top: 3px;
    color: #67737e;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-resolver-header-actions,
  .conflict-resolver-footer-actions,
  .conflict-full-actions,
  .conflict-combine-action {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .conflict-difference-navigation {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-right: 3px;
    border-right: 1px solid #d3d8dd;
    padding-right: 9px;
  }

  .conflict-difference-navigation > span {
    min-width: 34px;
    color: #67737e;
    font-size: 11px;
    text-align: center;
  }

  .conflict-difference-navigation .icon-button {
    display: grid;
    width: 30px;
    min-width: 30px;
    height: 30px;
    padding: 0;
    place-items: center;
  }

  .conflict-resolver-body {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  .conflict-block-nav {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 0;
    border-right: 1px solid #c9d0d6;
    background: #e9edf1;
  }

  .conflict-block-nav-summary {
    display: flex;
    align-items: baseline;
    gap: 6px;
    border-bottom: 1px solid #c9d0d6;
    padding: 11px 12px;
  }

  .conflict-block-nav-summary strong {
    color: #1e5f94;
    font-size: 17px;
  }

  .conflict-block-nav-summary span {
    color: #697681;
    font-size: 11px;
  }

  .conflict-block-list {
    overflow: auto;
    padding: 7px;
  }

  .conflict-block-list button {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 18px;
    align-items: center;
    width: 100%;
    min-height: 36px;
    border: 1px solid #c5cdd4;
    border-radius: 5px;
    background: #f7f8fa;
    padding: 4px 7px;
    color: #46535f;
    text-align: left;
  }

  .conflict-block-list button + button {
    margin-top: 5px;
  }

  .conflict-block-list button.active {
    border-color: #4381b5;
    background: #e4f0fa;
    color: #164f7d;
  }

  .conflict-block-list button.resolved > span {
    background: #dcefe2;
    color: #27643a;
  }

  .conflict-block-list button > span {
    display: grid;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: #e3e7eb;
    font-size: 11px;
    place-items: center;
  }

  .conflict-block-list button strong {
    font-size: 12px;
  }

  .conflict-full-actions.vertical {
    display: grid;
    border-top: 1px solid #c9d0d6;
    padding: 8px;
  }

  .conflict-block-workspace {
    display: grid;
    grid-template-rows: minmax(150px, 0.85fr) auto auto minmax(190px, 1.15fr);
    gap: 9px;
    min-width: 0;
    min-height: 0;
    padding: 10px;
  }

  .conflict-choice-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
    min-height: 0;
  }

  .conflict-version,
  .conflict-result,
  .conflict-base-version {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid #bbc4cc;
    border-radius: 6px;
    background: #ffffff;
  }

  .conflict-version {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .conflict-version > header,
  .conflict-result > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 40px;
    border-bottom: 1px solid #d2d8dd;
    padding: 6px 8px;
  }

  .conflict-version.mine > header {
    background: #edf8f0;
  }

  .conflict-version.theirs > header {
    background: #edf5fc;
  }

  .conflict-version header > div {
    display: grid;
    min-width: 0;
  }

  .conflict-version header strong,
  .conflict-result header strong {
    font-size: 12px;
  }

  .conflict-version header span,
  .conflict-result header span,
  .conflict-base-version summary span {
    overflow: hidden;
    color: #6a7782;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-version header button.active,
  .conflict-combine-action button.active {
    border-color: #3777aa;
    background: #dcecf9;
    color: #15517f;
  }

  .conflict-version pre,
  .conflict-base-version pre {
    overflow: auto;
    margin: 0;
    padding: 9px 10px;
    color: #25323d;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
  }

  .conflict-combine-action {
    justify-content: center;
  }

  .conflict-combine-action button,
  .conflict-resolver-footer .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .conflict-base-version {
    max-height: 118px;
    background: #fff9e8;
  }

  .conflict-base-version summary {
    cursor: pointer;
    padding: 7px 9px;
    font-size: 11px;
    font-weight: 600;
  }

  .conflict-base-version pre {
    max-height: 80px;
    border-top: 1px solid #dfd5b4;
  }

  .conflict-result {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .conflict-result textarea {
    width: 100%;
    height: 100%;
    min-height: 0;
    resize: none;
    border: 0;
    border-radius: 0;
    background: #ffffff;
    padding: 10px;
    color: #1f2c36;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    outline: 0;
  }

  .conflict-result textarea:focus {
    outline: 2px solid #397fb8;
    outline-offset: -2px;
  }

  .conflict-resolver-footer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 54px;
    border-top: 1px solid #c9d0d6;
    background: #ffffff;
    padding: 8px 12px;
  }

  .conflict-resolver-state {
    display: grid;
    min-height: 280px;
    padding: 24px;
    place-items: center;
  }

  .conflict-resolver-fallback {
    align-content: center;
    gap: 18px;
  }

  .conflict-resolver-backdrop[data-theme="dark"] {
    background: #111417;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-resolver {
    border-color: #515b65;
    background: #20252a;
    color: #e1e6ea;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-resolver-header,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-resolver-footer {
    border-color: #454e56;
    background: #282e34;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-difference-navigation {
    border-color: #454e56;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-difference-navigation > span {
    color: #aab4bd;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-block-nav {
    border-color: #454e56;
    background: #252a30;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-block-nav-summary,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-full-actions.vertical {
    border-color: #454e56;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-block-list button {
    border-color: #505b64;
    background: #30363c;
    color: #d6dde3;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-block-list button.active {
    border-color: #5794c7;
    background: #263f54;
    color: #d7ebfb;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-version,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-result,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-base-version {
    border-color: #535d66;
    background: #1d2226;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-version > header,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-result > header {
    border-color: #4a535c;
    background: #2b3137;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-version.mine > header {
    background: #25372b;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-version.theirs > header {
    background: #253647;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-base-version {
    background: #39321f;
  }

  .conflict-resolver-backdrop[data-theme="dark"] .conflict-version pre,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-base-version pre,
  .conflict-resolver-backdrop[data-theme="dark"] .conflict-result textarea {
    background: #1d2226;
    color: #dce3e8;
  }

  @media (max-width: 760px) {
    .conflict-resolver-backdrop {
      padding: 8px;
    }

    .conflict-resolver-body {
      grid-template-columns: 142px minmax(0, 1fr);
    }

    .conflict-choice-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .conflict-block-workspace {
      overflow: auto;
    }
  }
</style>
