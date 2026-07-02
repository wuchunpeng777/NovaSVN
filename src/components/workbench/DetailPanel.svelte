<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import type { CommandError, SvnDetection } from "../../types/api";
  import type { DetailSection } from "../../types/app";

  export let sections: DetailSection[] = [];
  export let commandError: CommandError | null = null;
  export let backendMessage = "";
  export let svnDetection: SvnDetection | null = null;
  export let svnError: CommandError | null = null;
  export let svnExecutableInput = "";
  export let svnLoading = false;
  export let onDetectSvn: () => void;
  export let onDetectSvnWithInput: () => void;
  export let onSvnExecutableInput: (value: string) => void;
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

  {#each sections as section}
    <section class="detail-block">
      <h3>{section.title}</h3>
      <p>{section.description}</p>
    </section>
  {/each}
</aside>
