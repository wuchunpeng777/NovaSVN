<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import MonacoDiffViewer from "./MonacoDiffViewer.svelte";
  import type {
    ChangedFile,
    CommandError,
    FileContentDiff,
    FileDiff,
    ParsedFileDiff,
    SelectedPatch,
    ShadowWorkspaceStatus,
    SvnDetection,
  } from "../../types/api";
  import type { DetailSection, SafetyCheckSummary } from "../../types/app";

  export let sections: DetailSection[] = [];
  export let commandError: CommandError | null = null;
  export let backendMessage = "";
  export let selectedFile: ChangedFile | null = null;
  export let selectedFileReviewed = false;
  export let safetyCheck: SafetyCheckSummary = {
    blockers: [],
    warnings: [],
    infos: [],
    confirmedWarningIds: [],
  };
  export let selectedFileDiff: FileDiff | null = null;
  export let selectedFileContentDiff: FileContentDiff | null = null;
  export let selectedFileParsedDiff: ParsedFileDiff | null = null;
  export let selectedHunkIds: string[] = [];
  export let selectedPatch: SelectedPatch | null = null;
  export let diffLoading = false;
  export let contentDiffLoading = false;
  export let selectedPatchLoading = false;
  export let diffError: CommandError | null = null;
  export let contentDiffError: CommandError | null = null;
  export let parsedDiffError: CommandError | null = null;
  export let selectedPatchError: CommandError | null = null;
  export let svnDetection: SvnDetection | null = null;
  export let svnError: CommandError | null = null;
  export let svnExecutableInput = "";
  export let svnLoading = false;
  export let shadowStatus: ShadowWorkspaceStatus | null = null;
  export let shadowLoading = false;
  export let shadowError: CommandError | null = null;
  export let onDetectSvn: () => void;
  export let onDetectSvnWithInput: () => void;
  export let onSvnExecutableInput: (value: string) => void;
  export let onRevertFile: (path: string) => void;
  export let onMarkFileReviewed: (path: string) => void;
  export let onMarkFileUnreviewed: (path: string) => void;
  export let onToggleHunkSelection: (filePath: string, hunkId: string) => void;
  export let onPreviewSelectedPatch: () => void;
  export let onRefreshShadowStatus: () => void;
  export let onPrepareShadowWorkspace: () => void;
  export let onRebuildShadowWorkspace: () => void;

  let inlineDiff = false;
  let showWhitespace = false;
</script>

