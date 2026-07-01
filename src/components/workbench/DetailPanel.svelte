<script lang="ts">
  import ErrorNotice from "../ErrorNotice.svelte";
  import type { CommandError } from "../../types/api";
  import type { DetailSection } from "../../types/app";

  export let sections: DetailSection[] = [];
  export let commandError: CommandError | null = null;
  export let backendMessage = "";
</script>

<aside class="detail-panel" aria-label="详情">
  <section class="detail-block">
    <h3>后端状态</h3>
    <ErrorNotice error={commandError} />
    <p>{backendMessage}</p>
  </section>

  {#each sections as section}
    <section class="detail-block">
      <h3>{section.title}</h3>
      <p>{section.description}</p>
    </section>
  {/each}
</aside>
