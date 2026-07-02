<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import type {
    ChangedFile,
    CommandError,
    FileDiff,
    SvnDetection,
  } from "../../types/api";
  import type { DetailSection } from "../../types/app";

  export let sections: DetailSection[] = [];
  export let commandError: CommandError | null = null;
  export let backendMessage = "";
  export let selectedFile: ChangedFile | null = null;
  export let selectedFileDiff: FileDiff | null = null;
  export let diffLoading = false;
  export let diffError: CommandError | null = null;
  export let svnDetection: SvnDetection | null = null;
  export let svnError: CommandError | null = null;
  export let svnExecutableInput = "";
  export let svnLoading = false;
  export let onDetectSvn: () => void;
  export let onDetectSvnWithInput: () => void;
  export let onSvnExecutableInput: (value: string) => void;
  export let onRevertFile: (path: string) => void;
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
      <button type="button" on:click={() => selectedFile && onRevertFile(selectedFile.path)} disabled={!selectedFile}>
        撤销文件
      </button>
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
      </dl>
    {:else}
      <p>选择一个改动文件后显示详情。</p>
    {/if}
  </section>

  <section class="detail-block diff-block">
    <h3>Diff</h3>
    <ErrorNotice error={diffError} />
    {#if diffLoading}
      <p>正在读取 Diff...</p>
    {:else if selectedFileDiff?.binary}
      <p>该文件是二进制文件，当前不可预览文本 Diff。</p>
    {:else if selectedFileDiff && !selectedFileDiff.empty}
      <pre>{selectedFileDiff.text}</pre>
    {:else if selectedFile}
      <p>当前文件没有可显示的文本 Diff。</p>
    {:else}
      <p>选择一个改动文件后显示 Diff。</p>
    {/if}
  </section>

  {#each sections as section}
    <section class="detail-block">
      <h3>{section.title}</h3>
      <p>{section.description}</p>
    </section>
  {/each}
</aside>