<aside class="detail-panel" aria-label="详情">
  <section class="detail-block">
    <h3>后端状态</h3>
    <ErrorNotice error={commandError} />
    <p>{backendMessage}</p>
  </section>

  <section class="detail-block svn-detection">
    <div class="detail-heading">
      <h3>SVN 命令行</h3>
      <button type="button" on:click={onDetectSvn} disabled={svnLoading}>
        {svnLoading ? "检测中" : "自动检测"}
      </button>
    </div>

    <ErrorNotice error={svnError} />

    {#if svnDetection}
      <dl class="info-list">
        <div>
          <dt>状态</dt>
          <dd>可用</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>{svnDetection.version}</dd>
        </div>
        <div>
          <dt>命令</dt>
          <dd>{svnDetection.executable}</dd>
        </div>
        <div>
          <dt>路径</dt>
          <dd>{svnDetection.resolved_path ?? "未解析到完整路径"}</dd>
        </div>
      </dl>
    {:else}
      <p>尚未检测 SVN 命令行。</p>
    {/if}

    <div class="svn-path-row">
      <input
        type="text"
        value={svnExecutableInput}
        placeholder="svn 或 svn.exe 完整路径"
        on:input={(event) =>
          onSvnExecutableInput((event.currentTarget as HTMLInputElement).value)}
      />
      <button type="button" on:click={onDetectSvnWithInput} disabled={svnLoading}>
        使用此路径
      </button>
    </div>
  </section>

  <section class="detail-block">
    <div class="detail-heading">
      <h3>文件详情</h3>
      <div class="detail-actions">
        {#if selectedFileReviewed}
          <button
            type="button"
            on:click={() => selectedFile && onMarkFileUnreviewed(selectedFile.path)}
            disabled={!selectedFile}
          >
            标为未审
          </button>
        {:else}
          <button
            type="button"
            on:click={() => selectedFile && onMarkFileReviewed(selectedFile.path)}
            disabled={!selectedFile}
          >
            标为已审
          </button>
        {/if}
        <button
          type="button"
          on:click={() => selectedFile && onRevertFile(selectedFile.path)}
          disabled={!selectedFile}
        >
          撤销文件
        </button>
      </div>
    </div>
    {#if selectedFile}
      <dl class="info-list">
        <div>
          <dt>路径</dt>
          <dd>{selectedFile.path}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{selectedFile.status}</dd>
        </div>
        <div>
          <dt>属性</dt>
          <dd>{selectedFile.property_changed ? selectedFile.property_status : "无变更"}</dd>
        </div>
        <div>
          <dt>异常</dt>
          <dd>{selectedFile.abnormal ? "是" : "否"}</dd>
        </div>
        <div>
          <dt>审查</dt>
          <dd>{selectedFileReviewed ? "已审" : "未审"}</dd>
        </div>
      </dl>
    {:else}
      <p>选择一个改动文件后显示详情。</p>
    {/if}
  </section>

  <section class="detail-block diff-block">
    <div class="detail-heading">
      <h3>Diff</h3>
      <div class="diff-actions">
        <button type="button" class:active={!inlineDiff} on:click={() => (inlineDiff = false)}>
          双栏
        </button>
        <button type="button" class:active={inlineDiff} on:click={() => (inlineDiff = true)}>
          行内
        </button>
        <button
          type="button"
          class:active={showWhitespace}
          on:click={() => (showWhitespace = !showWhitespace)}
        >
          空白
        </button>
      </div>
    </div>
    <ErrorNotice error={diffError} />
    <ErrorNotice error={contentDiffError} />
    <ErrorNotice error={parsedDiffError} />
    <ErrorNotice error={selectedPatchError} />
    {#if diffLoading || contentDiffLoading}
      <p>正在读取 Diff...</p>
    {:else if selectedFileContentDiff?.too_large}
      <p>文件超过 {Math.round(selectedFileContentDiff.max_bytes / 1024)} KB，已停止加载 Monaco Diff。</p>
    {:else if selectedFileDiff?.binary}
      <p>该文件是二进制文件，当前不可预览文本 Diff。</p>
    {:else if selectedFileContentDiff && !selectedFileContentDiff.binary}
      <MonacoDiffViewer
        contentDiff={selectedFileContentDiff}
        inlineMode={inlineDiff}
        showWhitespace={showWhitespace}
      />
    {:else if selectedFileDiff && !selectedFileDiff.empty}
      <pre>{selectedFileDiff.text}</pre>
    {:else if selectedFile}
      <p>当前文件没有可显示的文本 Diff。</p>
    {:else}
      <p>选择一个改动文件后显示 Diff。</p>
    {/if}

    {#if selectedFile && selectedFileParsedDiff}
      <div class="hunk-selection-panel">
        <div class="hunk-selection-heading">
          <strong>Hunk 选择</strong>
          {#if selectedFileParsedDiff.partial_commit_supported}
            <button
              type="button"
              disabled={selectedHunkIds.length === 0 || selectedPatchLoading}
              on:click={onPreviewSelectedPatch}
            >
              {selectedPatchLoading ? "生成中" : `预览 ${selectedHunkIds.length}/${selectedFileParsedDiff.hunks.length}`}
            </button>
          {:else}
            <span>{selectedFileParsedDiff.unsupported_reason}</span>
          {/if}
        </div>
        {#if selectedFileParsedDiff.partial_commit_supported}
          {#each selectedFileParsedDiff.hunks as hunk}
            <label class="hunk-option">
              <input
                type="checkbox"
                checked={selectedHunkIds.includes(hunk.id)}
                on:change={() => onToggleHunkSelection(selectedFile.path, hunk.id)}
              />
              <span>{hunk.header}</span>
              <small>{hunk.lines.length} 行</small>
            </label>
          {/each}
        {/if}
        {#if selectedPatch}
          <pre class="selected-patch-preview">{selectedPatch.text}</pre>
        {/if}
      </div>
    {/if}
  </section>

  <section class="detail-block">
    <div class="detail-heading">
      <h3>影子工作副本</h3>
      <div class="detail-actions">
        <button type="button" on:click={onRefreshShadowStatus} disabled={shadowLoading}>
          {shadowLoading ? "检查中" : "检查"}
        </button>
        <button type="button" on:click={onPrepareShadowWorkspace}>
          准备
        </button>
        <button type="button" on:click={onRebuildShadowWorkspace}>
          重建
        </button>
      </div>
    </div>
    <ErrorNotice error={shadowError} />
    {#if shadowStatus}
      <dl class="info-list">
        <div>
          <dt>状态</dt>
          <dd>{shadowStatus.valid ? "可用" : shadowStatus.exists ? "异常" : "未创建"}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{shadowStatus.revision ?? "未知"}</dd>
        </div>
        <div>
          <dt>路径</dt>
          <dd>{shadowStatus.shadow_path}</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>{shadowStatus.message}</dd>
        </div>
      </dl>
    {:else}
      <p>尚未检查影子工作副本。</p>
    {/if}
  </section>

  <section class="detail-block">
    <h3>安全检查</h3>
    <div class="safety-list">
      {#if safetyCheck.blockers.length === 0 && safetyCheck.warnings.length === 0 && safetyCheck.infos.length === 0}
        <p>暂无安全检查结果。</p>
      {:else}
        {#each safetyCheck.blockers as item}
          <article class="safety-item blocker">
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </article>
        {/each}
        {#each safetyCheck.warnings as item}
          <article
            class="safety-item warning"
            class:confirmed={safetyCheck.confirmedWarningIds.includes(item.id)}
          >
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </article>
        {/each}
        {#each safetyCheck.infos as item}
          <article class="safety-item info">
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </article>
        {/each}
      {/if}
    </div>
  </section>

  {#each sections as section}
    <section class="detail-block">
      <h3>{section.title}</h3>
      <p>{section.description}</p>
    </section>
  {/each}
</aside>
