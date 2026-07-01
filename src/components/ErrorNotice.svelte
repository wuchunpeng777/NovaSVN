<script lang="ts">
  import type { CommandError } from "../types/api";

  export let error: CommandError | null = null;
</script>

{#if error}
  <section class="error-notice" role="alert" aria-label="命令错误">
    <div>
      <strong>{error.message}</strong>
      <span>{error.code}</span>
    </div>
    {#if error.detail}
      <p>{error.detail}</p>
    {/if}
    <small>{error.recoverable ? "可重试" : "需要处理后再继续"}</small>
  </section>
{/if}
